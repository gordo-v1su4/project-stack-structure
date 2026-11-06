import { describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { probeMediaFile } from "@/components/studio/mediaProbe";
import { generateConcatPreview, assertEncodedVideoFrameBudget, type ProbeFn } from "@/components/studio/previewGeneration";
import { generateMusicVideoExport } from "@/components/studio/exportGeneration";

const exec = promisify(execFile), ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const probe: ProbeFn = async file => { const result = await probeMediaFile(file); return { duration: result.duration, hasVideo: result.hasVideo, hasAudio: result.hasAudio }; };
// The first row burns a binary frame ID into nine large tiles. Digits beneath
// it make the same ID legible during visual fixture inspection, without fonts.
const digits = ["111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001", "111100111001111", "111100111101111", "111001001001001", "111101111101111", "111101111001111"];
async function fixture(folder: string) {
  const width = 160, height = 90, count = 289, bytes = Buffer.alloc(width * height * 3 * count, 30);
  const box = (frame: number, x: number, y: number, w: number, h: number, value: number) => {
    for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) {
      const offset = ((frame * height + row) * width + col) * 3; bytes.fill(value, offset, offset + 3);
    }
  };
  for (let frame = 0; frame < count; frame++) {
    for (let bit = 0; bit < 9; bit++) box(frame, 4 + bit * 16, 4, 12, 20, (frame >> bit) & 1 ? 235 : 15);
    for (const [position, digit] of String(frame).padStart(3, "0").split("").entries()) {
      for (let index = 0; index < 15; index++) if (digits[Number(digit)][index] === "1") box(frame, 12 + position * 40 + index % 3 * 8, 36 + Math.floor(index / 3) * 8, 7, 7, 235);
    }
  }
  const raw = path.join(folder, "numbered.rgb"), video = path.join(folder, "numbered.mp4"), audio = path.join(folder, "master.wav");
  await writeFile(raw, bytes);
  await exec(ffmpeg, ["-y", "-v", "error", "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", "160x90", "-framerate", "24", "-i", raw,
    "-c:v", "libx264", "-crf", "0", "-pix_fmt", "yuv444p", video]);
  await exec(ffmpeg, ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2", "-c:a", "pcm_s16le", audio]);
  return { video, audio };
}
async function frameIds(file: string, seek?: number, frameCount?: number) {
  const { stdout } = await exec(ffmpeg, ["-v", "error", ...(seek === undefined ? [] : ["-ss", String(seek)]), "-i", file,
    ...(frameCount === undefined ? [] : ["-frames:v", String(frameCount)]), "-vf", "fps=24,scale=160:90:flags=neighbor", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
  { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 });
  const result: number[] = [];
  for (let offset = 0; offset < stdout.length; offset += 160 * 90) {
    let id = 0; for (let bit = 0; bit < 9; bit++) if (stdout[offset + 12 * 160 + 10 + bit * 16] > 128) id |= 1 << bit;
    result.push(id);
  }
  return result;
}
describe("actual encoded music-video frame timing", () => {
  test("holds only one EOF frame and keeps every following cut on the global budget", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "export-eof-"));
    try {
      const { video } = await fixture(folder);
      // Exact non-frame-aligned source6 regression:289frames, seek10.667, budget33.
      expect((await frameIds(video, 10.667, 33)).length).toBe(32);
      const outputPath = path.join(folder, "fixed.mp4");
      await generateConcatPreview({ segments: [{ inputPath: video, startTime: 10.667, endTime: 12.042 },
        { inputPath: video, startTime: 0, endTime: .5 }], requestKey: "eof", outputPath, probeFn: probe });
      const ids = await frameIds(outputPath);
      expect(ids.length).toBe(45); expect(ids.slice(0, 32)).toEqual(Array.from({ length: 32 }, (_, i) => 257 + i));
      expect(ids[32]).toBe(288); expect(ids[33]).toBe(0);
      await assertEncodedVideoFrameBudget(outputPath, 45);
      await expect(generateConcatPreview({ segments: [{ inputPath: video, startTime: 11.5, endTime: 13 }],
        requestKey: "truncated", outputPath: path.join(folder, "bad.mp4"), probeFn: probe })).rejects.toThrow("beyond its source");
    } finally { await rm(folder, { recursive: true, force: true }); }
  }, 120_000);
  test("canonical rounded .042 trim exports verified decoded frame1, while ordinary seeking retains its semantics", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "export-proof-frames-"));
    try {
      const { video } = await fixture(folder), outputPath = path.join(folder, "canonical.mp4");
      expect((await frameIds(video, .042, 1))[0]).toBe(2);
      const segment = { inputPath: video, startTime: .042, endTime: .542,
        sourceFrameWindow: { startFrame: 1, endFrameExclusive: 14, frameRate: 24 as const, totalFrames: 289 } };
      await generateConcatPreview({ segments: [segment], requestKey: "verified", outputPath, probeFn: probe });
      expect(await frameIds(outputPath)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
      await generateConcatPreview({ segments: [{ inputPath: video, startTime: .042, endTime: .542 }],
        requestKey: "ordinary", outputPath: path.join(folder, "ordinary.mp4"), probeFn: probe });
      expect((await frameIds(path.join(folder, "ordinary.mp4")))[0]).toBe(2);
      await expect(generateConcatPreview({ segments: [{ ...segment, sourceFrameWindow: { ...segment.sourceFrameWindow, endFrameExclusive: 12 } }],
        requestKey: "outside-proof", outputPath: path.join(folder, "bad.mp4"), probeFn: probe })).rejects.toThrow("verified decoded frame interval");
    } finally { await rm(folder, { recursive: true, force: true }); }
  }, 120_000);
  test("final master mux preserves the total frame budget and refuses a materially shorter master", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "export-master-bound-"));
    try {
      const { video, audio } = await fixture(folder);
      const result = await generateMusicVideoExport({ segments: [{ inputPath: video, startTime: 10.667, endTime: 12.042, musicStart: 0, musicEnd: 1.375 },
        { inputPath: video, startTime: 0, endTime: .5, musicStart: 1.375, musicEnd: 1.875 }], audioPath: audio,
        requestKey: "master", outputPath: path.join(folder, "final.mp4"), probeFn: probe });
      expect(Math.abs(result.duration - 1.875)).toBeLessThan(1 / 24);
      await assertEncodedVideoFrameBudget(result.outputPath, 45);
      const shortAudio = path.join(folder, "short.wav");
      await exec(ffmpeg, ["-y", "-v", "error", "-i", audio, "-t", "0.2", shortAudio]);
      await expect(generateMusicVideoExport({ segments: [{ inputPath: video, startTime: 0, endTime: 1 }], audioPath: shortAudio,
        requestKey: "short-master", outputPath: path.join(folder, "bad-final.mp4"), probeFn: probe })).rejects.toThrow();
    } finally { await rm(folder, { recursive: true, force: true }); }
  }, 120_000);
  test("ordinary variable-rate footage keeps time-based seeking rather than H3 decoded-index semantics", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "export-vfr-"));
    try {
      const { video } = await fixture(folder), vfr = path.join(folder, "variable-rate.mp4"), outputPath = path.join(folder, "vfr-cut.mp4");
      await exec(ffmpeg, ["-y", "-v", "error", "-i", video, "-frames:v", "36", "-vf",
        "setpts=if(lt(N\\,12)\\,N/(12*TB)\\,1+(N-12)/(24*TB))", "-fps_mode", "vfr", "-c:v", "libx264", "-crf", "0", vfr]);
      const expected = await frameIds(vfr, .625, 12);
      await generateConcatPreview({ segments: [{ inputPath: vfr, startTime: .625, endTime: 1.125 }],
        requestKey: "ordinary-vfr", outputPath, probeFn: probe });
      expect(await frameIds(outputPath)).toEqual(expected);
      expect(expected.length).toBe(12);
    } finally { await rm(folder, { recursive: true, force: true }); }
  }, 120_000);
});
