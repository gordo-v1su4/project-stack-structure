import { expect, test } from "bun:test";
import { createMusicVideoProject, prepareApprovedPlacements, placementInputSignature } from "@/components/studio/musicVideoProject";
import { applyPacingProposal, preparePacingProposal } from "@/components/studio/pacingProposal";

function fixture() {
  return prepareApprovedPlacements({ project: createMusicVideoProject({ analysis: null, duration: 12, videoSources: [],
    storyDrafts: [{ id: "intro", label: "Intro", prompt: "Dancing", start: 0, end: 12 }] }), videoSources: [] });
}

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
