import { expect, test } from "bun:test";
import { buildEditPlanPreviewSegments, createMusicVideoProject, prepareApprovedPlacements, placementInputSignature } from "@/components/studio/musicVideoProject";
import { applyPacingProposal, preparePacingProposal } from "@/components/studio/pacingProposal";
import { effectiveGenerationScope, generationScopeSha256, generationSemanticSha256, type GenerationScopeReceipt } from "@/components/studio/generationScope";
import { applyGeneratedAssetOverlays } from "@/components/studio/generatedAssets";
import { selectedFootageFixture } from "../helpers/selectedFootageEvidence";

function fixture() {
  return prepareApprovedPlacements({ project: createMusicVideoProject({ analysis: null, duration: 12, videoSources: [],
    storyDrafts: [{ id: "intro", label: "Intro", prompt: "Dancing", start: 0, end: 12 }] }), videoSources: [] });
}

function selectedTakeFixture(version: 1 | 2, issued = false) {
  const project = fixture();
  project.sourceContextSignature = "source-context";
  const gap = project.placementPlan!.placements[0];
  project.placementPlan!.placements = [
    { ...gap, id: "protected", songStart: 0, songEnd: 4, sourceEnd: 4 },
    { ...gap, id: "unbound", songStart: 4, songEnd: 12, sourceEnd: 8 },
  ];
  if (version === 2) {
    project.generationScopeVersion = 2;
    project.generationSourceContextSha256 = "a".repeat(64);
    project.generationStorySha256 = "b".repeat(64);
  }
  project.placementPlan!.inputSignature = placementInputSignature(project);
  const scope = effectiveGenerationScope(project)!;
  if (issued) {
    const body: GenerationScopeReceipt["body"] = {
      version: 1, kind: "baseline", ownerId: "owner", projectId: project.id, baselineRevision: "r1",
      fromSourceContext: project.sourceContextSignature!, toSourceContext: project.sourceContextSignature!,
      fromInputSignature: project.placementPlan!.inputSignature, toInputSignature: project.placementPlan!.inputSignature,
      scopeSignature: scope, semanticSha256: generationSemanticSha256(project), references: [], rawReferences: [],
      sourceMediaVersions: [], appendedReferenceIds: [], storySha256: project.generationStorySha256!,
      sourceInventorySha256: project.generationSourceContextSha256!,
    };
    const sha256 = generationScopeSha256(body);
    project.generationScope = { version: 1, id: `generation-scope-${sha256}`, sha256, body };
  }
  const asset = selectedFootageFixture().asset;
  asset.trimStart = 0;
  asset.target = { ...asset.target!, planSignature: scope, timelineItemId: gap.timelineItemId,
    sectionId: gap.sectionId, requirementId: project.editPlan.timelineItems[0].requirementId, songStart: 0, songEnd: 4 };
  const generatedDraft = { planSignature: scope, revision: 1, assetIds: [asset.id] };
  const playback = (current = project) => applyGeneratedAssetOverlays(
    buildEditPlanPreviewSegments({ project: current, videoSources: [] }), [asset],
  ).filter(segment => segment.generatedAssetId === asset.id);
  return { project, asset, generatedDraft, playback };
}

for (const issued of [false, true]) {
  test(`pacing refuses to orphan protected selected footage with ${issued ? "an issued" : "a derived"} v2 scope`, () => {
    const { project, asset, generatedDraft, playback } = selectedTakeFixture(2, issued);
    const before = JSON.stringify({ project, asset, generatedDraft });
    expect(effectiveGenerationScope(project)).toBe(generatedDraft.planSignature);
    expect(playback()).toHaveLength(1);
    const proposal = preparePacingProposal(project, [2, 4, 6, 8, 10], [{ start: 0, end: 4 }], "selected");
    expect(proposal.changed).toBe(true);
    expect(proposal.placements[0]).toEqual(project.placementPlan!.placements[0]);
    expect(() => applyPacingProposal(project, proposal, "selected")).toThrow("protected take or shot bindings");
    expect(JSON.stringify({ project, asset, generatedDraft })).toBe(before);
    expect(playback(JSON.parse(JSON.stringify(project)))).toHaveLength(1);
  });
}

test("legacy pacing that retains the scope keeps selected footage playable", () => {
  const { project, playback } = selectedTakeFixture(1);
  const proposal = preparePacingProposal(project, [2, 4, 6, 8, 10], [{ start: 0, end: 4 }], "selected");
  const next = applyPacingProposal(project, proposal, "selected");
  expect(next.placementPlan!.placements).toHaveLength(5);
  expect(effectiveGenerationScope(next)).toBe(effectiveGenerationScope(project));
  expect(playback(next)).toHaveLength(1);
});

test("v2 pacing remains available without protected bindings, and a no-op preserves the scope", () => {
  const { project } = selectedTakeFixture(2);
  const unchanged = preparePacingProposal(project, [4], [{ start: 0, end: 4 }], "");
  expect(applyPacingProposal(project, unchanged, "")).toBe(project);
  const proposal = preparePacingProposal(project, [2, 4, 6, 8, 10], [], "");
  expect(applyPacingProposal(project, proposal, "").placementPlan!.placements).toHaveLength(6);
});

test("preparation keeps live cut exact; apply changes only reviewed gap timing; undo snapshot remains intact", () => {
  const project = fixture(), before = structuredClone(project);
  const proposal = preparePacingProposal(project, [0, 2, 4, 6, 8, 10, 12], [], "takes-v1");
  expect(project).toEqual(before);
  expect(proposal.changed).toBe(true);
  const next = applyPacingProposal(project, proposal, "takes-v1");
  expect(next.placementPlan!.placements.map(p => [p.songStart, p.songEnd])).toEqual([[0, 2], [2, 4], [4, 6], [6, 8], [8, 10], [10, 12]]);
  expect(next.editPlan).toEqual(before.editPlan);
  expect(next.videoMoments).toEqual(before.videoMoments);
  expect(JSON.parse(proposal.snapshot)).toEqual(before);
});

test("retained source take, exact trim and manual hole survive every cue; conflicts and replacement gaps visible", () => {
  const project = fixture();
  const gap = project.placementPlan!.placements[0];
  project.videoMoments = [{ id: "take", sourceClipId: 1, label: "Manual take", start: 0, end: 20, duration: 20 }];
  const source = { ...gap, id: "manual", kind: "source" as const, momentId: "take", origin: "manual-match" as const,
    songStart: 0, songEnd: 5, sourceStart: 3.25, sourceEnd: 8.25 };
  const hole = { ...gap, id: "hole", songStart: 5, songEnd: 12, sourceEnd: 7, origin: "manual-match" as const };
  project.placementPlan!.placements = [source, hole];
  project.placementPlan!.inputSignature = placementInputSignature(project);
  const proposal = preparePacingProposal(project, [0, 2, 4, 6, 8, 10, 12], [], "");
  expect(proposal.placements).toEqual([source, hole]);
  expect(proposal.changed).toBe(false);
  expect(proposal.conflicts.length).toBe(2);
  expect(proposal.gaps.length).toBe(1);
});

test("bound generated shot windows stay exact even when no take is selected", () => {
  const project = fixture();
  const proposal = preparePacingProposal(project, [2, 4, 6, 8, 10], [{ start: 0, end: 12 }], "");
  expect(proposal.placements).toEqual(project.placementPlan!.placements);
  expect(proposal.changed).toBe(false);
});

test("newer trim, restored same revision, take selection, project and tampered proposal reject whole apply", () => {
  const project = fixture();
  const proposal = preparePacingProposal(project, [2, 4, 6, 8, 10], [], "v1");
  expect(() => applyPacingProposal(project, proposal, "v2")).toThrow("changed");
  const edited = structuredClone(project); edited.placementPlan!.placements[0].reason = "User edit";
  expect(() => applyPacingProposal(edited, proposal, "v1")).toThrow("changed");
  expect(() => applyPacingProposal({ ...project, id: "other" }, proposal, "v1")).toThrow("changed");
  const tampered = structuredClone(proposal); tampered.placements[0].songEnd += 0.5;
  expect(() => applyPacingProposal(project, tampered, "v1")).toThrow("changed");
});
