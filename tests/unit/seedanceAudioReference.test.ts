import { describe, expect, test } from "bun:test";

import { buildSeedanceAudioPlacementKey, resolveSeedanceAudioReferenceWindow } from "@/components/studio/seedanceAudioReference";

describe("Seedance audio timing reference", () => {
  test("adds two-second handles around a placed section", () => {
    expect(resolveSeedanceAudioReferenceWindow({ songStart: 42, songEnd: 57, songDuration: 246 })).toEqual({
      clipStart: 40,
      clipEnd: 59,
      duration: 19,
      handleBefore: 2,
      handleAfter: 2,
      sectionStartOffset: 2,
      sectionEndOffset: 17,
    });
  });

  test("clamps handles at the master-song boundaries", () => {
    expect(resolveSeedanceAudioReferenceWindow({ songStart: 0.5, songEnd: 9, songDuration: 10 })).toEqual({
      clipStart: 0,
      clipEnd: 10,
      duration: 10,
      handleBefore: 0.5,
      handleAfter: 1,
      sectionStartOffset: 0.5,
      sectionEndOffset: 9,
    });
  });

  test("changes placement identity when the selected edit range moves", () => {
    const first = buildSeedanceAudioPlacementKey({ audioObjectKey: "media-uploads/song.wav", songStart: 42, songEnd: 57, songDuration: 246 });
    const moved = buildSeedanceAudioPlacementKey({ audioObjectKey: "media-uploads/song.wav", songStart: 43, songEnd: 58, songDuration: 246 });
    expect(first).not.toBe(moved);
  });

  test("rejects invalid or out-of-song windows", () => {
    let reversedError: unknown;
    let outOfSongError: unknown;
    try {
      resolveSeedanceAudioReferenceWindow({ songStart: 10, songEnd: 9, songDuration: 246 });
    } catch (error) {
      reversedError = error;
    }
    try {
      resolveSeedanceAudioReferenceWindow({ songStart: 240, songEnd: 247, songDuration: 246 });
    } catch (error) {
      outOfSongError = error;
    }
    expect(reversedError instanceof Error).toBe(true);
    expect(outOfSongError instanceof Error).toBe(true);
  });
});
