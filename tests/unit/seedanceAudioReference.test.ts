import { describe, expect, test } from "bun:test";

import {
  buildSeedanceAudioPlacementKey,
  resolveSeedanceAudioReferenceWindow,
  validateSeedanceAudioSource,
  validateSeedanceVideoReference,
} from "@/components/studio/seedanceAudioReference";

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

describe("Seedance audio-reference media validation", () => {
  test("rejects a restored master object with no audio stream", () => {
    const error = captureError(() => validateSeedanceAudioSource({ duration: 246, size: 377, hasAudio: false, hasVideo: false }, { clipEnd: 170 }));
    expect(error?.message.includes("does not contain an audio stream")).toBe(true);
  });

  test("rejects an empty Video_1 container", () => {
    const error = captureError(() => validateSeedanceVideoReference({ duration: 0, size: 377, hasAudio: false, hasVideo: false }, { duration: 7 }));
    expect(error?.message.includes("must contain both")).toBe(true);
  });

  test("accepts a complete black-video timing reference", () => {
    expect(captureError(() => validateSeedanceVideoReference({ duration: 7, size: 280_000, hasAudio: true, hasVideo: true }, { duration: 7 }))).toBe(null);
  });
});

function captureError(run: () => void) {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}
