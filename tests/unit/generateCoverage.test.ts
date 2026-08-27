import { describe, expect, test } from "bun:test";

import { buildCoverageSlots, summarizeCoverage } from "@/components/studio/panels/GenerateTab";
import type { MusicVideoProject, SemanticClipMatch, TimelineItem, VideoMoment } from "@/components/studio/musicVideoProject";

function match(momentId: string, score: number): SemanticClipMatch {
  return {
    momentId,
    score,
    semanticScore: score,
    lyricCaptionScore: score,
    actionIntentScore: score,
    durationFitScore: 1,
    motionContinuityScore: score,
    motionEnergyScore: score,
    repetitionPenalty: 0,
    reasons: [],
  };
}

function project(item: TimelineItem, moment?: VideoMoment): MusicVideoProject {
  return {
    id: "project-1",
    song: null,
    duration: item.end,
    lyricChunks: [],
    storySections: [],
    videoMoments: moment ? [moment] : [],
    editPlan: { id: "edit-1", timelineItems: [item], createdAt: "2026-08-27T00:00:00.000Z" },
    reviewFindings: [],
  };
}

const chunks = [
  { id: "cue-1", sectionId: "intro", sectionLabel: "Intro", start: 0, end: 5, strength: 0.5, cueCount: 1 },
  { id: "cue-2", sectionId: "intro", sectionLabel: "Intro", start: 5, end: 10, strength: 0.5, cueCount: 1 },
];

describe("Generate coverage truth", () => {
  test("counts weak assigned footage as real coverage and optional review, not missing duration", () => {
    const moment: VideoMoment = { id: "moment-1", sourceClipId: 0, label: "Scene 1", start: 0, end: 10, duration: 10 };
    const item: TimelineItem = {
      id: "item-1",
      sectionId: "intro",
      lyricChunkIds: [],
      videoMomentId: moment.id,
      start: 0,
      end: 10,
      label: "Intro",
      prompt: "Opening",
      semanticMatch: match(moment.id, 0.31),
    };

    const slots = buildCoverageSlots(project(item, moment), chunks);
    const summary = summarizeCoverage(slots, 10);

    expect(slots.map((slot) => slot.status)).toEqual(["weak", "weak"]);
    expect(slots.map((slot) => slot.missingDuration)).toEqual([0, 0]);
    expect(summary).toMatchObject({
      requiredDuration: 10,
      assignedDuration: 10,
      trueGapDuration: 0,
      weakMatchDuration: 10,
      coveragePct: 100,
      strongMatchPct: 0,
      requiredNeedCount: 0,
      reviewCount: 2,
    });
  });

  test("keeps unassigned and physically short footage in the required queue", () => {
    const missingItem: TimelineItem = {
      id: "item-missing",
      sectionId: "intro",
      lyricChunkIds: [],
      videoMomentId: null,
      start: 0,
      end: 10,
      label: "Intro",
      prompt: "Opening",
    };
    const missingSlots = buildCoverageSlots(project(missingItem), chunks);

    expect(summarizeCoverage(missingSlots, 10)).toMatchObject({
      assignedDuration: 0,
      trueGapDuration: 10,
      requiredNeedCount: 2,
      reviewCount: 0,
    });

    const shortMoment: VideoMoment = { id: "moment-short", sourceClipId: 0, label: "Short scene", start: 0, end: 3, duration: 3 };
    const shortItem = { ...missingItem, videoMomentId: shortMoment.id, semanticMatch: match(shortMoment.id, 0.9) };
    const shortSlots = buildCoverageSlots(project(shortItem, shortMoment), [chunks[0]!]);

    expect(shortSlots[0]).toMatchObject({ status: "short", assignedDuration: 3, missingDuration: 2 });
    expect(summarizeCoverage(shortSlots, 5)).toMatchObject({ trueGapDuration: 2, requiredNeedCount: 1 });
  });
});
