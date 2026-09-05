import { describe, expect, test } from "bun:test";

import { buildCoverageIssueGroups, buildCoverageSlots, describeCoverageIssue, summarizeCoverage, analyzeEditPlanCoverage } from "@/components/studio/editPlanCoverage";
import type { GeneratedStudioAsset } from "@/components/studio/generatedAssets";
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
      reviewSectionCount: 1,
    });

    const issues = buildCoverageIssueGroups(slots);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      status: "weak",
      sectionId: "intro",
      sectionLabel: "Intro",
      start: 0,
      end: 10,
      requiredDuration: 10,
      assignedDuration: 10,
      missingDuration: 0,
    });
    expect(issues[0]?.slots).toHaveLength(2);
    expect(describeCoverageIssue(issues[0]!)).toContain("All 2 chunks contain real footage, so generation is optional.");
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
    const missingIssues = buildCoverageIssueGroups(missingSlots);
    expect(missingIssues).toHaveLength(1);
    expect(describeCoverageIssue(missingIssues[0]!)).toBe("No source scene is assigned from 0:00 to 0:10. This is a true gap and must be filled before Join.");

    const shortMoment: VideoMoment = { id: "moment-short", sourceClipId: 0, label: "Short scene", start: 0, end: 3, duration: 3 };
    const shortItem = { ...missingItem, videoMomentId: shortMoment.id, semanticMatch: match(shortMoment.id, 0.9) };
    const shortSlots = buildCoverageSlots(project(shortItem, shortMoment), [chunks[0]!]);

    expect(shortSlots[0]).toMatchObject({ status: "short", assignedDuration: 3, missingDuration: 2 });
    expect(summarizeCoverage(shortSlots, 5)).toMatchObject({
      trueGapDuration: 2,
      requiredNeedCount: 0,
      blockingGapCount: 0,
      shortReviewCount: 1,
    });
    const shortIssues = buildCoverageIssueGroups(shortSlots);
    expect(describeCoverageIssue(shortIssues[0]!)).toBe("The assigned source covers 0:03 of 0:05, leaving 0:02 uncovered. Inspect the resolved edit and, if needed, regenerate the whole shot with handles.");
  });

  test("approved generated replacement clears a true gap for Join gating", () => {
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
    const baseProject = project(missingItem);
    const approvedAsset: GeneratedStudioAsset = {
      id: "gen-1",
      provider: "higgsfield",
      model: "Seedance 2.0",
      prompt: "Approved replacement",
      createdAt: "2026-09-05T00:00:00.000Z",
      status: "completed",
      mediaKind: "video",
      reviewStatus: "approved",
      target: {
        timelineItemId: missingItem.id,
        sectionId: missingItem.sectionId,
        sectionLabel: missingItem.label,
        songStart: missingItem.start,
        songEnd: missingItem.end,
      },
    };

    expect(analyzeEditPlanCoverage(baseProject, [], []).trueGapCount).toBe(1);
    expect(analyzeEditPlanCoverage(baseProject, [], [approvedAsset]).trueGapCount).toBe(0);
    expect(summarizeCoverage(buildCoverageSlots(baseProject, [], [approvedAsset]), 10)).toMatchObject({
      blockingGapCount: 0,
      requiredNeedCount: 0,
    });
  });
});
