import { test, expect } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { generateMusicVideoExport, generateShaderCaptureMp4Export } from "@/components/studio/exportGeneration";
import { probeMediaFile } from "@/components/studio/mediaProbe";
const exec = promisify(execFile);

// Different frequencies prove soundtrack content, not merely an audio stream or UI toggle.
test("real exports keep the master, add only opted-in source windows, and preserve inputs", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "clip-audio-contract-"));
  const song = path.join(dir, "song.wav"), clip = path.join(dir, "clip.mp4"), silent = path.join(dir, "silent.mp4");
  const ff = async (args: string[]) => { await exec("ffmpeg", ["-v", "error", "-y", ...args]); };
  const hash = async (file: string) => createHash("sha256").update(await readFile(file)).digest("hex");
  const amplitude = (samples: Float32Array, start: number, frequency: number) => {
    let sine = 0, cosine = 0; const length = 12000, first = Math.round(start * 48000);
    for (let i = 0; i < length; i++) { const sample = samples[first + i] ?? 0; const phase = 2 * Math.PI * frequency * i / 48000; sine += sample * Math.sin(phase); cosine += sample * Math.cos(phase); }
    return 2 * Math.hypot(sine, cosine) / length;
  };
  try {
    await ff(["-f", "lavfi", "-i", "sine=frequency=440:duration=4:sample_rate=48000", song]);
    await ff(["-f", "lavfi", "-i", "color=c=blue:s=64x64:r=24:d=3", "-f", "lavfi", "-i", "sine=frequency=880:duration=3:sample_rate=48000", "-c:v", "libx264", "-c:a", "aac", "-shortest", clip]);
    await ff(["-i", clip, "-an", "-c:v", "copy", silent]);
    const before = await Promise.all([song, clip, silent].map(hash));
    for (const mode of ["off", "on", "shader"] as const) {
      const outputPath = path.join(dir, `${mode}.mp4`);
      const segments = [
        { inputPath: clip, startTime: 0.5, endTime: 1.5, musicStart: 1, musicEnd: 2 },
        { inputPath: clip, startTime: 1.5, endTime: 2.5, musicStart: 2, musicEnd: 3, useClipAudio: mode !== "off" },
        { inputPath: silent, startTime: 0, endTime: 1, musicStart: 3, musicEnd: 4, useClipAudio: true },
      ];
      if (mode === "shader") await generateShaderCaptureMp4Export({ requestKey: `audio-${mode}`, shaderCapturePath: silent, audioPath: song, segments, outputPath, probeFn: probeMediaFile });
      else await generateMusicVideoExport({ requestKey: `audio-${mode}`, audioPath: song, segments, outputPath, probeFn: probeMediaFile, shaderPresetId: "none" });
      const raw = path.join(dir, `${mode}.f32`);
      await ff(["-i", outputPath, "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-f", "f32le", raw]);
      const bytes = await readFile(raw); const samples = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      for (const start of [0.3, 1.3, 2.3]) expect(amplitude(samples, start, 440)).toBeGreaterThan(0.06);
      expect(amplitude(samples, 0.3, 880)).toBeLessThan(0.003);
      expect(amplitude(samples, 2.3, 880)).toBeLessThan(0.003);
      if (mode === "off") expect(amplitude(samples, 1.3, 880)).toBeLessThan(0.003);
      else expect(amplitude(samples, 1.3, 880)).toBeGreaterThan(0.05);
    }
    expect(await Promise.all([song, clip, silent].map(hash))).toEqual(before);
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 60000);
