import { describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { POST } from "@/app/api/export/shader-capture/route";
import { listMediaFixtures } from "../helpers/mediaFixtures";

async function fileFromPath(path: string, type: string) {
  const bytes = await readFile(path);
  const name = path.split(/[\\/]/).pop() ?? "fixture";
  return new File([bytes], name, { type });
}

describe("POST /api/export/shader-capture", () => {
  test("muxes a browser shader-capture video with master audio into downloadable MP4", async () => {
    const inventory = listMediaFixtures();
    const audioPath = inventory.audio[0];
    const videoPath = inventory.video[0];

    expect(Boolean(audioPath)).toBe(true);
    expect(Boolean(videoPath)).toBe(true);

    const tempDir = await makeTinyExportFixtures(audioPath!, videoPath!);

    const form = new FormData();
    form.set("audio", await fileFromPath(path.join(tempDir, "audio.wav"), "audio/wav"));
    form.set("shaderCapture", await fileFromPath(path.join(tempDir, "capture.mp4"), "video/mp4"));
    form.set("requestKey", "route-webgpu-capture-export-test");

    const response = await POST(new Request("http://localhost/api/export/shader-capture", { method: "POST", body: form }));
    const payload = await response.json() as {
      success?: boolean;
      error?: string;
      asset?: {
        videoUrl?: string;
        downloadFileName?: string;
        hasAudio?: boolean;
        hasVideo?: boolean;
        shaderRenderSource?: string;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.error).toBe(undefined);
    expect(payload.success).toBe(true);
    expect(payload.asset?.videoUrl).toContain("/api/preview/asset?assetKey=");
    expect(payload.asset?.downloadFileName).toBe("route-webgpu-capture-export-test.mp4");
    expect(payload.asset?.hasAudio).toBe(true);
    expect(payload.asset?.hasVideo).toBe(true);
    expect(payload.asset?.shaderRenderSource).toBe("browser-webgpu-capture");

    await rm(tempDir, { recursive: true, force: true });
  });
});

async function makeTinyExportFixtures(audioPath: string, videoPath: string) {
  const tempDir = path.join(tmpdir(), `stack-shader-capture-test-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });
  const audioOut = path.join(tempDir, "audio.wav");
  const videoOut = path.join(tempDir, "capture.mp4");

  const audio = spawnSync("ffmpeg", ["-y", "-i", audioPath, "-t", "0.75", "-ac", "1", "-ar", "24000", audioOut], { stdio: "ignore" });
  if (audio.status !== 0) throw new Error("Could not create tiny audio fixture for shader capture export test.");

  const video = spawnSync("ffmpeg", ["-y", "-i", videoPath, "-t", "0.75", "-an", "-vf", "scale=320:-2", videoOut], { stdio: "ignore" });
  if (video.status !== 0) throw new Error("Could not create tiny video fixture for shader capture export test.");

  return tempDir;
}
