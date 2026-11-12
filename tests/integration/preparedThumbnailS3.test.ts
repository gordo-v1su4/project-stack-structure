import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import sharp from "sharp";

test("raw WebP survives a web-process restart through the actual S3 SDK wire protocol", async () => {
  const root = resolve(".tmp/thumbnail-s3-tests");
  await mkdir(root, { recursive: true });
  const folder = await mkdtemp(join(root, "run-"));
  const file = join(folder, "source.png");
  const original = await sharp({ create: { width: 1280, height: 720, channels: 3, background: "#35221b" } }).png().toBuffer();
  const sourceSha256 = createHash("sha256").update(original).digest("hex");
  await writeFile(file, original);
  const objects = new Map<string, { bytes: Uint8Array; headers: Record<string, string> }>();
  const calls: string[] = [];
  const server = createServer(async (request, response) => {
    const key = new URL(request.url!, "http://127.0.0.1").pathname;
    calls.push(request.method!);
    if (request.method === "PUT") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      const headers: Record<string, string> = { "content-type": request.headers["content-type"] ?? "", etag: '"fixture-object"' };
      for (const [name, value] of Object.entries(request.headers)) if (name.startsWith("x-amz-meta-") && typeof value === "string") headers[name] = value;
      objects.set(key, { bytes, headers });
      response.writeHead(200, headers); response.end(); return;
    }
    const object = objects.get(key);
    if (!object) { response.writeHead(404, { "content-type": "application/xml" }); response.end("<Error><Code>NoSuchKey</Code></Error>"); return; }
    response.writeHead(200, object.headers); response.end(object.bytes);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const run = async (mode: string) => {
      const inputFile = mode === "reload" ? join(folder, "source-unavailable.png") : file;
      const child = spawn(process.execPath, [resolve("tests/helpers/thumbnailProcess.ts"), `http://127.0.0.1:${port}`, inputFile, mode, sourceSha256], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      child.stdout.on("data", data => { stdout += String(data); });
      child.stderr.on("data", data => { stderr += String(data); });
      const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      if (code !== 0) throw new Error(`Thumbnail child failed: ${stderr.slice(0, 2000)}`);
      return JSON.parse(stdout) as { loads: number; durable: boolean; bytes: number; etag: string; sha256: string };
    };
    const first = await run("prepare"), second = await run("reload");
    expect(first.loads).toBe(1); expect(second.loads).toBe(0);
    expect(first.durable).toBe(true); expect(second.durable).toBe(true);
    expect(second.sha256).toBe(first.sha256); expect(second.etag).toBe(first.etag);
    expect(first.bytes).toBeLessThan(original.byteLength);
    expect(calls).toEqual(["GET", "PUT", "GET"]);
    expect(objects.size).toBe(1);
    const [key, artifact] = [...objects.entries()][0];
    expect(key).toContain("/stack-structure/media-uploads/projects/thumbnail-fixture/review-thumbnails/");
    expect(key.endsWith("/320.webp")).toBe(true);
    expect((await sharp(artifact.bytes).metadata()).width).toBe(320);
    expect(createHash("sha256").update(await readFile(file)).digest("hex"))
      .toBe(createHash("sha256").update(original).digest("hex"));
  } finally {
    server.closeAllConnections(); server.close();
    if (!resolve(folder).startsWith(root + sep)) throw new Error("Test cleanup escaped its workspace.");
    await rm(folder, { recursive: true, force: true });
  }
}, 15_000);
