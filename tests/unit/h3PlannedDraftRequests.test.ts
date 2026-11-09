import { describe, expect, test } from "bun:test";
import { buildH3DraftPlanningInput, buildPlannedH3DraftRequests, composePlannedH3ShotDirection } from "@/components/studio/h3PlannedDraftRequests";
import { buildEditPlanPreviewSegments } from "@/components/studio/musicVideoProject";
import { planH3DraftWindows, h3WindowKey } from "@/components/studio/h3DraftPlan";
import type { H3ShotPlanningResult } from "@/components/studio/h3ShotPlanning";
import { h3ProjectFixture } from "../helpers/h3Project";
import { materializeH3Job } from "@/lib/h3GenerationServer";
import { compileH3Prompt } from "@/lib/h3Workflow";
import { H3_FPS, h3FrameCount } from "@/components/studio/h3Generation";
import { loadH3ShotPlanningContext } from "@/lib/h3ShotPlanningServer";

function fixture() {
  const { saved, request } = h3ProjectFixture();
  const project = saved.draft.musicVideoProject!;
  const placement = project.placementPlan!.placements[0];
  project.placementPlan!.placements = [
    { ...placement, id: "first", songEnd: 5, sourceEnd: 5 },
    { ...placement, id: "second", songStart: 5, sourceEnd: 5 },
  ];
  const references = saved.draft.referenceAssets!;
  const input = buildH3DraftPlanningInput(saved.project.id, project, references);
  const windows = planH3DraftWindows(buildEditPlanPreviewSegments({ project, videoSources: [] }));
  const result: H3ShotPlanningResult = { version: 1, bindingSha256: input.bindingSha256, directions: input.groups.flatMap(group => group.windows.map((window, index) => ({
    windowKey: window.key, direction: "[Tracking] Medium shot. Diego advances along CLUB_MAIN.",
    entryState: index ? "Diego reaches the doorway" : "Diego holds the rail", exitState: index ? "Diego crosses the threshold" : "Diego reaches the doorway", actionIndices: [],
  }))) };
  const params = { projectId: saved.project.id, windows, jobs: [], draftRevision: 2, referenceAssets: references, planningInput: input, planningResult: result, newIntent: () => "test-intent" };
  return { saved, request, project, references, input, windows, result, params };
}

describe("planned automatic H3 draft requests", () => {
  test("composed prose matches the gateway critic's camera/newline/punctuation golden vector", () => {
    expect(composePlannedH3ShotDirection({ windowKey: "fixture", direction: "[Low tracking]\nMedium shot.\nFixture action.",
      entryState: "Fixture entry", exitState: "Fixture exit!", actionIndices: [] }))
      .toBe("[Low tracking] Medium shot. Fixture entry. Fixture action. Fixture exit!");
  });
  test("client canonical scaffold exactly matches server context and includes the full confirmed plan", async () => {
    const f = fixture();
    const context = await loadH3ShotPlanningContext(f.saved.project.ownerId, f.saved.project.id, { planSignature: f.input.planSignature },
      { read: async () => f.saved, validate: async () => f.input.planSignature });
    expect(context.input).toEqual(f.input);
    expect(f.input.groups.flatMap(group => group.windows).map(window => window.key)).toEqual(f.windows.map(h3WindowKey));
  });

  test("new packets carry reviewed entry/action/exit prose and still compile with the actual padded H3 duration", () => {
    const f = fixture();
    const requests = buildPlannedH3DraftRequests(f.params);
    expect(requests.map(request => [request.songStart, request.songEnd])).toEqual([[0, 5], [5, 10]]);
    expect(requests[0].prompt).toBe("[Tracking] Medium shot. Diego holds the rail. Diego advances along CLUB_MAIN. Diego reaches the doorway.");
    expect(requests[0].referenceAssetIds).toEqual(["diego", "club"]);
    expect(requests[0].prompt).not.toBe(f.windows[0].storyDirection);
    const job = materializeH3Job(f.saved.project.ownerId, f.saved, requests[0], "studio");
    const compiled = compileH3Prompt(job);
    expect(compiled.frames).toBe(h3FrameCount(5));
    expect(compiled.frames / H3_FPS).toBeGreaterThan(5);
    expect(compiled.prompt).toContain(requests[0].prompt);
    expect(compiled.frameSchedule["0"]).toContain(f.result.directions[0].entryState);
    expect(compiled.frameSchedule["0"]).toContain(f.result.directions[0].exitState);
  });

  test("new requests require exact bound directions; an enclosing full-window action cannot fill a partial overlay", () => {
    const f = fixture();
    expect(() => buildPlannedH3DraftRequests({ ...f.params, planningInput: undefined, planningResult: undefined })).toThrow("exact current");
    expect(() => buildPlannedH3DraftRequests({ ...f.params, windows: [{ ...f.windows[0], musicStart: 3 }, f.windows[1]] })).toThrow("exact current");
    expect(() => buildPlannedH3DraftRequests({ ...f.params, projectId: "other-project" })).toThrow("another project");
    expect(() => buildPlannedH3DraftRequests({ ...f.params, planningResult: { ...f.result, bindingSha256: "0".repeat(64) } })).toThrow();
    expect(() => composePlannedH3ShotDirection({ ...f.result.directions[0], direction: "Generic whole-story direction" })).toThrow("native camera");
  });

  test("nonterminal packets are returned verbatim, including manual prompt, revision, references and intent", () => {
    const f = fixture();
    const job = materializeH3Job(f.saved.project.ownerId, f.saved, { ...f.request, songEnd: 5, prompt: "Diego manual accepted direction", draftRevision: 7 }, "studio");
    const before = structuredClone(job);
    const requests = buildPlannedH3DraftRequests({ ...f.params, windows: [f.windows[0]], jobs: [job], planningInput: undefined, planningResult: undefined });
    expect(requests[0]).toBe(job.request);
    expect(job).toEqual(before);
  });

  test("explicit terminal retries retain manual direction and packet authority without invoking planning", () => {
    const f = fixture();
    const job = { ...materializeH3Job(f.saved.project.ownerId, f.saved, { ...f.request, songEnd: 5,
      prompt: "Diego manual accepted direction", draftRevision: 7 }, "studio"), state: "failed" as const };
    const requests = buildPlannedH3DraftRequests({ ...f.params, windows: [f.windows[0]], jobs: [job], referenceAssets: [], planningInput: undefined, planningResult: undefined });
    expect(requests[0]).toEqual({ ...job.request, attempt: 1, draftRevision: undefined });
    expect(requests[0].prompt).toBe("Diego manual accepted direction");
    expect(requests[0].referenceAssetIds).toEqual(job.request.referenceAssetIds);
    const exhausted = { ...job, request: { ...job.request, attempt: 2 } };
    expect(() => buildPlannedH3DraftRequests({ ...f.params, windows: [f.windows[0]], jobs: [exhausted], planningInput: undefined, planningResult: undefined })).toThrow("two revisions");
  });
});
