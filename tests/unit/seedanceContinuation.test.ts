import { describe, expect, test } from "bun:test";

import { buildSeedanceContinuationPacket, serializeSeedanceContinuationPacket } from "@/components/studio/seedanceContinuation";
import type { GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import type { ReferenceAsset } from "@/components/studio/referenceAssets";

const referenceAssets: ReferenceAsset[] = [
  {
    id: "diego",
    role: "character-1",
    kind: "character",
    displayName: "Diego",
    fileName: "diego.png",
    previewUrl: "https://media.example/diego.png",
    promptHint: "Do not replace this person.",
    storageProvider: "rustfs",
    storagePath: "refs/diego.png",
    storageUrl: "https://media.example/diego.png",
    storageStatus: "uploaded",
    createdAt: "2026-08-27T00:00:00.000Z",
  },
  {
    id: "club",
    role: "environment",
    kind: "environment",
    displayName: "Underground Club",
    fileName: "club.png",
    previewUrl: "https://media.example/club.png",
    promptHint: "Keep this location.",
    storageProvider: "rustfs",
    storagePath: "refs/club.png",
    storageUrl: "https://media.example/club.png",
    storageStatus: "uploaded",
    createdAt: "2026-08-27T00:00:00.000Z",
  },
];

const contactSheet: GeneratedStudioAsset = {
  id: "grid",
  provider: "higgsfield",
  model: "nano_banana_2",
  title: "Verse progression grid",
  prompt: "grid",
  createdAt: "2026-08-27T00:00:00.000Z",
  status: "completed",
  fullStorage: {
    bucket: "media",
    objectKey: "generated/grid.png",
    storagePath: "generated/grid.png",
    publicUrl: "https://media.example/grid.png",
    mediaUrl: "https://media.example/grid.png",
    mime: "image/png",
  },
};

describe("Seedance continuation packet", () => {
  test("uses the accepted last frame first and gives every reference one bounded role", () => {
    const packet = buildSeedanceContinuationPacket({
      projectId: "project-1",
      sectionId: "verse-2",
      sectionLabel: "Verse 2",
      storyIntent: "Diego discovers a new room beyond the hallway",
      songStart: 42,
      songEnd: 57,
      moment: {
        id: "hallway-7",
        sourceClipId: 2,
        sourceRefLabel: "S3 · Scene 02",
        label: "Hallway walk",
        start: 4,
        end: 8,
        duration: 4,
        lastFrameUrl: "https://media.example/hallway-last.jpg",
        captionMeta: { action: "Diego walks through the hallway" },
      },
      referenceAssets,
      referenceSelection: { character1Id: "diego", environmentId: "club" },
      contactSheet,
      audioVideoReference: {
        tag: "@Video_1",
        role: "section-audio-timing",
        label: "Verse 2 timing reference",
        url: "https://media.example/verse-2-audio.mp4",
        instruction: "@Video_1 controls song audio, rhythm, lyric timing, and lip-sync timing only. Ignore its black picture.",
        clipRange: { start: 40, end: 59 },
        sectionRange: { start: 42, end: 57 },
        sectionOffset: { start: 2, end: 17 },
        handleSeconds: { before: 2, after: 2 },
        placementKey: "audio:42:57",
      },
    });

    expect(packet.errors).toEqual([]);
    expect(packet.references.map((reference) => [reference.tag, reference.role])).toEqual([
      ["@Image_1", "accepted-final-frame"],
      ["@Image_2", "character-identity"],
      ["@Image_3", "environment"],
      ["@Image_4", "contact-sheet"],
    ]);
    expect(packet.resolution).toBe("720p");
    expect(packet.prompt).toContain("without restarting or replaying Diego walks through the hallway");
    expect(packet.prompt).toContain("one clearly new, readable action");
    expect(packet.prompt).toContain("@Video_1 controls song audio, rhythm, lyric timing, and lip-sync timing only");
    expect(packet.prompt).not.toContain("song is added in post");
    expect(packet.references[1]?.instruction).toContain("identity and wardrobe for Diego only");
    expect(packet.prompt).not.toContain("red plaid shirt");
    const serialized = serializeSeedanceContinuationPacket(packet);
    expect(serialized).toContain("Project: project-1 · Clip: verse-2-continuation-42.00");
    expect(serialized).toContain("@Video_1 | section-audio-timing");
    expect(serialized).toContain("selected section occurs at 2.00–17.00 inside Video_1");
  });

  test("blocks a speculative continuation when the selected shot has no durable final frame", () => {
    const packet = buildSeedanceContinuationPacket({
      projectId: "project-1",
      sectionId: "verse-2",
      sectionLabel: "Verse 2",
      storyIntent: "advance",
      songStart: 42,
      songEnd: 57,
      moment: { id: "local", sourceClipId: 0, label: "Local only", start: 0, end: 2, duration: 2, lastFrameUrl: "blob:last" },
      referenceAssets: [],
      referenceSelection: {},
    });

    expect(packet.errors).toEqual(["The selected source moment has no durable last frame. Finish scene processing before preparing a continuation."]);
    expect(packet.references).toEqual([]);
  });
});
