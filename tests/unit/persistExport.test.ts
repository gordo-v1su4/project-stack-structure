import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { persistExport, validateExportDispatchOwner } from "@/trigger/export";
import { mediaUploadBelongsToOwner } from "@/lib/essentiaUpload";
import type { MediaGatewayUploadResult, uploadFileToMediaGateway } from "@/lib/mediaGateway";

const env = { MEDIA_GATEWAY_URL: "https://media.example", MEDIA_GATEWAY_TOKEN: "test-only-token", MEDIA_GATEWAY_BUCKET: "studio" };
const ownerId = "github-test-owner";
const objectKey = `media-uploads/${ownerId}/generated/exports/song-export/upload-id/final.mp4`;
const storage: MediaGatewayUploadResult = { bucket: "studio", objectKey, storagePath: objectKey, publicUrl: "https://media.example/final.mp4", mime: "video/mp4" };
const metadata = { duration: 240, hasAudio: true, hasVideo: true, shaderPresetId: "clean" };

async function withRenderedFile(run: (filePath: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "persist-export-test-"));
  try {
    const filePath = path.join(directory, "rendered.mp4");
    await writeFile(filePath, "rendered-fixture");
    await run(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("export completion returns a durable configured-bucket HTTPS download", async () => {
  await withRenderedFile(async filePath => {
    const upload: typeof uploadFileToMediaGateway = async ({ file, folder }) => {
      expect(file.type).toBe("video/mp4");
      expect(await file.text()).toBe("rendered-fixture");
      expect(folder).toBe(`media-uploads/${ownerId}/generated/exports/song-export`);
      return storage;
    };
    const result = await persistExport(filePath, "song-export", "final.mp4", metadata, ownerId, upload, env);
    expect(result).toMatchObject({ ...metadata, requestKey: "song-export", videoUrl: storage.publicUrl, downloadFileName: "final.mp4", storage });
    expect(mediaUploadBelongsToOwner(result.storage.objectKey, ownerId)).toBe(true);
    expect(mediaUploadBelongsToOwner(result.storage.objectKey, "other-owner")).toBe(false);
  });
});

test("gateway upload failure fails export instead of claiming a worker-local download", async () => {
  await withRenderedFile(async filePath => {
    await expect(persistExport(filePath, "song-export", "final.mp4", metadata, ownerId, async () => { throw new Error("Gateway unavailable"); }, env)).rejects.toThrow("Gateway unavailable");
  });
});

test("export rejects temporary storage, the wrong bucket, missing keys and non-HTTPS downloads", async () => {
  await withRenderedFile(async filePath => {
    for (const invalid of [
      { ...storage, bucket: "local-fallback" },
      { ...storage, objectKey: "" },
      { ...storage, objectKey: objectKey.replace(ownerId, "other-owner") },
      { ...storage, objectKey: "media-uploads/generated/exports/song-export/final.mp4" },
      { ...storage, objectKey: objectKey.replace("song-export/", "another-request/") },
      { ...storage, objectKey: objectKey.replace("upload-id/", "../") },
      { ...storage, objectKey: objectKey.replace("upload-id/", "%2e%2e/") },
      { ...storage, storagePath: objectKey.replace(ownerId, "other-owner") },
      { ...storage, publicUrl: "http://worker.example/tmp/final.mp4" },
      { ...storage, publicUrl: "https://" },
      { ...storage, publicUrl: "https://userinfo:password@media.example/final.mp4" },
    ]) {
      await expect(persistExport(filePath, "song-export", "final.mp4", metadata, ownerId, async () => invalid, env)).rejects.toThrow("durable storage");
    }
  });
});

test("both worker payload kinds require one exact authenticated owner before processing", () => {
  for (const payload of [{ ownerId }, { ownerId, shaderCapture: {} }]) {
    expect(() => validateExportDispatchOwner(payload, [`user:${ownerId}`, "export"])).not.toThrow();
    for (const tags of [[], ["user:other-owner"], [`user:${ownerId}`, "user:other-owner"], [`user:${ownerId}`, `user:${ownerId}`]]) {
      expect(() => validateExportDispatchOwner(payload, tags)).toThrow("matching authenticated owner");
    }
    expect(() => validateExportDispatchOwner({ ...payload, ownerId: undefined as unknown as string }, [`user:${ownerId}`])).toThrow("authenticated dispatch owner");
  }
  expect(() => validateExportDispatchOwner({ ownerId, projectSnapshot: { ownerId: "other-owner" } as never }, [`user:${ownerId}`])).toThrow("matching authenticated owner");
});

test("invalid owner or rewritten upload prefix cannot create an unowned upload", async () => {
  let uploads = 0;
  const upload: typeof uploadFileToMediaGateway = async () => { uploads++; return storage; };
  await expect(persistExport("not-read", "song-export", "final.mp4", metadata, "", upload, env)).rejects.toThrow("authenticated dispatch owner");
  await expect(persistExport("not-read", "song-export", "final.mp4", metadata, ownerId, upload,
    { ...env, MEDIA_GATEWAY_UPLOAD_PREFIX: "other-prefix" })).rejects.toThrow("canonical owner-scoped upload prefix");
  expect(uploads).toBe(0);
});
