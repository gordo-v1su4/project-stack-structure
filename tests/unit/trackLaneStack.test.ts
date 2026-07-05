import { describe, expect, test } from "bun:test";

import { createMusicVideoProject } from "@/components/studio/musicVideoProject";
import { selectStorySectionCandidate } from "@/components/studio/musicVideoProjectSelection";
import {
  buildTrackLaneStack,
  deriveVisibleTrackLaneRows,
  inferFootageLane,
  type FootageLaneRole,
} from "@/components/studio/trackLaneStack";
import type { BeatJoinAnalysis, UploadedVideoSource } from "@/components/studio/types";

function analysis(): BeatJoinAnalysis {
  return {
    sourceLabel: "song.wav",
    audioUrl: "blob:song",
    waveform: [0.1, 0.4, 0.8],
    energy: [0.2, 0.7, 0.9],
    beats: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    onsets: [0.5, 2.5, 4.5, 6.5],
    sections: [
      { label: "Verse", start: 0, end: 4, energy: 0.4 },
      { label: "Chorus", start: 4, end: 8, energy: 0.9 },
    ],
    duration: 8,
  };
}

function videoSources(): UploadedVideoSource[] {
  return [
    {
      id: 0,
      name: "performance_lip_sync_camera_a.mov",
      duration: 8,
      size: 10,
      thumbnailUrl: "thumb-a",
      videoUrl: "blob:a",
      scenes: [
        {
          id: 0,
          sourceClipId: 0,
          label: "Singer close",
          start: 0,
          end: 4,
          duration: 4,
          detector: "pyscenedetect-adaptive",
          caption: "Close-up of the singer lip syncing into a microphone under blue light.",
          captionMeta: { subjects: ["singer"], action: "singing", shotType: "close-up" },
          captionSource: "lfm-webgpu",
          firstFrameUrl: "first-a",
          lastFrameUrl: "last-a",
        },
      ],
    },
    {
      id: 1,
      name: "camera_b_alt_angle.mov",
      duration: 8,
      size: 10,
      thumbnailUrl: "thumb-b",
      videoUrl: "blob:b",
      scenes: [
        {
          id: 0,
          sourceClipId: 1,
          label: "Alt singer angle",
          start: 0,
          end: 4,
          duration: 4,
          detector: "pyscenedetect-adaptive",
          caption: "Alternate side angle of the artist performing the hook.",
          captionMeta: { subjects: ["artist"], action: "performance", shotType: "side angle" },
          captionSource: "lfm-webgpu",
        },
      ],
    },
    {
      id: 2,
      name: "rain_city_broll.mp4",
      duration: 8,
      size: 10,
      thumbnailUrl: "thumb-c",
      videoUrl: "blob:c",
      scenes: [
        {
          id: 0,
          sourceClipId: 2,
          label: "Rain street",
          start: 0,
          end: 4,
          duration: 4,
          detector: "pyscenedetect-adaptive",
          caption: "B-roll of neon city rain and empty wet streets.",
          captionMeta: { setting: "night city", weather: "rain", action: "street motion" },
          captionSource: "lfm-webgpu",
        },
      ],
    },
  ];
}

function sourceNameMap(sources: UploadedVideoSource[]) {
  return new Map(sources.map((source) => [source.id, source.name]));
}

describe("track lane inference", () => {
  test("uses source names and captions to classify performance, camera b, and b-roll", () => {
    const sources = videoSources();
    const performance = sources[0].scenes?.[0];
    const cameraB = sources[1].scenes?.[0];
    const broll = sources[2].scenes?.[0];
    if (!performance || !cameraB || !broll) throw new Error("missing scenes");

    expect(inferFootageLane({ moment: { ...performance, id: "a" }, sourceName: sources[0].name }).role).toBe("performance");
    expect(inferFootageLane({ moment: { ...cameraB, id: "b" }, sourceName: sources[1].name }).role).toBe("camera-b");
    expect(inferFootageLane({ moment: { ...broll, id: "c" }, sourceName: sources[2].name }).role).toBe("b-roll");
  });
});

describe("buildTrackLaneStack", () => {
  test("builds lane rows from ranked section candidates without persisting source names", () => {
    const sources = videoSources();
    const project = createMusicVideoProject({
      analysis: analysis(),
      duration: 8,
      storyDrafts: [
        { id: "verse", label: "Verse", prompt: "singer close-up performance" },
        { id: "chorus", label: "Chorus", prompt: "rain city hook performance" },
      ],
      lyricChunks: [
        { index: 1, start: 0, end: 2, text: "sing to me" },
        { index: 2, start: 4, end: 6, text: "hook in the rain" },
      ],
      videoSources: sources,
      createdAt: "2026-07-04T00:00:00.000Z",
    });

    const stack = buildTrackLaneStack({ project, sourceNameByClipId: sourceNameMap(sources) });
    const performance = stack.rows.find((row) => row.definition.role === "performance");
    const cameraB = stack.rows.find((row) => row.definition.role === "camera-b");
    const broll = stack.rows.find((row) => row.definition.role === "b-roll");

    expect(stack.summary.sectionCount).toBe(2);
    expect(stack.summary.blockCount).toBeGreaterThan(2);
    expect(performance?.blocks.length).toBeGreaterThan(0);
    expect(cameraB?.blocks.some((block) => block.sourceLabel.includes("camera_b_alt_angle.mov"))).toBe(true);
    expect(broll?.blocks.some((block) => block.shuffleHint.toLowerCase().includes("cover"))).toBe(true);
    expect("sourceName" in project.videoMoments[0]).toBe(false);
  });

  test("visible row logic keeps solo local and collapsed rows preserve live blocks", () => {
    const stack = buildTrackLaneStack({ project: null });
    const visible = deriveVisibleTrackLaneRows({
      rows: stack.rows,
      mutedRoles: new Set<FootageLaneRole>(["b-roll"]),
      soloRole: "performance",
      collapsedRoles: new Set<FootageLaneRole>(["effects"]),
    });

    expect(visible).toHaveLength(stack.rows.length);
    expect(visible.find((row) => row.definition.role === "performance")?.soloed).toBe(true);
    expect(visible.find((row) => row.definition.role === "b-roll")?.muted).toBe(true);
    expect(visible.find((row) => row.definition.role === "effects")?.collapsed).toBe(true);

    const effectsDefinition = stack.rows.find((row) => row.definition.role === "effects")?.definition;
    if (!effectsDefinition) throw new Error("missing effects definition");
    const collapsed = deriveVisibleTrackLaneRows({
      rows: [{
        definition: effectsDefinition,
        selectedCount: 1,
        backupCount: 2,
        blocks: [
          { id: "backup-a", role: "effects", sectionId: "a", sectionLabel: "A", momentId: "a", selected: false, rank: 1, score: 0.8, laneConfidence: 0.9, laneReasons: ["effects"], matchReasons: [], start: 0, end: 1, sourceStart: 0, sourceEnd: 1, sourceClipId: 0, sourceLabel: "S1", caption: "backup", title: "backup", headHandle: "0.0s", tailHandle: "1.0s", shuffleHint: "backup" },
          { id: "live", role: "effects", sectionId: "b", sectionLabel: "B", momentId: "live", selected: true, rank: 4, score: 0.5, laneConfidence: 0.8, laneReasons: ["effects"], matchReasons: [], start: 1, end: 2, sourceStart: 1, sourceEnd: 2, sourceClipId: 0, sourceLabel: "S1", caption: "live", title: "live", headHandle: "1.0s", tailHandle: "2.0s", shuffleHint: "live" },
          { id: "backup-b", role: "effects", sectionId: "c", sectionLabel: "C", momentId: "c", selected: false, rank: 2, score: 0.7, laneConfidence: 0.9, laneReasons: ["effects"], matchReasons: [], start: 2, end: 3, sourceStart: 2, sourceEnd: 3, sourceClipId: 0, sourceLabel: "S1", caption: "backup", title: "backup", headHandle: "2.0s", tailHandle: "3.0s", shuffleHint: "backup" },
        ],
      }],
      collapsedRoles: new Set<FootageLaneRole>(["effects"]),
    });
    expect(collapsed[0].blocks.map((block) => block.id)).toEqual(["live"]);
  });

  test("candidate selected from a lane block updates the existing match source of truth", () => {
    const sources = videoSources();
    const project = createMusicVideoProject({
      analysis: analysis(),
      duration: 8,
      storyDrafts: [{ id: "chorus", label: "Chorus", prompt: "rain city hook performance" }],
      lyricChunks: [{ index: 1, start: 4, end: 6, text: "hook in the rain" }],
      videoSources: sources,
      createdAt: "2026-07-04T00:00:00.000Z",
    });
    const stack = buildTrackLaneStack({ project, sourceNameByClipId: sourceNameMap(sources) });
    const backup = stack.rows.flatMap((row) => row.blocks).find((block) => !block.selected);
    if (!backup) throw new Error("Expected a backup lane block");

    const selected = selectStorySectionCandidate(project, { sectionId: backup.sectionId, momentId: backup.momentId });
    expect(selected.editPlan.timelineItems.find((item) => item.sectionId === backup.sectionId)?.videoMomentId).toBe(backup.momentId);

    const restacked = buildTrackLaneStack({ project: selected, sourceNameByClipId: sourceNameMap(sources) });
    const selectedBlocks = restacked.rows.flatMap((row) => row.blocks).filter((block) => block.sectionId === backup.sectionId && block.selected);
    expect(selectedBlocks.map((block) => block.momentId)).toEqual([backup.momentId]);
  });
});
