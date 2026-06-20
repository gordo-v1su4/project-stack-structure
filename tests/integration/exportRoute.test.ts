import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { POST } from "@/app/api/export/final/route";
import { listMediaFixtures } from "../helpers/mediaFixtures";

async function fileFromPath(path: string, type: string) {
  const bytes = await readFile(path);
  const name = path.split(/[\\/]/).pop() ?? "fixture";
  return new File([bytes], name, { type });
}

describe("POST /api/export/final", () => {
  test("renders a downloadable final export from multipart media, beats, lyrics, and a shader preset", async () => {
    const inventory = listMediaFixtures();
    const audioPath = inventory.audio[0];
    const videoPath = inventory.video[0];

    expect(Boolean(audioPath)).toBe(true);
    expect(Boolean(videoPath)).toBe(true);

    const form = new FormData();
    form.set("audio", await fileFromPath(audioPath!, "audio/wav"));
    form.set("file:0", await fileFromPath(videoPath!, "video/mp4"));
    form.set("requestKey", "route-final-export-test");
    form.set("shaderPresetId", "high-energy-glitch");
    form.set("segments", JSON.stringify([{ sourceIndex: 0, startTime: 0, endTime: 1, musicStart: 0, musicEnd: 1, label: "Intro" }]));
    form.set("beats", JSON.stringify([0, 0.5]));
    form.set("lyricChunks", JSON.stringify([{ id: "lyric-1", start: 0.1, end: 0.8, text: "love me tonight" }]));

    const response = await POST(new Request("http://localhost/api/export/final", { method: "POST", body: form }));
    const payload = await response.json() as {
      success?: boolean;
      error?: string;
      asset?: {
        videoUrl?: string;
        downloadFileName?: string;
        hasAudio?: boolean;
        hasVideo?: boolean;
        effectCues?: Array<{ presetId?: string; sync?: string }>;
        shaderPresetId?: string;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.error).toBe(undefined);
    expect(payload.success).toBe(true);
    expect(payload.asset?.videoUrl).toContain("/api/preview/asset?assetKey=");
    expect(payload.asset?.downloadFileName).toBe("route-final-export-test.mp4");
    expect(payload.asset?.hasAudio).toBe(true);
    expect(payload.asset?.hasVideo).toBe(true);
    expect(payload.asset?.shaderPresetId).toBe("high-energy-glitch");
    expect(payload.asset?.effectCues?.some((cue) => cue.sync === "beat" && cue.presetId === "glitch-cut")).toBe(true);
  });
});
