import { describe, expect, test } from "bun:test";

import { isCaptionContextReady } from "@/components/studio/ingestLanes";
import { isStudioCaptionContextReady } from "@/components/studio/mediaUpload";
import type { ReferenceAsset } from "@/components/studio/referenceAssets";

const readyReferences: ReferenceAsset[] = [
  {
    id: "char-1",
    role: "character-1",
    kind: "character",
    displayName: "Char 1",
    fileName: "char1.png",
    previewUrl: "https://example.com/char1.png",
    promptHint: "",
    storageStatus: "uploaded",
    storageUrl: "https://example.com/char1.png",
    storagePath: "reference-assets/character-1/char1.png",
    storageProvider: "rustfs",
    storageBucket: "stack-structure",
    storageError: null,
    createdAt: "2026-09-06T00:00:00.000Z",
  },
  {
    id: "env-1",
    role: "environment",
    kind: "environment",
    displayName: "Club",
    fileName: "club.png",
    previewUrl: "https://example.com/club.png",
    promptHint: "",
    storageStatus: "uploaded",
    storageUrl: "https://example.com/club.png",
    storagePath: "reference-assets/environment/club.png",
    storageProvider: "rustfs",
    storageBucket: "stack-structure",
    storageError: null,
    createdAt: "2026-09-06T00:00:00.000Z",
  },
];

describe("caption context gate", () => {
  test("requires vocal transcript and Char 1 + environment references", () => {
    expect(isCaptionContextReady({
      hasLyricTranscript: false,
      referenceAssets: readyReferences,
    })).toBe(false);

    expect(isCaptionContextReady({
      hasLyricTranscript: true,
      referenceAssets: [],
    })).toBe(false);

    expect(isStudioCaptionContextReady({
      hasLyricTranscript: true,
      referenceAssets: readyReferences,
    })).toBe(true);
  });
});
