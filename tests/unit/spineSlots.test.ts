import { describe, expect, test } from "bun:test";
import type { GeneratedStudioAsset } from "../../src/components/studio/generatedAssets";
import type { EditPlanPreviewSegment, MusicVideoProject } from "../../src/components/studio/musicVideoProject";
import { buildSpineSlots, describeSlot, neighborSlot, slotAtTime } from "../../src/components/studio/shell/spineSlots";

const segments: EditPlanPreviewSegment[] = [
  { videoUrl: "blob:a", startTime: 0, endTime: 2, label: "Verse · wide", sectionId: "s1", musicStart: 0, musicEnd: 2, momentId: "m1", thumbnailUrl: "t1" },
  { videoUrl: "/api/storage/media?bucket=b&objectKey=gen.mp4", startTime: 0, endTime: 2, label: "Gen replacement", sectionId: "s1", musicStart: 2, musicEnd: 4 },
  { videoUrl: "blob:c", startTime: 1, endTime: 3, label: "Chorus · close", sectionId: "s2", musicStart: 4, musicEnd: 6, momentId: "m2" },
];

const project = {
  storySections: [
    {
      id: "s1", label: "verse", start: 0, end: 4, prompt: "", source: "analysis", lyricChunkIds: [], videoMomentIds: ["m1", "m3"],
      semanticMatch: { momentId: "m1", score: 0.8, semanticScore: 0.7, lyricCaptionScore: 0.9, actionIntentScore: 0.5, durationFitScore: 1, motionContinuityScore: 0.6, motionEnergyScore: 0.4, repetitionPenalty: 0, reasons: ["lyric match"] },
      candidateMatches: [
        { momentId: "m1", score: 0.8, semanticScore: 0.7, lyricCaptionScore: 0.9, actionIntentScore: 0.5, durationFitScore: 1, motionContinuityScore: 0.6, motionEnergyScore: 0.4, repetitionPenalty: 0, reasons: ["lyric match"] },
        { momentId: "m3", score: 0.6, semanticScore: 0.6, lyricCaptionScore: 0.5, actionIntentScore: 0.5, durationFitScore: 0.9, motionContinuityScore: 0.5, motionEnergyScore: 0.4, repetitionPenalty: 0, reasons: ["alternate"] },
      ],
    },
    { id: "s2", label: "chorus", start: 4, end: 8, prompt: "", source: "analysis", lyricChunkIds: [], videoMomentIds: ["m2"] },
  ],
  videoMoments: [
    { id: "m1", sourceClipId: 1, label: "wide street", start: 0, end: 2, duration: 2, caption: "A wide street at dusk" },
    { id: "m2", sourceClipId: 1, label: "close face", start: 1, end: 3, duration: 2 },
    { id: "m3", sourceClipId: 2, label: "alley", start: 0, end: 2, duration: 2 },
  ],
  lyricChunks: [{ id: "l1", text: "love me tonight", start: 0.5, end: 1.5 }],
  editPlan: { id: "p", createdAt: "", timelineItems: [{ id: "t1", sectionId: "s1", lyricChunkIds: [], videoMomentId: "m1", start: 0, end: 4, label: "", prompt: "" }] },
} as unknown as MusicVideoProject;

const generated: GeneratedStudioAsset[] = [
  {
    id: "g1", provider: "swarmui", model: "wan", prompt: "night alley", createdAt: "2026-09-05T00:00:00Z", status: "completed", mediaKind: "video", reviewStatus: "approved",
    fullStorage: { bucket: "b", objectKey: "gen.mp4" } as GeneratedStudioAsset["fullStorage"],
  },
];

describe("buildSpineSlots", () => {
  test("labels approved generated shots and keeps footage slots", () => {
    const slots = buildSpineSlots({ segments, project, generatedAssets: [] });
    expect(slots.map((slot) => slot.kind)).toEqual(["footage", "footage", "footage"]);
    expect(slots[0]?.sectionLabel).toBe("verse");
    expect(slots[0]?.duration).toBe(2);
  });

  test("recognizes generated slots by their playback URL", () => {
    const [, gen] = buildSpineSlots({ segments, project, generatedAssets: generated });
    expect(gen?.kind).toBe("generated");
    expect(gen?.generatedAssetId).toBe("g1");
  });

  test("slot ids are stable for the same cut and unique across cuts", () => {
    const first = buildSpineSlots({ segments, project, generatedAssets: [] });
    const second = buildSpineSlots({ segments, project, generatedAssets: [] });
    expect(first.map((slot) => slot.id)).toEqual(second.map((slot) => slot.id));
    expect(new Set(first.map((slot) => slot.id)).size).toBe(first.length);
  });
});

describe("describeSlot", () => {
  test("collects the moment, caption, lyric, score and alternates", () => {
    const [slot] = buildSpineSlots({ segments, project, generatedAssets: [] });
    const evidence = describeSlot(slot!, { project, generatedAssets: [] });
    expect(evidence.moment?.id).toBe("m1");
    expect(evidence.caption).toBe("A wide street at dusk");
    expect(evidence.lyrics).toEqual(["love me tonight"]);
    expect(evidence.match?.score).toBe(0.8);
    expect(evidence.takes.map((take) => [take.moment.id, take.selected])).toEqual([["m1", true], ["m3", false]]);
  });

  test("attaches the generated asset to generated slots", () => {
    const slots = buildSpineSlots({ segments, project, generatedAssets: generated });
    const evidence = describeSlot(slots[1]!, { project, generatedAssets: generated });
    expect(evidence.generated?.id).toBe("g1");
    expect(evidence.moment).toBeNull();
  });
});

describe("slot navigation", () => {
  const slots = buildSpineSlots({ segments, project, generatedAssets: [] });

  test("slotAtTime finds the cut under the playhead", () => {
    expect(slotAtTime(slots, 4.5)?.sectionId).toBe("s2");
    expect(slotAtTime(slots, 99)).toBeNull();
  });

  test("neighborSlot steps and clamps", () => {
    expect(neighborSlot(slots, null, 1)?.index).toBe(0);
    expect(neighborSlot(slots, slots[0]!.id, 1)?.index).toBe(1);
    expect(neighborSlot(slots, slots[2]!.id, 1)?.index).toBe(2);
    expect(neighborSlot(slots, slots[0]!.id, -1)?.index).toBe(0);
  });
});
