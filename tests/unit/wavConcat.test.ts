import { describe, expect, test } from "bun:test";

import { concatWavChunks, sliceWavFromSeconds } from "@/lib/wavSlice";

function buildWav(dataBytes: Uint8Array): Uint8Array {
  const sampleRate = 8000;
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const writeTag = (offset: number, tag: string) => {
    for (let index = 0; index < 4; index += 1) header[offset + index] = tag.charCodeAt(index);
  };
  writeTag(0, "RIFF");
  view.setUint32(4, 36 + dataBytes.length, true);
  writeTag(8, "WAVE");
  writeTag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeTag(36, "data");
  view.setUint32(40, dataBytes.length, true);
  const out = new Uint8Array(44 + dataBytes.length);
  out.set(header, 0);
  out.set(dataBytes, 44);
  return out;
}

describe("concatWavChunks", () => {
  test("merges split parts into one valid RIFF with summed data size", () => {
    const partA = buildWav(new Uint8Array(2000).fill(1));
    const partB = buildWav(new Uint8Array(1500).fill(2));
    const merged = concatWavChunks([partA, partB]);
    expect(merged).not.toBeNull();

    const view = new DataView(merged!.buffer);
    const riffSize = view.getUint32(4, true);
    const dataSize = view.getUint32(40, true);
    expect(riffSize).toBe(merged!.length - 8);
    expect(dataSize).toBe(3500);
    expect(merged!.length).toBe(44 + 3500);
    expect(merged![44 + 2000]).toBe(2);
    expect(merged![44]).toBe(1);
  });

  test("returns null for non-WAV payloads", () => {
    expect(concatWavChunks([new Uint8Array(50).fill(7)])).toBeNull();
  });

  test("single part round-trips byte-identical", () => {
    const part = buildWav(new Uint8Array(100).fill(3));
    const merged = concatWavChunks([part]);
    expect(merged).not.toBeNull();
    expect(merged).toEqual(part);
  });

  test("merged output stays sliceable by the existing WAV slicer", () => {
    const merged = concatWavChunks([buildWav(new Uint8Array(4000).fill(1)), buildWav(new Uint8Array(4000).fill(2))]);
    expect(merged).not.toBeNull();
    const sliced = sliceWavFromSeconds(merged!, 0.25);
    expect(sliced).not.toBeNull();
    expect(sliced!.length).toBeLessThan(merged!.length);
  });
});
