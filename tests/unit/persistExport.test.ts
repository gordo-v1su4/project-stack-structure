import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { persistExport } from "@/trigger/export";
import type { MediaGatewayUploadResult, uploadFileToMediaGateway } from "@/lib/mediaGateway";

const env = { MEDIA_GATEWAY_URL: "https://media.example", MEDIA_GATEWAY_TOKEN: "test-only-token", MEDIA_GATEWAY_BUCKET: "studio" };
const storage: MediaGatewayUploadResult = { bucket: "studio", objectKey: "media-uploads/generated/exports/final.mp4", storagePath: "media-uploads/generated/exports/final.mp4", publicUrl: "https://media.example/final.mp4", mime: "video/mp4" };
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
      expect(folder).toBe("media-uploads/generated/exports/song-export");
      return storage;
    };
    const result = await persistExport(filePath, "song-export", "final.mp4", metadata, upload, env);
    expect(result).toMatchObject({ ...metadata, requestKey: "song-export", videoUrl: storage.publicUrl, downloadFileName: "final.mp4", storage });
  });
});

test("gateway upload failure fails export instead of claiming a worker-local download", async () => {
  await withRenderedFile(async filePath => {
    await expect(persistExport(filePath, "song-export", "final.mp4", metadata, async () => { throw new Error("Gateway unavailable"); }, env)).rejects.toThrow("Gateway unavailable");
  });
});

test("export rejects temporary storage, the wrong bucket, missing keys and non-HTTPS downloads", async () => {
  await withRenderedFile(async filePath => {
    for (const invalid of [
      { ...storage, bucket: "local-fallback" },
      { ...storage, objectKey: "" },
      { ...storage, publicUrl: "http://worker.example/tmp/final.mp4" },
      { ...storage, publicUrl: "https://" },
      { ...storage, publicUrl: "https://userinfo:password@media.example/final.mp4" },
    ]) {
      await expect(persistExport(filePath, "song-export", "final.mp4", metadata, async () => invalid, env)).rejects.toThrow("durable storage");
    }
  });
});
