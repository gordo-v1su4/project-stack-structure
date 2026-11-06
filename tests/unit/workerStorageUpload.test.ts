import { expect, test } from "bun:test";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand, S3Client, UploadPartCommand, type S3ClientConfig } from "@aws-sdk/client-s3";
import { MAX_WORKER_UPLOAD_BYTES, WORKER_UPLOAD_PART_BYTES, uploadWorkerFileToStorage } from "@/lib/workerStorageUpload";

const env = {
  MEDIA_GATEWAY_URL: "https://media.example", MEDIA_GATEWAY_TOKEN: "test-only-token", MEDIA_GATEWAY_BUCKET: "studio",
  RUSTFS_S3_ENDPOINT: "https://storage.example", RUSTFS_ACCESS_KEY: "test-access", RUSTFS_SECRET_KEY: "test-secret",
};
const folder = "media-uploads/generated/exports/song";

async function withFile(size: number, run: (filePath: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "worker-upload-test-"));
  const filePath = path.join(directory, "final.mp4");
  try {
    await writeFile(filePath, "");
    const file = await open(filePath, "r+");
    try { await file.truncate(size); } finally { await file.close(); }
    await run(filePath);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

function fakeClient(options: { failPart?: boolean; noUploadId?: boolean; noEtag?: boolean } = {}) {
  const calls: string[] = [];
  const parts: number[] = [];
  let completed: unknown;
  let destroyed = false;
  const clientFactory = (config: S3ClientConfig) => {
    expect(config.endpoint).toBe(env.RUSTFS_S3_ENDPOINT);
    expect(config.forcePathStyle).toBe(true);
    return {
      async send(command: unknown) {
        if (command instanceof CreateMultipartUploadCommand) { calls.push("create"); expect(command.input.Bucket).toBe("studio"); return { UploadId: options.noUploadId ? undefined : "upload-1" }; }
        if (command instanceof UploadPartCommand) {
          calls.push("part"); parts.push(command.input.ContentLength!);
          expect((command.input.Body as Buffer).byteLength).toBe(command.input.ContentLength!);
          if (options.failPart) throw new Error("Part unavailable");
          return { ETag: options.noEtag ? undefined : `etag-${command.input.PartNumber}` };
        }
        if (command instanceof CompleteMultipartUploadCommand) { calls.push("complete"); completed = command.input.MultipartUpload; return {}; }
        if (command instanceof AbortMultipartUploadCommand) { calls.push("abort"); return {}; }
        throw new Error("Unexpected storage operation");
      },
      destroy() { destroyed = true; },
    } as unknown as S3Client;
  };
  return { clientFactory, calls, parts, get completed() { return completed; }, get destroyed() { return destroyed; } };
}

function verify(size: number): typeof fetch {
  return (async (url, init) => {
    expect(String(url).startsWith("https://media.example/files/studio/media-uploads/generated/exports/song/")).toBe(true);
    expect(init?.method).toBe("HEAD");
    return new Response(null, { headers: { "content-length": String(size), "content-type": "video/mp4" } });
  }) as typeof fetch;
}

test("large worker exports upload sequential bounded S3 parts and verify the durable object", async () => {
  const size = WORKER_UPLOAD_PART_BYTES + 7;
  await withFile(size, async filePath => {
    const client = fakeClient();
    const result = await uploadWorkerFileToStorage({ filePath, fileName: "final.mp4", folder, env, clientFactory: client.clientFactory, fetchImpl: verify(size), gatewayUpload: async () => { throw new Error("Large output must bypass gateway body upload"); } });
    expect(client.calls).toEqual(["create", "part", "part", "complete"]);
    expect(client.parts).toEqual([WORKER_UPLOAD_PART_BYTES, 7]);
    expect(client.completed).toEqual({ Parts: [{ PartNumber: 1, ETag: "etag-1" }, { PartNumber: 2, ETag: "etag-2" }] });
    expect(client.destroyed).toBe(true);
    expect(result.bucket).toBe("studio");
    expect(result.mediaUrl?.startsWith("https://media.example/files/studio/")).toBe(true);
    expect(result.objectKey.startsWith(`${folder}/`)).toBe(true);
  });
});

test("small gateway rejections can fall back to configured direct storage", async () => {
  await withFile(15, async filePath => {
    const client = fakeClient();
    const result = await uploadWorkerFileToStorage({ filePath, fileName: "final.mp4", folder, env, clientFactory: client.clientFactory, fetchImpl: verify(15), gatewayUpload: async () => { throw new Error("Gateway body rejected"); } });
    expect(client.calls).toEqual(["create", "part", "complete"]);
    expect(result.bucket).toBe("studio");
  });
});

test("an unconfigured direct path preserves the original gateway failure", async () => {
  await withFile(15, async filePath => {
    const gatewayEnv = { MEDIA_GATEWAY_URL: env.MEDIA_GATEWAY_URL, MEDIA_GATEWAY_TOKEN: env.MEDIA_GATEWAY_TOKEN, MEDIA_GATEWAY_BUCKET: env.MEDIA_GATEWAY_BUCKET };
    await expect(uploadWorkerFileToStorage({ filePath, fileName: "final.mp4", folder, env: gatewayEnv, gatewayUpload: async () => { throw new Error("Gateway unavailable"); }, clientFactory: () => { throw new Error("Direct storage must not be attempted"); } })).rejects.toThrow("Gateway unavailable");
  });
});

test("failed parts and missing storage acknowledgments abort rather than claim a final asset", async () => {
  await withFile(15, async filePath => {
    for (const options of [{ failPart: true }, { noEtag: true }, { noUploadId: true }]) {
      const client = fakeClient(options);
      await expect(uploadWorkerFileToStorage({ filePath, fileName: "final.mp4", folder, env, clientFactory: client.clientFactory, fetchImpl: verify(15), gatewayUpload: async () => { throw new Error("Gateway rejected"); } })).rejects.toThrow();
      expect(client.calls).not.toContain("complete");
      if (!options.noUploadId) expect(client.calls.at(-1)).toBe("abort");
      expect(client.destroyed).toBe(true);
    }
  });
});

test("wrong final storage length cannot produce success after multipart completion", async () => {
  await withFile(15, async filePath => {
    const client = fakeClient();
    await expect(uploadWorkerFileToStorage({ filePath, fileName: "final.mp4", folder, env, clientFactory: client.clientFactory, fetchImpl: verify(14), gatewayUpload: async () => { throw new Error("Gateway rejected"); } })).rejects.toThrow("verification");
    expect(client.calls).toContain("complete");
    expect(client.destroyed).toBe(true);
  });
});

test("oversized or empty output fails before any network request", async () => {
  for (const size of [0, MAX_WORKER_UPLOAD_BYTES + 1]) await withFile(size, async filePath => {
    await expect(uploadWorkerFileToStorage({ filePath, fileName: "final.mp4", folder, env, gatewayUpload: async () => { throw new Error("Must not upload"); } })).rejects.toThrow("2 GiB");
  });
});

test("direct worker uploads reject plaintext storage endpoints", async () => {
  await withFile(15, async filePath => {
    await expect(uploadWorkerFileToStorage({ filePath, fileName: "final.mp4", folder, env: { ...env, RUSTFS_S3_ENDPOINT: "http://storage.example" }, gatewayUpload: async () => { throw new Error("Gateway rejected"); } })).rejects.toThrow("HTTPS");
  });
});
