import { afterEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { materializeH3Job } from "@/lib/h3GenerationServer";
import { h3ProjectFixture } from "../helpers/h3Project";

const objects = new Map<string, { body: string; etag: string }>();
let serial = 0, conditionalFailures = 0;
let sourceEtag = "image-version-1";
let metadataOverride: Record<string, unknown> = {};
let metadataError: Error | undefined;
let fullMetadataOverride: Record<string, unknown> = {};
let fullMetadataError: Error | undefined;
let imageReads: Record<string, unknown>[] = [];
let conditionalImageErrors: Error[] = [];
let responseEtagOverride: string | undefined;
const originalFetch = globalThis.fetch;
const names = ["RUSTFS_S3_ENDPOINT", "RUSTFS_ACCESS_KEY", "RUSTFS_SECRET_KEY"] as const;
const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
class GetObjectCommand { constructor(public input: Record<string, unknown>) {} }
class PutObjectCommand { constructor(public input: Record<string, unknown>) {} }
class ListObjectsV2Command { constructor(public input: Record<string, unknown>) {} }
function failure(code: number) { return Object.assign(new Error(`S3 ${code}`), { $metadata: { httpStatusCode: code } }); }
class S3Client {
  async send(command: GetObjectCommand | PutObjectCommand | ListObjectsV2Command) {
    const input = command.input;
    const key = String(input.Key);
    if (command instanceof GetObjectCommand) {
      if (key.endsWith(".png")) {
        imageReads.push(input);
        if (input.Range) {
          expect(input.Range).toBe("bytes=0-0");
          if (metadataError) throw metadataError;
          return { ETag: sourceEtag, ContentType: "image/png", ContentLength: 1, ContentRange: "bytes 0-0/3",
            $metadata: { httpStatusCode: 206 }, Body: { transformToByteArray: async () => new Uint8Array([1]) }, ...metadataOverride };
        }
        if (!input.IfMatch) {
          if (fullMetadataError) throw fullMetadataError;
          return { ETag: sourceEtag, ContentType: "image/png", ContentLength: 3, $metadata: { httpStatusCode: 200 },
            Body: { async *[Symbol.asyncIterator]() { yield new Uint8Array([1, 2]); yield new Uint8Array([3]); } }, ...fullMetadataOverride };
        }
        if (conditionalImageErrors.length) throw conditionalImageErrors.shift()!;
        if (input.IfMatch !== sourceEtag) throw failure(412);
        return { ETag: responseEtagOverride ?? sourceEtag, ContentType: "image/png", ContentLength: 3, Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } };
      }
      const current = objects.get(key);
      if (!current) throw failure(404);
      return { Body: { transformToString: async () => current.body }, ETag: current.etag };
    }
    if (command instanceof PutObjectCommand) {
      const current = objects.get(key);
      if ((input.IfNoneMatch === "*" && current) || (input.IfMatch && input.IfMatch !== current?.etag)) {
        conditionalFailures++; throw failure(412);
      }
      objects.set(key, { body: String(input.Body), etag: `v${++serial}` });
      return {};
    }
    return { Contents: [...objects.keys()].filter(key => key.startsWith(String(input.Prefix))).map(Key => ({ Key })) };
  }
}
mock.module("@aws-sdk/client-s3", () => ({ GetObjectCommand, PutObjectCommand, ListObjectsV2Command, S3Client }));
mock.module("@/lib/mediaGateway", () => ({ getMediaGatewayConfig: () => ({ bucket: "studio", url: "https://media.example", token: "test-only" }) }));
const { createH3Job, readH3Job, updateH3Job, listH3Jobs, pinH3JobReferences, downloadH3ReferenceImage, claimH3GenerationIntent } = await import("@/lib/h3JobStore");

test("a canceled queue history read stops before accessing durable job storage", async () => {
  const controller = new AbortController(); controller.abort(new Error("queue view closed"));
  const before = JSON.stringify([...objects]);
  await expect(listH3Jobs("github-test", "project-1", controller.signal)).rejects.toThrow("queue view closed");
  expect(JSON.stringify([...objects])).toBe(before);
});

function setup() {
  objects.clear(); serial = 0; conditionalFailures = 0; sourceEtag = "image-version-1";
  metadataOverride = {}; metadataError = undefined;
  fullMetadataOverride = {}; fullMetadataError = undefined; imageReads = []; conditionalImageErrors = []; responseEtagOverride = undefined;
  process.env.RUSTFS_S3_ENDPOINT = "https://storage.example";
  process.env.RUSTFS_ACCESS_KEY = "test-only-access";
  process.env.RUSTFS_SECRET_KEY = "test-only-secret";
  globalThis.fetch = (() => { throw new Error("Reference metadata must use signed S3, not a redirecting gateway."); }) as typeof fetch;
  const { saved, request } = h3ProjectFixture();
  return materializeH3Job("github-test", saved, request, "studio");
}
afterEach(() => { globalThis.fetch = originalFetch; for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; } });

describe("conditional durable H3 job records", () => {
  test("selected aesthetic originals must match their recorded byte hash after conditional download", async () => {
    const job = setup(), pinned = await pinH3JobReferences(job);
    const reference = { ...pinned.references[0], aesthetic: { purpose: "shot" as const, guidance: "Low camera", originalSha256: createHash("sha256").update(new Uint8Array([1, 2, 3])).digest("hex") } };
    expect((await downloadH3ReferenceImage(reference)).bytes.byteLength).toBe(3);
    await expect(downloadH3ReferenceImage({ ...reference, aesthetic: { ...reference.aesthetic, originalSha256: "0".repeat(64) } })).rejects.toThrow(/original uploaded bytes/);
  });
  test("retries one signature rejection with the same pinned signed conditional GET", async () => {
    const job = setup(), pinned = await pinH3JobReferences(job); imageReads = [];
    conditionalImageErrors = [Object.assign(failure(403), { name: "SignatureDoesNotMatch" })];
    expect((await downloadH3ReferenceImage(pinned.references[0])).bytes.byteLength).toBe(3);
    expect(imageReads.length).toBe(2);
    expect(imageReads.every(input => input.IfMatch === pinned.references[0].etag && input.Key === pinned.references[0].objectKey && !input.Range)).toBe(true);
  });

  test("signature rejection retries are bounded and never become an unconditional GET", async () => {
    const job = setup(), pinned = await pinH3JobReferences(job); imageReads = [];
    conditionalImageErrors = Array.from({ length: 3 }, () => Object.assign(failure(403), { name: "SignatureDoesNotMatch" }));
    await expect(downloadH3ReferenceImage(pinned.references[0])).rejects.toThrow("storage HTTP 403");
    expect(imageReads.length).toBe(2); expect(conditionalImageErrors.length).toBe(1);
    expect(imageReads.every(input => input.IfMatch === pinned.references[0].etag)).toBe(true);
  });

  for (const code of [403, 404, 412, 500]) test(`does not retry unrelated storage HTTP ${code}`, async () => {
    const job = setup(), pinned = await pinH3JobReferences(job); imageReads = [];
    conditionalImageErrors = [Object.assign(failure(code), { name: code === 403 ? "AccessDenied" : "Other" })];
    await expect(downloadH3ReferenceImage(pinned.references[0])).rejects.toThrow(`storage HTTP ${code}`);
    expect(imageReads.length).toBe(1);
  });

  test("a response ETag mismatch fails closed without a retry", async () => {
    const job = setup(), pinned = await pinH3JobReferences(job); imageReads = []; responseEtagOverride = "changed-version";
    await expect(downloadH3ReferenceImage(pinned.references[0])).rejects.toThrow("response version changed");
    expect(imageReads.length).toBe(1);
  });
  test("identical transport replay cannot reset a rendering job to queued", async () => {
    const job = setup();
    await createH3Job(job);
    await updateH3Job(job.ownerId, job.projectId, job.id, current => ({ ...current, state: "rendering", promptId: "provider-a" }));
    const replay = await createH3Job(job);
    expect(replay.state).toBe("rendering");
    expect(replay.promptId).toBe("provider-a");
    expect(objects.size).toBe(1);
  });

  test("concurrent provider-id and dispatch writes preserve both fields with compare-and-swap", async () => {
    const job = setup(); await createH3Job(job);
    await Promise.all([
      updateH3Job(job.ownerId, job.projectId, job.id, current => ({ ...current, runId: "run-a" })),
      updateH3Job(job.ownerId, job.projectId, job.id, current => ({ ...current, promptId: "provider-a", state: "rendering" })),
    ]);
    const stored = await readH3Job(job.ownerId, job.projectId, job.id);
    expect(stored?.runId).toBe("run-a"); expect(stored?.promptId).toBe("provider-a");
    expect(conditionalFailures).toBeGreaterThan(0);
    expect((await listH3Jobs(job.ownerId, job.projectId)).map(job => job.id)).toEqual([job.id]);
    expect(await listH3Jobs("other-owner", job.projectId)).toEqual([]);
    expect(await readH3Job("other-owner", job.projectId, job.id)).toBeNull();
  });

  test("job identity cannot be changed through a state update or path traversal", async () => {
    const job = setup(); await createH3Job(job);
    await expect(updateH3Job(job.ownerId, job.projectId, job.id, current => ({ ...current, ownerId: "other" }))).rejects.toThrow("immutable");
    await expect(readH3Job(job.ownerId, job.projectId, "../../private")).rejects.toThrow("Invalid generation job");
  });

  test("reference ETags enter job identity and a queued job cannot read overwritten reference bytes", async () => {
    const initial = setup();
    const pinned = await pinH3JobReferences(initial);
    expect(pinned.id).not.toBe(initial.id);
    expect(pinned.references[0].etag).toBe(sourceEtag);
    expect((await pinH3JobReferences(initial)).id).toBe(pinned.id);
    expect((await downloadH3ReferenceImage(pinned.references[0])).bytes.byteLength).toBe(3);
    sourceEtag = "image-version-2";
    expect((await pinH3JobReferences(initial)).id).not.toBe(pinned.id);
    await expect(downloadH3ReferenceImage(pinned.references[0])).rejects.toThrow("412");
  });

  test("reference metadata requires bounded partial bytes and authoritative image metadata", async () => {
    const job = setup();
    let consumed = false, destroyed = false;
    metadataOverride = { $metadata: { httpStatusCode: 200 }, ContentLength: 3,
      Body: { transformToByteArray: async () => { consumed = true; return new Uint8Array([1, 2, 3]); }, destroy: () => { destroyed = true; } } };
    await expect(pinH3JobReferences(job)).rejects.toThrow("one-byte range");
    expect(consumed).toBe(false); expect(destroyed).toBe(true);
    metadataOverride = { ContentRange: "bytes 0-0/33554433" };
    await expect(pinH3JobReferences(job)).rejects.toThrow("smaller than 32 MiB");
    metadataOverride = { ContentType: "text/html" };
    await expect(pinH3JobReferences(job)).rejects.toThrow("PNG, JPEG or WebP");
    metadataOverride = { Body: { transformToByteArray: async () => new Uint8Array() } };
    await expect(pinH3JobReferences(job)).rejects.toThrow("incomplete byte range");
  });

  test("reference lookup failures identify the safe storage boundary without exposing transport details", async () => {
    const job = setup();
    metadataError = failure(403);
    await expect(pinH3JobReferences(job)).rejects.toThrow("Reference metadata lookup failed (storage HTTP 403)");
    metadataError.name = "SignatureDoesNotMatch";
    fullMetadataError = Object.assign(failure(403), { name: "SignatureDoesNotMatch" });
    await expect(pinH3JobReferences(job)).rejects.toThrow("storage HTTP 403, SignatureDoesNotMatch");
    metadataError.name = "private-transport-detail";
    await expect(pinH3JobReferences(job)).rejects.toThrow("Reference metadata lookup failed (storage HTTP 403).");
    metadataError = new Error("fetch failed secret transport detail");
    await expect(pinH3JobReferences(job)).rejects.toThrow("Reference metadata lookup could not reach durable storage.");
    metadataError = undefined;
    metadataOverride = { Body: { transformToByteArray: async () => { throw new Error("secret body detail"); } } };
    await expect(pinH3JobReferences(job)).rejects.toThrow("interrupted while reading durable storage");
  });

  test("only a ranged SignatureDoesNotMatch compares a bounded full signed GET on the same owned keys", async () => {
    const job = setup();
    const ranged = await pinH3JobReferences(job);
    imageReads = [];
    metadataError = Object.assign(failure(403), { name: "SignatureDoesNotMatch" });
    const full = await pinH3JobReferences(job);
    expect(full.id).toBe(ranged.id);
    expect(imageReads.map(input => [input.Key, input.Range])).toEqual(job.references.flatMap(ref =>
      [[ref.objectKey, "bytes=0-0"], [ref.objectKey, undefined]]));
    for (const error of [Object.assign(failure(403), { name: "AccessDenied" }), failure(500), new Error("network unavailable")]) {
      metadataError = error; imageReads = [];
      await expect(pinH3JobReferences(job)).rejects.toThrow();
      expect(imageReads).toHaveLength(1);
      expect(imageReads[0].Range).toBe("bytes=0-0");
    }
  });

  test("full signed comparison rejects oversized metadata before reading and bounds every streamed chunk", async () => {
    const job = setup();
    metadataError = Object.assign(failure(403), { name: "SignatureDoesNotMatch" });
    let consumed = false, destroyed = false;
    fullMetadataOverride = { ContentLength: 33554433, Body: {
      async *[Symbol.asyncIterator]() { consumed = true; yield new Uint8Array([1]); }, destroy: () => { destroyed = true; } } };
    await expect(pinH3JobReferences(job)).rejects.toThrow("smaller than 32 MiB");
    expect(consumed).toBe(false); expect(destroyed).toBe(true);
    fullMetadataOverride = { Body: { async *[Symbol.asyncIterator]() { yield new Uint8Array([1, 2, 3, 4]); }, destroy: () => { destroyed = true; } } };
    destroyed = false;
    await expect(pinH3JobReferences(job)).rejects.toThrow("exceeded its declared image size");
    expect(destroyed).toBe(true);
    fullMetadataOverride = { Body: { async *[Symbol.asyncIterator]() { yield new Uint8Array([1]); } } };
    await expect(pinH3JobReferences(job)).rejects.toThrow("incomplete image");
    fullMetadataOverride = { Body: { [Symbol.asyncIterator]: () => ({ next: async () => { throw new Error("private transport details"); } }) } };
    await expect(pinH3JobReferences(job)).rejects.toThrow("interrupted while reading durable storage");
    fullMetadataOverride = { ContentType: "text/html" };
    await expect(pinH3JobReferences(job)).rejects.toThrow("PNG, JPEG or WebP");
  });

  test("one intent/attempt is immutable even if the payload or pinned image changes", async () => {
    const initial = setup();
    await claimH3GenerationIntent(initial);
    await claimH3GenerationIntent(initial);
    const changed = { ...initial, id: `h3-${"a".repeat(64)}` };
    await expect(claimH3GenerationIntent(changed)).rejects.toThrow("already identifies another shot");
    const revision = { ...changed, request: { ...initial.request, attempt: 1 } };
    await expect(claimH3GenerationIntent(revision)).rejects.toThrow("preceding attempt");
    await createH3Job(initial);
    await expect(claimH3GenerationIntent(revision)).rejects.toThrow("preceding attempt");
    await updateH3Job(initial.ownerId, initial.projectId, initial.id, current => ({ ...current, state: "failed" }));
    await claimH3GenerationIntent(revision);
    expect(objects.size).toBe(3); // two intent claims and one original job
  });
});
