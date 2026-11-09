import { expect, mock, test } from "bun:test";
import { revisedStoryReuseFixture } from "../helpers/revisedStoryReuse";
import { effectiveGenerationScope } from "@/components/studio/generationScope";
import { placementInputSignature } from "@/components/studio/musicVideoProject";

const fixture = revisedStoryReuseFixture(), { saved, job, asset } = fixture;
let firstFrameReads = 0, jobReads = 0, rejectFirstFrame = false;
mock.module("@/lib/h3JobStore", () => ({ readH3Job: async () => { jobReads++; return job; } }));
mock.module("@/lib/canonicalH3FirstFrame", () => ({ assertCanonicalH3FirstFrame: async () => {
  firstFrameReads++; if (rejectFirstFrame) throw new Error("Canonical PNG changed");
} }));
const { loadH3ShotPlanningContext, executeH3ShotPlanning } = await import("@/lib/h3ShotPlanningServer");

test("actual planning loads share one first-frame check across cut fragments and recheck after inference", async () => {
  const project = saved.draft.musicVideoProject!, original = project.placementPlan!.placements[0];
  project.generationScope = undefined;
  project.placementPlan!.placements = [
    { ...original, id: "fragment-a", songStart: 0, songEnd: 1, sourceStart: 0, sourceEnd: 1 },
    { ...original, id: "fragment-b", songStart: 1, songEnd: 4, sourceStart: 0, sourceEnd: 3 },
  ];
  project.placementPlan!.inputSignature = placementInputSignature(project);
  const scope = effectiveGenerationScope(project)!;
  asset.target!.planSignature = job.target.planSignature = job.request.planSignature = scope;
  job.result!.asset = structuredClone(asset);
  saved.draft.generatedDraft!.planSignature = scope;
  const dependencies = { read: async () => saved, validate: async () => scope, baseline: async () => {} };
  const load: typeof loadH3ShotPlanningContext = (owner, id, expected) => loadH3ShotPlanningContext(owner, id, expected, dependencies);
  const context = await load("owner", "project", { planSignature: scope });
  const generated = context.input.groups.flatMap(group => group.windows).filter(window => window.generatedEvidence);
  expect(generated.map(window => [window.songStart, window.songEnd])).toEqual([[0, 1], [1, 2]]);
  expect(firstFrameReads).toBe(1); expect(jobReads).toBe(2);
  let stores = 0;
  await expect(executeH3ShotPlanning({ ownerId: "owner", projectId: "project", planSignature: scope,
    bindingSha256: context.input.bindingSha256 }, { load, read: async () => null,
    generate: async input => { rejectFirstFrame = true; return { version: 1, bindingSha256: input.bindingSha256, directions: [] }; },
    store: async () => { stores++; throw new Error("Changed evidence must not be stored"); } })).rejects.toThrow("bounded shot planning context");
  expect(firstFrameReads).toBe(3); expect(stores).toBe(0);
});
