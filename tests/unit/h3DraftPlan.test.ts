import { describe, expect, test } from "bun:test";
import { createH3PickupWindow, enqueueH3DraftRequest, findH3TargetSegment, h3RequestWindowKey, nextH3Attempt, parseH3DraftBatch, planH3DraftWindows, selectH3PickupWindow, selectH3ReferenceAssetIds, h3WindowKey, type H3DraftBatch } from "../../src/components/studio/h3DraftPlan";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import { prepareApprovedPlacements } from "@/components/studio/musicVideoProject";
import { materializeH3Job, parseH3Request } from "@/lib/h3GenerationServer";
import { compileH3Prompt } from "@/lib/h3Workflow";
import { h3ProjectFixture } from "../helpers/h3Project";
import type { EditPlanPreviewSegment } from "../../src/components/studio/musicVideoProject";

const gap = (start: number, end: number, patch: Partial<EditPlanPreviewSegment> = {}): EditPlanPreviewSegment => ({
  kind: "gap", videoUrl: "", startTime: 0, endTime: end - start, musicStart: start, musicEnd: end,
  label: "Entry", sectionId: "verse", planSignature: "current", requirementId: "entry", timelineItemId: "slot", ...patch,
});

describe("H3 draft coverage planning", () => {
  test("one-shot defaults skip boundary slivers while an explicit selection retains them", () => {
    const windows = [gap(0, 0.03), gap(14.77, 20), gap(20, 20.4)];
    expect(selectH3PickupWindow(windows, "")).toBe(windows[1]);
    expect(selectH3PickupWindow(windows, "stale-key")).toBe(windows[1]);
    expect(selectH3PickupWindow(windows, h3WindowKey(windows[0]))).toBe(windows[0]);
    expect(selectH3PickupWindow([windows[0], windows[2]], "")).toBeNull();
    expect(createH3PickupWindow(windows[0], 0.03).musicEnd).toBe(0.03);
    expect(() => createH3PickupWindow(windows[0], 0.02)).toThrow("duration");
  });

  test("one-shot pickup fills exactly 14.77–17.27 without changing saved placement identity", () => {
    const original = gap(14.77, 23, { placementId: "diego-entry", storyDirection: "Diego enters." });
    const pickup = createH3PickupWindow(original, 2.5);
    expect(pickup).toMatchObject({ musicStart: 14.77, musicEnd: 17.27, startTime: 0, endTime: 2.5,
      placementId: original.placementId, planSignature: original.planSignature, sectionId: original.sectionId,
      requirementId: original.requirementId, timelineItemId: original.timelineItemId });
    expect(original.musicEnd).toBe(23);
    for (const duration of [NaN, Infinity, 0, -1, 0.9, 8.231, 13]) expect(() => createH3PickupWindow(original, duration)).toThrow("duration");
    expect(createH3PickupWindow(original, 8.23).musicEnd).toBe(23);
  });

  test("one-shot prefix target binds to the saved plan and keeps native handles outside song coverage", () => {
    const { saved, request } = h3ProjectFixture();
    const signature = saved.draft.musicVideoProject!.placementPlan!.inputSignature;
    const pickup = createH3PickupWindow(gap(request.songStart, request.songEnd, { planSignature: signature,
      sectionId: request.sectionId, requirementId: request.requirementId, timelineItemId: request.timelineItemId }), 2.5);
    const input = parseH3Request({ ...request, songStart: pickup.musicStart, songEnd: pickup.musicEnd });
    const job = materializeH3Job("github-test", saved, input, "studio");
    expect(job.target.songStart).toBe(request.songStart);
    expect(job.target.songEnd).toBe(request.songStart + 2.5);
    expect(compileH3Prompt(job).frames / 24).toBeGreaterThan(2.5);
  });

  test("covers a long gap exactly without touching existing footage or creating a tiny tail", () => {
    const windows = planH3DraftWindows([gap(0, 3, { kind: "source", videoUrl: "https://media.test/source.mp4" }), gap(3, 28)]);
    expect(windows).toHaveLength(3);
    expect(windows[0].musicStart).toBe(3);
    expect(windows.at(-1)?.musicEnd).toBe(28);
    expect(windows.every(window => window.musicEnd - window.musicStart <= 12)).toBe(true);
    expect(windows[0].musicEnd).toBe(windows[1].musicStart);
    expect(windows[1].musicEnd).toBe(windows[2].musicStart);
  });
  test("coalesces only contiguous fragments of the same story requirement", () => {
    const input = [gap(0, 0.02), gap(0.02, 7), gap(7, 9, { requirementId: "meeting" })];
    const windows = planH3DraftWindows(input);
    expect(windows.map(window => [window.musicStart, window.musicEnd])).toEqual([[0, 7], [7, 9]]);
    expect(input[0].musicEnd).toBe(0.02);
  });
  test("never dispatches stale unbound or invalid windows", () => {
    expect(planH3DraftWindows([gap(0, 4, { planSignature: undefined }), gap(4, 4), gap(5, NaN)])).toEqual([]);
  });

  test("does not coalesce across saved placement boundaries the generation route cannot span", () => {
    expect(planH3DraftWindows([gap(0, 6, { placementId: "p1" }), gap(6, 12, { placementId: "p2" })]).map(window => [window.musicStart, window.musicEnd])).toEqual([[0, 6], [6, 12]]);
  });

  test("long-gap subdivisions all bind to the current saved placement through server validation", () => {
    const { saved, request } = h3ProjectFixture();
    const project = saved.draft.musicVideoProject!;
    project.duration = 28;
    project.editPlan.timelineItems[0].end = 28;
    saved.draft.musicVideoProject = prepareApprovedPlacements({ project, videoSources: [] });
    const signature = saved.draft.musicVideoProject.placementPlan!.inputSignature;
    const windows = planH3DraftWindows([gap(0, 28, { planSignature: signature, timelineItemId: request.timelineItemId, requirementId: undefined, sectionId: request.sectionId })]);
    for (const window of windows) {
      const input = parseH3Request({ ...request, planSignature: signature, songStart: window.musicStart, songEnd: window.musicEnd });
      const job = materializeH3Job("github-test", saved, input, "studio");
      expect(job.target.songStart).toBe(window.musicStart);
      expect(job.target.songEnd).toBe(window.musicEnd);
    }
  });

  test("revises the exact original target across sliced candidate display fragments", () => {
    const target = { planSignature: "current", requirementId: "entry", timelineItemId: "slot", sectionId: "verse", sectionLabel: "Verse", songStart: 0, songEnd: 10 };
    const fragments = [gap(0, 3, { kind: "source", videoUrl: "https://media.example/a.mp4" }), gap(3, 7), gap(7, 10, { kind: "source", videoUrl: "https://media.example/b.mp4" })];
    expect(findH3TargetSegment(fragments, target)).toMatchObject({ musicStart: 0, musicEnd: 10, endTime: 10, timelineItemId: "slot" });
    expect(findH3TargetSegment([fragments[0], fragments[2]], target)).toBeNull();
    expect(findH3TargetSegment(fragments, { ...target, planSignature: "old" })).toBeNull();
  });

  test("selects only named cast and the named location without unrelated sheets", () => {
    const { saved } = h3ProjectFixture();
    const references = [...saved.draft.referenceAssets!, { ...saved.draft.referenceAssets![0], id: "other", role: "character-2" as const, displayName: "Ann" }];
    expect(selectH3ReferenceAssetIds(references, "Diego walks through CLUB_MAIN.")).toEqual(["diego", "club"]);
    expect(selectH3ReferenceAssetIds(references, "A banner sways above CLUB_MAIN.")).toEqual(["club"]);
    expect(selectH3ReferenceAssetIds(references, "Diego and Ann enter CLUB_MAIN.")).toEqual(["diego", "other", "club"]);
    expect(() => selectH3ReferenceAssetIds(references.filter(reference => reference.id !== "club"), "Diego enters.")).toThrow("environment");
  });

  test("explicit crowd subset reaches dispatch and survives revision/reload without other available sheets", async () => {
    const { saved, request } = h3ProjectFixture();
    const references = saved.draft.referenceAssets!;
    for (const id of ["crowd-a", "crowd-b"]) references.push({ ...references[1], id, role: "crowd", kind: "crowd", displayName: id,
      storagePath: `media-uploads/github-test/references/${id}/sheet.png` });
    const input = { ...request, referenceAssetIds: selectH3ReferenceAssetIds(references, request.prompt, ["crowd-b"]) };
    expect(input.referenceAssetIds).toEqual(["diego", "club", "crowd-b"]);
    const job = materializeH3Job("github-test", saved, parseH3Request(input), "studio");
    expect(job.references.map(ref => ref.role)).toEqual(["identity", "environment", "crowd"]);
    const posted: typeof input[] = [];
    const transport = (async (_url, init) => {
      posted.push(JSON.parse(String(init?.body)));
      return Response.json({ jobId: job.id, job });
    }) as typeof fetch;
    await enqueueH3DraftRequest(input, [], transport);
    const revision = nextH3Attempt({ ...job, state: "failed" }, [], 1, "Diego crosses the room.");
    const batch: H3DraftBatch = { version: 1, projectId: input.projectId, planSignature: input.planSignature, requests: [revision], paused: true };
    await enqueueH3DraftRequest(parseH3DraftBatch(JSON.stringify(batch), input.projectId)!.requests[0], [], transport);
    expect(posted.map(value => value.referenceAssetIds)).toEqual([["diego", "club", "crowd-b"], ["diego", "club", "crowd-b"]]);
    expect(selectH3ReferenceAssetIds(references, request.prompt)).toEqual(["diego", "club"]);
  });

  test("selected crowd cannot disappear, bypass upload readiness, masquerade as a lead, or exceed nine sockets", () => {
    const { saved, request } = h3ProjectFixture();
    const references = saved.draft.referenceAssets!;
    const crowd = { ...references[1], id: "crowd", role: "crowd" as const, kind: "crowd" as const, displayName: "Extras" };
    for (const assets of [references, [...references, { ...crowd, storageStatus: "uploading" as const }], [...references, { ...crowd, storagePath: undefined }]]) {
      expect(() => selectH3ReferenceAssetIds(assets, request.prompt, ["crowd"])).toThrow(/crowd.*unavailable|upload/i);
    }
    expect(() => selectH3ReferenceAssetIds(references, request.prompt, ["diego"])).toThrow(/crowd/i);
    const crowds = Array.from({ length: 8 }, (_, index) => ({ ...crowd, id: `crowd-${index}` }));
    expect(selectH3ReferenceAssetIds([...references, ...crowds], request.prompt, crowds.slice(0, 7).map(ref => ref.id))).toHaveLength(9);
    expect(() => selectH3ReferenceAssetIds([...references, ...crowds], request.prompt, crowds.map(ref => ref.id))).toThrow(/9|nine/);
    expect(() => selectH3ReferenceAssetIds([...references, crowd], request.prompt, ["crowd", "crowd"])).toThrow(/distinct/i);
  });
});

function recoveryFixture() {
  const { saved, request } = h3ProjectFixture();
  request.draftRevision = 7;
  const job = { ...materializeH3Job("github-test", saved, request, "studio"), runId: "run-one" };
  return { request, job };
}

describe("H3 reload and recovery intents", () => {
  test("serializes the exact pending request and review revision before submission", () => {
    const { request } = recoveryFixture();
    const batch: H3DraftBatch = { version: 1, projectId: request.projectId, planSignature: request.planSignature, requests: [request], paused: true };
    const restored = parseH3DraftBatch(JSON.stringify(batch), request.projectId)!;
    expect(restored).toEqual(batch);
    expect(h3RequestWindowKey(restored.requests[0])).toBe(h3RequestWindowKey(request));
    expect(parseH3DraftBatch(JSON.stringify(batch), "other-project")).toBeNull();
    expect(parseH3DraftBatch(JSON.stringify({ ...batch, requests: [{ ...request, attempt: 3 }] }), request.projectId)).toBeNull();
  });

  test("a lost POST response followed by reload uses the existing job without a second submission", async () => {
    const { request, job } = recoveryFixture();
    let posts = 0;
    const transport = (async () => { posts++; throw new Error("Response lost after server dispatch"); }) as typeof fetch;
    await expect(enqueueH3DraftRequest(request, [], transport)).rejects.toThrow("Response lost");
    const restored = await enqueueH3DraftRequest(JSON.parse(JSON.stringify(request)), [job], transport);
    expect(restored.id).toBe(job.id);
    expect(posts).toBe(1);
  });

  test("uncertain provider submissions and terminal jobs are never implicitly resubmitted", async () => {
    const { request, job } = recoveryFixture();
    const noPost = (async () => { throw new Error("Must not submit again"); }) as typeof fetch;
    for (const state of ["submission_unknown", "rendering", "persisting", "failed", "ready", "cancelled"] as H3GenerationJob["state"][]) {
      const existing = { ...job, state };
      expect((await enqueueH3DraftRequest(request, [existing], noPost)).state).toBe(state);
    }
    await expect(enqueueH3DraftRequest({ ...request, prompt: "Changed direction" }, [job], noPost)).rejects.toThrow("conflicts");
  });

  test("a deliberate retry retains the intent and permits only attempts one and two", () => {
    const { job } = recoveryFixture();
    const failed = { ...job, state: "failed" as const };
    const first = nextH3Attempt(failed, [failed], 8);
    expect(first).toMatchObject({ requestIntentId: failed.request.requestIntentId, attempt: 1, draftRevision: 8 });
    const retry = { ...failed, request: first };
    const second = nextH3Attempt(retry, [failed, retry], 9);
    expect(second.attempt).toBe(2);
    expect(() => nextH3Attempt({ ...retry, request: second }, [failed, retry], 10)).toThrow("two revisions");
    expect(() => nextH3Attempt(failed, [failed, { ...retry, state: "submission_unknown" }], 10)).toThrow("existing submission");
  });
});
