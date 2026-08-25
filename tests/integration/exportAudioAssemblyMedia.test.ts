import { describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  assembleWindowedMasterAudio,
  generateMusicVideoExport,
  type MasterAudioSlice,
} from "@/components/studio/exportGeneration";
import { probeMediaFile } from "@/components/studio/mediaProbe";
import { createTempPreviewPath } from "@/components/studio/previewGeneration";
import { listMediaFixtures, mediaFixtureTest } from "../helpers/mediaFixtures";

const execFileAsync = promisify(execFile);

const fixtures = listMediaFixtures();
const masterAudio =
  fixtures.audio.find((entry) => path.basename(entry) === "real-master-song.wav") ?? fixtures.audio[0];
const videoA = fixtures.video.find((entry) => path.basename(entry).includes("video-a")) ?? fixtures.video[0];
const videoB = fixtures.video.find((entry) => path.basename(entry).includes("video-b")) ?? fixtures.video[1];

type ParsedWav = { sampleRate: number; channels: number; samples: Float32Array };

function parseWavPcm16(buffer: Buffer): ParsedWav {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);  let offset = 12;
  let sampleRate = 44100;
  let channels = 1;
  let dataStart = -1;
  let dataLength = 0;
  while (offset + 8 <= view.byteLength) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === "fmt ") {
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
    }
    if (chunkId === "data") {
      dataStart = offset + 8;
      dataLength = Math.min(chunkSize, view.byteLength - dataStart);
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  if (dataStart < 0) throw new Error("WAV data chunk not found");

  const frameCount = Math.floor(dataLength / (2 * channels));
  const samples = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let accumulator = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      accumulator += view.getInt16(dataStart + (frame * channels + channel) * 2, true);
    }
    samples[frame] = accumulator / channels / 32768;
  }
  return { sampleRate, channels, samples };
}

function rmsEnvelope(audio: ParsedWav, windowSeconds = 0.05): Float32Array {
  const windowFrames = Math.max(1, Math.floor(audio.sampleRate * windowSeconds));
  const windows = Math.floor(audio.samples.length / windowFrames);
  const envelope = new Float32Array(windows);
  for (let index = 0; index < windows; index += 1) {
    let sumSquares = 0;
    const base = index * windowFrames;
    for (let frame = 0; frame < windowFrames; frame += 1) {
      const value = audio.samples[base + frame]!;
      sumSquares += value * value;
    }
    envelope[index] = Math.sqrt(sumSquares / windowFrames);
  }
  return envelope;
}

function pearson(left: Float32Array | number[], right: Float32Array | number[]): number {
  const length = Math.min(left.length, right.length);
  if (!length) return 0;
  let sumLeft = 0;
  let sumRight = 0;
  for (let index = 0; index < length; index += 1) {
    sumLeft += left[index]!;
    sumRight += right[index]!;
  }
  const meanLeft = sumLeft / length;
  const meanRight = sumRight / length;
  let numerator = 0;
  let denomLeft = 0;
  let denomRight = 0;
  for (let index = 0; index < length; index += 1) {
    const deltaLeft = left[index]! - meanLeft;
    const deltaRight = right[index]! - meanRight;
    numerator += deltaLeft * deltaRight;
    denomLeft += deltaLeft * deltaLeft;
    denomRight += deltaRight * deltaRight;
  }
  return numerator / (Math.sqrt(denomLeft * denomRight) || 1);
}

async function extractReferenceSlice(audioPath: string, slice: MasterAudioSlice, outputPath: string) {
  await execFileAsync("ffmpeg", [
    "-y",
    "-i", audioPath,
    "-ss", `${slice.start}`,
    "-to", `${slice.end}`,
    "-vn",
    "-c:a", "pcm_s16le",
    outputPath,
  ]);
  return parseWavPcm16(await readFile(outputPath));
}

describe("windowed master-audio assembly on real media", () => {
  const fixtureTest = mediaFixtureTest(Boolean(masterAudio && videoA && videoB));

  fixtureTest("assembled slices match per-slice references in order and total duration", async () => {
    const slices: MasterAudioSlice[] = [
      { start: 5, end: 9 },
      { start: 40, end: 42.5 },
      { start: 20, end: 23 },
    ];
    const workspace = await mkdtemp(path.join(tmpdir(), "export-assembly-media-"));
    try {
      const assembledPath = path.join(workspace, "assembled.wav");
      await assembleWindowedMasterAudio({ audioPath: masterAudio, slices, outputPath: assembledPath });

      const assembled = parseWavPcm16(await readFile(assembledPath));
      const expectedSeconds = slices.reduce((total, slice) => total + (slice.end - slice.start), 0);
      const actualSeconds = assembled.samples.length / assembled.sampleRate;
      expect(Math.abs(actualSeconds - expectedSeconds)).toBeLessThan(0.15);

      const references = [];
      for (const [index, slice] of slices.entries()) {
        references.push(await extractReferenceSlice(masterAudio, slice, path.join(workspace, `ref-${index}.wav`)));
      }

      // Walk the assembled output in slice order and compare each chunk's RMS envelope.
      let cursorFrames = 0;
      for (const [index, reference] of references.entries()) {
        const chunkLength = reference.samples.length;
        const chunk = assembled.samples.subarray(cursorFrames, cursorFrames + chunkLength);
        cursorFrames += chunkLength;

        const correlation = pearson(rmsEnvelope({ ...assembled, samples: chunk }), rmsEnvelope(reference));
        expect(correlation).toBeGreaterThan(0.97);

        // Order proof: this chunk must correlate far better with its own reference than with any other.
        for (const [otherIndex, other] of references.entries()) {
          if (otherIndex === index) continue;
          expect(correlation).toBeGreaterThan(pearson(rmsEnvelope({ ...assembled, samples: chunk }), rmsEnvelope(other)) + 0.05);
        }
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }, 120_000);

  fixtureTest("full export muxes the ordered slice audio under concatenated video; no-window input stays legacy", async () => {
    if (!masterAudio || !videoA || !videoB) throw new Error("fixtures required");

    const exportProbeFn = async (filePath: string) => {
      const result = await probeMediaFile(filePath);
      return { duration: result.duration, hasVideo: result.hasVideo, hasAudio: result.hasAudio };
    };
    const outputPath = createTempPreviewPath("final-export-windowed-media");
    try {
      const asset = await generateMusicVideoExport({
        requestKey: "final-export-windowed-media",
        audioPath: masterAudio,
        outputPath,
        segments: [
          { inputPath: videoA, startTime: 0, endTime: 1, musicStart: 30, musicEnd: 31, label: "A" },
          { inputPath: videoB, startTime: 0, endTime: 1, musicStart: 45, musicEnd: 46, label: "B" },
        ],
        effectCues: [
          { id: "section-0", kind: "duotone-pulse", start: 0, end: 1, intensity: 0.65, sync: "section" },
          { id: "beat-0", kind: "glitch-cut", start: 1, end: 1.2, intensity: 0.85, sync: "beat" },
        ],
        probeFn: exportProbeFn,
      });

      expect(asset.audioMode).toBe("windowed-slices");
      expect(path.basename(asset.audioPath)).toContain("export-audio");
      const metadata = await probeMediaFile(asset.outputPath);
      expect(metadata.hasVideo).toBe(true);
      expect(metadata.hasAudio).toBe(true);
      expect(Math.abs(metadata.duration - 2)).toBeLessThan(0.35);

      const legacyPath = createTempPreviewPath("final-export-legacy-media");
      try {
        const legacyAsset = await generateMusicVideoExport({
          requestKey: "final-export-legacy-media",
          audioPath: masterAudio,
          outputPath: legacyPath,
          segments: [{ inputPath: videoA, startTime: 0, endTime: 0.8 }],
          probeFn: exportProbeFn,
        });
        expect(legacyAsset.audioMode).toBe("legacy-from-zero");
        expect(path.basename(legacyAsset.audioPath)).not.toContain("export-audio");
      } finally {
        await rm(legacyPath, { force: true });
      }
    } finally {
      await rm(outputPath, { force: true });
    }
  }, 240_000);
});
