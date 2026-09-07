import { describe, expect, test } from "bun:test";

import { buildCoverageIssueGroups, buildCoverageSlots, describeCoverageIssue, summarizeCoverage, analyzeEditPlanCoverage } from "@/components/studio/editPlanCoverage";
import type { GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import { DEFAULT_STORY_EDIT_SETTINGS, placementInputSignature, type MusicVideoProject, type SemanticClipMatch, type TimelineItem, type VideoMoment } from "@/components/studio/musicVideoProject";

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
    const moment: VideoMoment = { id: "moment-1", sourceClipId: 0, label: "Scene 1", start: 0, end: 10, duration: 10, caption: "Diego dancing alone in the club" };
    const item: TimelineItem = {
      id: "item-1",
      sectionId: "intro",
      lyricChunkIds: [],
      videoMomentId: moment.id,
      start: 0,
      end: 10,
      label: "Intro",
      prompt: "Diego dancing alone in the club",
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
    expect(describeCoverageIssue(issues[0]!)).toContain("not a calibrated probability");
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
      prompt: "Diego dancing alone in the club",
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
    expect(describeCoverageIssue(missingIssues[0]!)).toBe("No supported source scene covers 0:00 to 0:10. Review the required visual and its evidence, or plan generation. This gap remains in the draft.");

    const shortMoment: VideoMoment = { id: "moment-short", sourceClipId: 0, label: "Short scene", start: 0, end: 3, duration: 3, caption: "Diego dancing alone in the club" };
    const shortItem = { ...missingItem, videoMomentId: shortMoment.id, semanticMatch: match(shortMoment.id, 0.9) };
    const shortSlots = buildCoverageSlots(project(shortItem, shortMoment), [chunks[0]!]);

    expect(shortSlots[0]).toMatchObject({ status: "short", assignedDuration: 3, missingDuration: 2 });
    expect(summarizeCoverage(shortSlots, 5)).toMatchObject({
      trueGapDuration: 2,
      blockingGapDuration: 2,
      requiredNeedCount: 1,
      blockingGapCount: 1,
      shortReviewCount: 1,
    });
    const shortIssues = buildCoverageIssueGroups(shortSlots);
    expect(describeCoverageIssue(shortIssues[0]!)).toBe("The assigned source covers 0:03 of 0:05, leaving 0:02 uncovered. The faithful draft retains this duration gap. Add eligible footage or explicitly review reuse before final export.");
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
      prompt: "Diego dancing alone in the club",
    };
    const baseProject = project(missingItem);
    baseProject.placementPlan = { version: 1, revision: 1, settings: DEFAULT_STORY_EDIT_SETTINGS, policy: "faithful", inputSignature: placementInputSignature(baseProject), placements: [] };
    const approvedAsset: GeneratedStudioAsset = {
      id: "gen-1",
      provider: "higgsfield",
      model: "Seedance 2.0",
      prompt: "Approved replacement",
      createdAt: "2026-09-05T00:00:00.000Z",
      status: "completed",
      mediaKind: "video",
      durationSeconds: 10,
      resultUrl: "https://media.example.test/video.mp4",
      reviewStatus: "approved",
      target: {
        timelineItemId: missingItem.id,
        planSignature: baseProject.placementPlan.inputSignature,
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
  test("partial generated windows union with sources without double-counting or clearing stale gaps", () => {
    const moment: VideoMoment = { id: "solo", sourceClipId: 0, label: "Solo", start: 0, end: 4, duration: 4, caption: "Diego dancing alone" };
    const item: TimelineItem = { id: "item", requirementId: "opening", sectionId: "intro", lyricChunkIds: [], videoMomentId: moment.id,
      start: 0, end: 10, label: "Intro", prompt: "Diego dancing alone", semanticMatch: match(moment.id, 0.9) };
    const base = project(item, moment);
    base.placementPlan = { version: 1, revision: 1, settings: DEFAULT_STORY_EDIT_SETTINGS, policy: "faithful", inputSignature: placementInputSignature(base), placements: [
      { id: "source", timelineItemId: item.id, sectionId: "intro", kind: "source", origin: "story-match", label: "Solo", momentId: moment.id, sourceStart: 0, sourceEnd: 4, songStart: 0, songEnd: 4 },
    ] };
    const asset: GeneratedStudioAsset = { id: "return", provider: "higgsfield", model: "Seedance", prompt: "Solo", createdAt: "2026-09-06",
      status: "completed", mediaKind: "video", reviewStatus: "approved", resultUrl: "https://media.test/return.mp4", durationSeconds: 3,
      target: { planSignature: base.placementPlan.inputSignature, requirementId: item.requirementId, timelineItemId: item.id, sectionId: "intro", sectionLabel: "Intro", songStart: 3, songEnd: 9 } };
    expect(summarizeCoverage(buildCoverageSlots(base, chunks, [asset]))).toMatchObject({ assignedDuration: 6, blockingGapDuration: 4 });
    expect(summarizeCoverage(buildCoverageSlots(base, chunks, [{ ...asset, target: { ...asset.target!, requirementId: "escape" } }]))).toMatchObject({ assignedDuration: 4, blockingGapDuration: 6 });
    base.sourceContextSignature = "new-reference-context";
    expect(summarizeCoverage(buildCoverageSlots(base, chunks, [asset]))).toMatchObject({ assignedDuration: 0, blockingGapDuration: 10 });
  });

  test("semantic contradictions stay gaps even with a high stored ranking score", () => {
    const moment: VideoMoment = { id: "pair", sourceClipId: 0, label: "Club", start: 0, end: 10, duration: 10,
      caption: "Diego and Valentina dancing together in the club" };
    const item: TimelineItem = { id: "solo", sectionId: "intro", lyricChunkIds: [], videoMomentId: moment.id,
      start: 0, end: 10, label: "Intro", prompt: "Diego walking alone in the club", semanticMatch: match(moment.id, 1) };
    const slots = buildCoverageSlots(project(item, moment), []);
    expect(slots[0]).toMatchObject({ status: "missing", semanticStatus: "missing", assignedDuration: 0, missingDuration: 10 });
    expect(summarizeCoverage(slots)).toMatchObject({ semanticGapDuration: 10, durationGapDuration: 0, blockingGapCount: 1 });
  });

  test("chunks cannot silently reuse the same three source seconds", () => {
    const moment: VideoMoment = { id: "solo", sourceClipId: 0, label: "Solo", start: 0, end: 3, duration: 3, caption: "Diego dancing alone" };
    const item: TimelineItem = { id: "item", sectionId: "intro", lyricChunkIds: [], videoMomentId: moment.id,
      start: 0, end: 10, label: "Intro", prompt: "Diego dancing alone", semanticMatch: match(moment.id, 0.9) };
    const slots = buildCoverageSlots(project(item, moment), chunks);
    expect(slots.map((slot) => slot.assignedDuration)).toEqual([3, 0]);
    expect(summarizeCoverage(slots)).toMatchObject({ assignedDuration: 3, durationGapDuration: 7, blockingGapCount: 2 });
  });

  test("coverage uses saved placements across multiple eligible sources", () => {
    const first: VideoMoment = { id: "first", sourceClipId: 0, label: "First", start: 0, end: 3, duration: 3, caption: "Diego dancing alone" };
    const second: VideoMoment = { ...first, id: "second", sourceClipId: 1, end: 5, duration: 5 };
    const item: TimelineItem = { id: "item", sectionId: "intro", lyricChunkIds: [], videoMomentId: first.id,
      start: 0, end: 10, label: "Intro", prompt: "Diego dancing alone", semanticMatch: match(first.id, 0.9) };
    const base = project(item, first);
    base.videoMoments.push(second);
    base.placementPlan = { version: 1, revision: 1, settings: DEFAULT_STORY_EDIT_SETTINGS, policy: "faithful", inputSignature: placementInputSignature(base), placements: [
      { id: "a", timelineItemId: item.id, sectionId: "intro", kind: "source", origin: "story-match", label: "First", momentId: first.id, sourceStart: 0, sourceEnd: 3, songStart: 0, songEnd: 3 },
      { id: "b", timelineItemId: item.id, sectionId: "intro", kind: "source", origin: "story-match", label: "Second", momentId: second.id, sourceStart: 0, sourceEnd: 5, songStart: 3, songEnd: 8 },
      { id: "gap", timelineItemId: item.id, sectionId: "intro", kind: "gap", origin: "story-match", label: "Gap", momentId: null, sourceStart: 0, sourceEnd: 2, songStart: 8, songEnd: 10 },
    ] };
    expect(summarizeCoverage(buildCoverageSlots(base, chunks))).toMatchObject({ assignedDuration: 8, durationGapDuration: 2, semanticGapDuration: 0, blockingGapCount: 1 });
    base.editPlan.timelineItems[0]!.prompt = "Diego walking alone";
    expect(summarizeCoverage(buildCoverageSlots(base, chunks))).toMatchObject({ assignedDuration: 0, blockingGapDuration: 10 });
  });

  test("a planned grid or incomplete generated video does not clear a gap", () => {
    const item: TimelineItem = { id: "item", sectionId: "intro", lyricChunkIds: [], videoMomentId: null,
      start: 0, end: 10, label: "Intro", prompt: "Diego dancing alone" };
    const base = project(item);
    base.placementPlan = { version: 1, revision: 1, settings: DEFAULT_STORY_EDIT_SETTINGS, policy: "faithful", inputSignature: placementInputSignature(base), placements: [] };
    const asset: GeneratedStudioAsset = { id: "grid", provider: "higgsfield", model: "Nano Banana Pro", prompt: "Grid", createdAt: "2026-09-06",
      status: "completed", mediaKind: "image", reviewStatus: "approved", resultUrl: "https://media.test/grid.png",
      target: { planSignature: base.placementPlan.inputSignature, timelineItemId: item.id, sectionId: item.sectionId, sectionLabel: "Intro", songStart: 0, songEnd: 10 } };
    expect(summarizeCoverage(buildCoverageSlots(base, [], [asset])).blockingGapCount).toBe(1);
    expect(summarizeCoverage(buildCoverageSlots(base, [], [{ ...asset, mediaKind: "video" }])).blockingGapCount).toBe(1);
    expect(summarizeCoverage(buildCoverageSlots(base, [], [{ ...asset, mediaKind: "video", durationSeconds: 3 }]))).toMatchObject({ durationGapDuration: 7, blockingGapCount: 1 });
  });

});
