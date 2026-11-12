import { expect, test } from "bun:test";
import { S3Client } from "@aws-sdk/client-s3";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { pinReviewVideoSource, readPreparedReviewVideo, storePreparedReviewVideo, reviewVideoIdentity } from "@/lib/preparedReviewVideoStore";
import { prepareStoredReviewVideo } from "@/lib/prepareStoredReviewVideo";
import { prepareReviewVideo } from "@/lib/prepareReviewVideo";
import { studioMediaStorage } from "@/lib/studioProjectObjectStore";

const execute = promisify(execFile), ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const available = await execute(ffmpeg, ["-version"]).then(() => true, () => false);
(available ? test : test.skip)("stored-video preparation pins source bytes and publishes complete derivatives before ready", async () => {
  const root = resolve(".tmp/stored-review-video-tests"); await mkdir(root, { recursive: true });
  const folder = await mkdtemp(join(root, "run-"));
  const sourceFile = join(folder, "source.mp4"), scratch = join(folder, "scratch");
  await execute(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=12:duration=1", "-c:v", "libx264", "-threads", "2", sourceFile], { timeout: 30_000 });
  const original = await readFile(sourceFile), sourceKey = "media-uploads/projects/github-fixture/clips/source.mp4";
  const objects = new Map<string, { bytes: Buffer; type: string; etag: string; metadata: Record<string, string> }>();
  const sourcePath = `/stack-structure/${sourceKey}`, calls: Array<{ method: string; key: string; ifMatch?: string }> = [];
  objects.set(sourcePath, { bytes: original, type: "video/mp4", etag: '"original-version"', metadata: {} });
  let failSuffix = "";
  const server = createServer(async (request, response) => {
    const key = new URL(request.url!, "http://127.0.0.1").pathname;
    calls.push({ method: request.method!, key, ifMatch: request.headers["if-match"] as string | undefined });
    const object = objects.get(key);
    if (failSuffix && key.endsWith(failSuffix)) { response.writeHead(503); response.end(); return; }
    if (request.method === "PUT") {
      if (object && request.headers["if-none-match"] === "*") { response.writeHead(412); response.end(); return; }
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const metadata: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) if (name.startsWith("x-amz-meta-") && typeof value === "string") metadata[name] = value;
      objects.set(key, { bytes: Buffer.concat(chunks), type: request.headers["content-type"] ?? "", etag: '"stored-version"', metadata });
      response.writeHead(200, { etag: '"stored-version"' }); response.end(); return;
    }
    if (!object) { response.writeHead(404); response.end(); return; }
    if (request.headers["if-match"] && request.headers["if-match"] !== object.etag) { response.writeHead(412); response.end(); return; }
    response.writeHead(200, { etag: object.etag, "content-type": object.type, "content-length": object.bytes.length, ...object.metadata });
    response.end(request.method === "HEAD" ? undefined : object.bytes);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const client = new S3Client({ endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, region: "fixture", forcePathStyle: true,
    credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" }, maxAttempts: 1, requestChecksumCalculation: "WHEN_REQUIRED" });
  const storage = (() => ({ client, bucket: "stack-structure", fingerprint: "fixture" })) satisfies typeof studioMediaStorage;
  try {
    const source = await pinReviewVideoSource("github-fixture", "stack-structure", sourceKey, storage);
    expect(source.etag).toBe('"original-version"'); expect(source.bytes).toBe(original.length);
    let encodes = 0;
    let encoded: Awaited<ReturnType<typeof prepareReviewVideo>> | undefined;
    const options = { storage, tempRoot: scratch, authorize: async () => true, encode: async (...args: Parameters<typeof prepareReviewVideo>) => {
      encodes++; encoded = await prepareReviewVideo(...args); return encoded;
    } };
    const result = await prepareStoredReviewVideo(source, options);
    expect(encodes).toBe(1);
    expect(calls.find(call => call.method === "GET" && call.key === sourcePath)?.ifMatch).toBe(source.etag);
    expect(calls.filter(call => call.method === "PUT").map(call => call.key.split("/").at(-1)?.split(".").at(-1))).toEqual(["mp4", "webp", "jpg", "json"]);
    expect(result.metadata.source.bytes).toBe(original.length);
    expect(await readPreparedReviewVideo(source, storage)).toEqual(result);
    const beforeReuse = calls.length;
    expect(await prepareStoredReviewVideo(source, { ...options, encode: async () => { throw new Error("Must not encode again"); } })).toEqual(result);
    expect(calls.slice(beforeReuse).map(call => call.method)).toEqual(["GET"]);
    expect(await readdir(scratch)).toEqual([]);
    expect(await readFile(sourceFile)).toEqual(original);
    const beforeDenied = calls.length;
    await expect(prepareStoredReviewVideo(source, { ...options, authorize: async () => false })).rejects.toMatchObject({ code: "unsupported" });
    expect(calls.length).toBe(beforeDenied);
    const changed = { ...source, etag: '"new-version"' };
    expect(reviewVideoIdentity(changed)).not.toBe(result.identity);
    await expect(prepareStoredReviewVideo(changed, options)).rejects.toMatchObject({ code: "source-changed" });
    expect(encodes).toBe(1);
    expect(await readdir(scratch)).toEqual([]);
    const changedOwner = { ...source, ownerId: "github-other" };
    failSuffix = ".jpg";
    await expect(storePreparedReviewVideo(changedOwner, encoded!, storage)).rejects.toThrow();
    expect([...objects.keys()].filter(key => key.includes("/github-other/") && key.endsWith("ready.json"))).toEqual([]);
    failSuffix = "";
    // A duplicate publisher keeps the existing manifest and all content-addressed objects.
    expect(await storePreparedReviewVideo(source, encoded!, storage)).toEqual(result);
    const proxyKey = `/stack-structure/${result.artifacts.proxy}`, proxy = objects.get(proxyKey)!;
    objects.set(proxyKey, { ...proxy, metadata: {} });
    await expect(storePreparedReviewVideo(source, encoded!, storage)).rejects.toThrow("content binding");
    objects.set(proxyKey, proxy);
    const manifestKey = [...objects.keys()].find(key => key.endsWith("ready.json"))!;
    const manifest = objects.get(manifestKey)!;
    const malicious = JSON.parse(manifest.bytes.toString()); malicious.artifacts.proxy = sourceKey;
    objects.set(manifestKey, { ...manifest, bytes: Buffer.from(JSON.stringify(malicious)) });
    await expect(readPreparedReviewVideo(source, storage)).rejects.toThrow("binding");
  } finally {
    client.destroy(); server.closeAllConnections(); server.close();
    if (!resolve(folder).startsWith(root + sep)) throw new Error("Test cleanup escaped workspace.");
    await rm(folder, { recursive: true, force: true });
  }
}, 60_000);
