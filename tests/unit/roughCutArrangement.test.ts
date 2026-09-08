import { describe, expect, test } from "bun:test";
import { clearRoughCutPlacement, applyRoughCutSwap, proposeRoughCutReplacement, proposeRoughCutSwap } from "@/components/studio/roughCutArrangement";
import { isPlacementPlanCurrent, placementInputSignature, type ApprovedPlacement, type MusicVideoProject } from "@/components/studio/musicVideoProject";
import { reviewedEvidence } from "../helpers/storyEvidence";

function fixture(firstDuration = 4, secondDuration = 4, secondGap = false): MusicVideoProject {
  const duration = firstDuration + secondDuration;
  const project: MusicVideoProject = {
    id: "rough-cut", duration, song: null, lyricChunks: [], reviewFindings: [],
    storySections: [{ id: "song", label: "Song", prompt: "Dancing", start: 0, end: duration, source: "manual", lyricChunkIds: [], videoMomentIds: ["a", "b"] }],
    videoMoments: [
      { id: "a", sourceClipId: 1, start: 10, end: 10 + firstDuration, duration: firstDuration, label: "First dance", mediaEvidence: reviewedEvidence({ actions: ["dancing"] }) },
      { id: "b", sourceClipId: 2, start: 20, end: 20 + secondDuration, duration: secondDuration, label: "Second dance", mediaEvidence: reviewedEvidence({ actions: ["dancing"] }) },
    ],
    editPlan: { id: "edit", createdAt: "fixed", timelineItems: [
      { id: "first-item", sectionId: "song", start: 0, end: firstDuration, label: "Opening", prompt: "Dancing", videoMomentId: "a", lyricChunkIds: [] },
      { id: "second-item", sectionId: "song", start: firstDuration, end: duration, label: "Ending", prompt: "Dancing", videoMomentId: secondGap ? null : "b", lyricChunkIds: [] },
    ] },
  };
  const placements: ApprovedPlacement[] = [
    { id: "first", timelineItemId: "first-item", sectionId: "song", label: "Opening", kind: "source", momentId: "a", songStart: 0, songEnd: firstDuration, sourceStart: 10, sourceEnd: 10 + firstDuration, origin: "story-match" },
    { id: "second", timelineItemId: "second-item", sectionId: "song", label: "Ending", kind: secondGap ? "gap" : "source", momentId: secondGap ? null : "b", songStart: firstDuration, songEnd: duration, sourceStart: secondGap ? 0 : 20, sourceEnd: secondGap ? secondDuration : 20 + secondDuration, origin: "story-match" },
  ];
  project.placementPlan = { version: 1, revision: 3, policy: "faithful", settings: { cutDensity: 0.65, preferOnsets: true }, inputSignature: placementInputSignature(project), placements };
  return project;
}

function swap(project: MusicVideoProject) {
  const result = proposeRoughCutSwap(project, "first", "second");
  expect(result.reason).toBe(undefined);
  expect(result.proposal).not.toBe(undefined);
  const applied = applyRoughCutSwap(project, result.proposal!);
  expect(applied.reason).toBe(undefined);
  return { proposal: result.proposal!, project: applied.project! };
}

function assertSongCoverage(project: MusicVideoProject) {
  const cuts = project.placementPlan!.placements;
  expect(cuts[0]!.songStart).toBe(0);
  expect(cuts.at(-1)!.songEnd).toBe(project.duration);
  cuts.slice(1).forEach((cut, index) => expect(cut.songStart).toBe(cuts[index]!.songEnd));
  expect(cuts.reduce((sum, cut) => sum + cut.songEnd - cut.songStart, 0)).toBe(project.duration);
  for (const cut of cuts.filter((placement) => placement.kind === "source")) {
    expect(cut.sourceEnd - cut.sourceStart).toBeCloseTo(cut.songEnd - cut.songStart);
    const source = project.videoMoments.find((moment) => moment.id === cut.momentId)!;
    expect(cut.sourceStart).toBeGreaterThanOrEqual(source.start);
    expect(cut.sourceEnd).toBeLessThanOrEqual(source.end);
  }
}

describe("rough cut arrangement", () => {
  test("swaps only source content, preserves story identities and exact song coverage", () => {
    const original = fixture();
    const snapshot = structuredClone(original);
    const { project, proposal } = swap(original);
    const cuts = project.placementPlan!.placements;
    expect(cuts.map(({ id, timelineItemId, sectionId, label, songStart, songEnd }) => ({ id, timelineItemId, sectionId, label, songStart, songEnd })))
      .toEqual(original.placementPlan!.placements.map(({ id, timelineItemId, sectionId, label, songStart, songEnd }) => ({ id, timelineItemId, sectionId, label, songStart, songEnd })));
    expect(cuts.map((cut) => [cut.momentId, cut.sourceStart, cut.sourceEnd, cut.origin])).toEqual([["b", 20, 24, "manual-match"], ["a", 10, 14, "manual-match"]]);
    expect(project.placementPlan!.revision).toBe(4);
    expect(project.placementPlan!.inputSignature).toBe(original.placementPlan!.inputSignature);
    expect(isPlacementPlanCurrent(project)).toBe(true);
    expect(project.faithfulPlacementPlan).toEqual(snapshot.placementPlan);
    expect(original).toEqual(snapshot);
    expect(proposal.before).toEqual(snapshot.placementPlan!.placements);
    assertSongCoverage(project);
  });

  test("decimal timing does not manufacture empty gaps or zero-length trims", () => {
    const { project, proposal } = swap(fixture(1.1, 1.1));
    expect(proposal.trims).toEqual([]);
    expect(proposal.residualGaps).toEqual([]);
    expect(project.placementPlan!.placements).toHaveLength(2);
    assertSongCoverage(project);
  });

  test("unequal source swap explicitly proposes omitted tail and residual gap before applying", () => {
    const { project, proposal } = swap(fixture(3, 5));
    expect(proposal.trims).toEqual([{ momentId: "b", fromPlacementId: "second", toPlacementId: "first", sourceStart: 23, sourceEnd: 25 }]);
    expect(proposal.summary).toContain("will not play in this cut");
    expect(proposal.summary).toContain("explicit 2s gap");
    expect(project.placementPlan!.placements.map((cut) => [cut.kind, cut.momentId, cut.songStart, cut.songEnd])).toEqual([["source", "b", 0, 3], ["source", "a", 3, 6], ["gap", null, 6, 8]]);
    assertSongCoverage(project);
  });

  test("moves a source into a longer gap with all uncovered time still explicit", () => {
    const { project, proposal } = swap(fixture(3, 7, true));
    expect(proposal.trims).toEqual([]);
    expect(project.placementPlan!.placements.map((cut) => [cut.kind, cut.songStart, cut.songEnd])).toEqual([["gap", 0, 3], ["source", 3, 6], ["gap", 6, 10]]);
    assertSongCoverage(project);
  });

  test("short gap receives a bounded explicit trim, never an overrun", () => {
    const { project, proposal } = swap(fixture(7, 3, true));
    expect(proposal.trims[0]).toMatchObject({ sourceStart: 13, sourceEnd: 17 });
    expect(project.placementPlan!.placements.map((cut) => [cut.kind, cut.songStart, cut.songEnd])).toEqual([["gap", 0, 7], ["source", 7, 10]]);
    assertSongCoverage(project);
  });

  test("allows editorial swaps with uncertain story fit without mutating the input", () => {
    for (const prompt of ["Running", "Entering", "Dancing in a cave"]) {
      const project = fixture();
      project.editPlan.timelineItems[1]!.prompt = prompt;
      project.placementPlan!.inputSignature = placementInputSignature(project);
      const before = structuredClone(project);
      const result = proposeRoughCutSwap(project, "first", "second");
      expect(result.proposal).not.toBe(undefined);
      expect(project).toEqual(before);
    }
  });

  test("allows a deliberate setting contrast in either swap direction", () => {
    const project = fixture();
    project.editPlan.timelineItems[0]!.requirements = { setting: "forest" };
    project.placementPlan!.inputSignature = placementInputSignature(project);
    expect(proposeRoughCutSwap(project, "first", "second").proposal).not.toBe(undefined);
  });

  test("rejects stale evidence, changed plan contents, changed duration, and forged proposals", () => {
    const original = fixture();
    const proposal = proposeRoughCutSwap(original, "first", "second").proposal!;
    for (const change of [
      (project: MusicVideoProject) => { project.editPlan.timelineItems[1]!.prompt = "Running"; },
      (project: MusicVideoProject) => { project.placementPlan!.placements[0]!.label = "Changed"; },
      (project: MusicVideoProject) => { project.duration += 2; },
      (project: MusicVideoProject) => { project.placementPlan!.revision += 1; },
    ]) {
      const project = structuredClone(original);
      change(project);
      expect(applyRoughCutSwap(project, proposal).project).toBe(undefined);
    }
    const forged = structuredClone(proposal);
    forged.after[0]!.sourceEnd = 999;
    expect(applyRoughCutSwap(original, forged).reason).toContain("proposal changed");
    const stale = structuredClone(original);
    stale.videoMoments[0]!.caption = "new evidence";
    expect(proposeRoughCutSwap(stale, "first", "second").reason).toContain("stale");
  });

  test("rejects source bounds violations, stretching, overlapping song windows, and faithful source reuse", () => {
    for (const change of [
      (project: MusicVideoProject) => { project.placementPlan!.placements[0]!.sourceStart = 9; },
      (project: MusicVideoProject) => { project.placementPlan!.placements[0]!.sourceEnd = 13; },
      (project: MusicVideoProject) => { project.placementPlan!.placements[1]!.songStart = 3; },
      (project: MusicVideoProject) => {
        project.videoMoments[1]!.sourceClipId = 1;
        project.videoMoments[1]!.start = 12;
        project.videoMoments[1]!.end = 16;
        project.placementPlan!.placements[1]!.sourceStart = 12;
        project.placementPlan!.placements[1]!.sourceEnd = 16;
        project.placementPlan!.inputSignature = placementInputSignature(project);
      },
    ]) {
      const project = fixture();
      change(project);
      expect(proposeRoughCutSwap(project, "first", "second").proposal).toBe(undefined);
    }
  });

  test("retains original faithful snapshot across later edits and reusing a reviewed proposal fails", () => {
    const original = fixture();
    const first = swap(original);
    const second = swap(first.project);
    expect(second.project.faithfulPlacementPlan).toEqual(original.placementPlan);
    expect(second.project.placementPlan!.placements.map((cut) => cut.momentId)).toEqual(["a", "b"]);
    expect(applyRoughCutSwap(first.project, first.proposal).project).toBe(undefined);
  });

  test("same placement, missing placement, and gap-only edits are rejected", () => {
    const project = fixture();
    expect(proposeRoughCutSwap(project, "first", "first").proposal).toBe(undefined);
    expect(proposeRoughCutSwap(project, "first", "missing").proposal).toBe(undefined);
    project.placementPlan!.placements = project.placementPlan!.placements.map((cut) => ({ ...cut, kind: "gap", momentId: null }));
    expect(proposeRoughCutSwap(project, "first", "second").reason).toContain("two gaps");
  });
});


describe("rough cut source replacement", () => {
  test("replaces only one gap and keeps a shorter clip's residual gap", () => {
    const project = fixture(3, 7, true);
    project.videoMoments.push({ ...project.videoMoments[0]!, id: "c", label: "Library dance", sourceClipId: 3 });
    project.placementPlan!.inputSignature = placementInputSignature(project);
    const result = proposeRoughCutReplacement(project, "second", "c");
    expect(result.reason).toBe(undefined);
    expect(result.proposal!.replacementMomentId).toBe("c");
    const next = applyRoughCutSwap(project, result.proposal!).project!;
    expect(next.placementPlan!.placements[0]).toEqual(project.placementPlan!.placements[0]);
    expect(next.placementPlan!.placements.map((cut) => [cut.kind, cut.momentId, cut.songStart, cut.songEnd])).toEqual([["source", "a", 0, 3], ["source", "c", 3, 6], ["gap", null, 6, 10]]);
    assertSongCoverage(next);
  });

  test("replacement reviews explicit trimming and preserves the destination identity", () => {
    const project = fixture(3, 7, true);
    const result = proposeRoughCutReplacement(project, "first", "b");
    expect(result.proposal!.trims).toHaveLength(1);
    expect(result.summary).toContain("Trim 4s");
    const next = applyRoughCutSwap(project, result.proposal!).project!;
    expect(next.placementPlan!.placements[0]).toMatchObject({ id: "first", timelineItemId: "first-item", label: "Opening", momentId: "b", sourceStart: 20, sourceEnd: 23 });
    expect(next.placementPlan!.placements[1]).toEqual(project.placementPlan!.placements[1]);
    assertSongCoverage(next);
  });

  test("replacement respects no-reuse policy and missing media while allowing weak semantic fit", () => {
    const project = fixture(3, 7, true);
    expect(proposeRoughCutReplacement(project, "second", "a").reason).toContain("reuses overlapping source footage");
    project.editPlan.timelineItems[1]!.prompt = "Running";
    project.placementPlan!.inputSignature = placementInputSignature(project);
    expect(proposeRoughCutReplacement(project, "second", "b").proposal).not.toBe(undefined);
    expect(proposeRoughCutReplacement(project, "second", "missing").reason).toContain("no longer available");
  });
});


test("removing a clip reopens exactly its song window, preserves sources, and survives reuse preparation", async () => {
  const { prepareApprovedPlacements, buildEditPlanPreviewSegments } = await import("@/components/studio/musicVideoProject");
  const project = fixture();
  const before = structuredClone(project);
  const cleared = clearRoughCutPlacement(project, "first").project!;
  expect(project).toEqual(before);
  expect(cleared.videoMoments).toEqual(project.videoMoments);
  expect(cleared.placementPlan!.placements[0]).toMatchObject({ id: "first", kind: "gap", momentId: null, songStart: 0, songEnd: 4 });
  expect(cleared.placementPlan!.placements[1]).toEqual(project.placementPlan!.placements[1]);
  expect(isPlacementPlanCurrent(cleared)).toBe(true);
  const sources = project.videoMoments.map(moment => ({ id: moment.sourceClipId, name: moment.label, videoUrl: `blob:${moment.id}`, thumbnailUrl: "", duration: moment.end, size: 10 }));
  const reused = prepareApprovedPlacements({ project: JSON.parse(JSON.stringify(cleared)), videoSources: sources, policy: "best-effort" });
  const preview = buildEditPlanPreviewSegments({ project: reused, videoSources: sources });
  expect(preview[0]).toMatchObject({ kind: "gap", musicStart: 0, musicEnd: 4 });
  expect(preview.reduce((sum, cut) => sum + cut.musicEnd - cut.musicStart, 0)).toBe(8);
  expect(clearRoughCutPlacement(cleared, "first").project).toBe(undefined);
});
