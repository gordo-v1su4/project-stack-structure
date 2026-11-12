import { expect, test } from "bun:test";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getMediaThumbnail } from "@/lib/mediaThumbnail";
import { preparedThumbnailObjectKey, preparedThumbnailPersistence } from "@/lib/preparedThumbnailStore";

type Artifact = { bytes: Uint8Array; metadata: Record<string, string>; type: string; declaredLength?: number };
function fixture() {
  const objects = new Map<string, Artifact>();
  const calls: string[] = [];
  let cancelled = 0;
  const client = { async send(command: GetObjectCommand | PutObjectCommand) {
    const key = command.input.Key!;
    if (command instanceof PutObjectCommand) {
      calls.push("put");
      objects.set(key, { bytes: new Uint8Array(command.input.Body as Uint8Array), metadata: command.input.Metadata ?? {}, type: command.input.ContentType! });
      return { ETag: '"saved"' };
    }
    calls.push("get");
    const artifact = objects.get(key);
    if (!artifact) throw Object.assign(new Error("Missing"), { $metadata: { httpStatusCode: 404 } });
    return { ContentType: artifact.type, ContentLength: artifact.declaredLength ?? artifact.bytes.byteLength, Metadata: artifact.metadata,
      Body: { transformToWebStream: () => new ReadableStream({ start(controller) {
        controller.enqueue(artifact.bytes);
        if (artifact.bytes.byteLength <= 2 * 1024 * 1024) controller.close();
      }, cancel() { cancelled++; } }) } };
  } } as unknown as S3Client;
  return { objects, calls, storage: () => ({ client, bucket: "stack-structure", fingerprint: "fixture" }), cancelled: () => cancelled };
}
const image = async () => sharp({ create: { width: 1280, height: 720, channels: 3, background: "#34201a" } }).png().toBuffer();
const source = (sha256: string) => ({ ownerId: "github-owner", bucket: "stack-structure", objectKey: "media-uploads/github-owner/frame.png", sha256, width: 320 as const });

test("a new request cache entry reads durable WebP without downloading or resizing the original again", async () => {
  const f = fixture(), png = await image(), sha = createHash("sha256").update(png).digest("hex"), input = source(sha);
  let loads = 0;
  const first = await getMediaThumbnail("durable-process-one", 320, async () => { loads++; return new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } }); }, preparedThumbnailPersistence(input, f.storage));
  const second = await getMediaThumbnail("durable-process-two", 320, async () => { throw new Error("Original must not be read"); }, preparedThumbnailPersistence(input, f.storage));
  expect(loads).toBe(1);
  expect(first.durable).toBe(true); expect(second.durable).toBe(true);
  expect(second.bytes).toEqual(first.bytes);
  expect(f.calls).toEqual(["get", "put", "get"]);
  expect(await sharp(second.bytes).metadata()).toMatchObject({ format: "webp", width: 320, height: 180 });
  expect(png).toEqual(await image());
});

test("version, source, owner and dimensions isolate durable artifacts; invalid versions never open storage", () => {
  const input = source("a".repeat(64)), key = preparedThumbnailObjectKey(input);
  for (const patch of [{ sha256: "b".repeat(64) }, { ownerId: "other" }, { width: 640 as const }, { objectKey: input.objectKey + "2" }]) {
    expect(preparedThumbnailObjectKey({ ...input, ...patch })).not.toBe(key);
  }
  expect(preparedThumbnailObjectKey({ ...input, sha256: input.sha256.toUpperCase() })).toBe(key);
  expect(preparedThumbnailPersistence({ ...input, sha256: "unverified" }, () => { throw new Error("Must not open"); })).toBe(undefined);
});

test("changed source bytes cannot populate a claimed version, and unavailable storage keeps an honest runtime fallback", async () => {
  const f = fixture(), png = await image();
  await expect(getMediaThumbnail("wrong-source-version", 320, async () => new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } }),
    preparedThumbnailPersistence(source("a".repeat(64)), f.storage))).rejects.toMatchObject({ status: 409 });
  expect(f.calls).toEqual(["get"]);
  const sha = createHash("sha256").update(png).digest("hex");
  const thumb = await getMediaThumbnail("unavailable-derivatives", 320, async () => new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } }),
    preparedThumbnailPersistence(source(sha), () => { throw new Error("Unavailable"); }));
  expect(thumb.durable).toBe(false);
  expect((await sharp(thumb.bytes).metadata()).width).toBe(320);
});

test("durable reads reject corrupt metadata and oversized streams without trusting their declared length", async () => {
  const f = fixture(), input = source("a".repeat(64)), persistence = preparedThumbnailPersistence(input, f.storage)!;
  const webp = await sharp(await image()).resize(320, 180).webp().toBuffer();
  await persistence.write(webp);
  const artifact = f.objects.get(preparedThumbnailObjectKey(input))!;
  artifact.metadata.sha256 = "corrupt";
  expect(await persistence.read()).toBeNull();
  artifact.bytes = new Uint8Array(2 * 1024 * 1024 + 1);
  artifact.declaredLength = 10;
  expect(await persistence.read()).toBeNull();
  expect(f.cancelled()).toBe(1);
});
