import { expect, test } from "bun:test";
import { reviewedScenePlanningFixture } from "../helpers/sceneProofPlanning";
import { currentSceneProofPlanningPlan, sceneProofScopeSha256, sceneProofWindowScope } from "@/components/studio/sceneProofPlanning";
import { buildH3DraftPlanningInput, buildPlannedH3DraftRequests } from "@/components/studio/h3PlannedDraftRequests";
import { generationScopeSha256 } from "@/components/studio/generationScope";
import { reviewSceneProof, sceneProofContextSha256, sceneProofReviewStatus } from "@/components/studio/sceneProofs";
import { buildEditPlanPreviewSegments } from "@/components/studio/musicVideoProject";
import { planH3DraftWindows } from "@/components/studio/h3DraftPlan";
import { loadH3ShotPlanningContext, executeH3ShotPlanning } from "@/lib/h3ShotPlanningServer";
import { generateH3ShotPlan, type H3ShotAuthorInput } from "@/lib/h3ShotPlanningGateway";
import { readH3ShotPlan, storeH3ShotPlan } from "@/lib/h3ShotPlanningStore";
import type { StudioJsonObjectStore } from "@/lib/studioProjectObjectStore";
import { parseH3Request, materializeH3Job } from "@/lib/h3GenerationServer";
import { h3ProjectFixture } from "../helpers/h3Project";

const build = (f: ReturnType<typeof reviewedScenePlanningFixture>) => buildH3DraftPlanningInput(f.saved.project.id, f.project, f.context.references, f.planningContext());
const deps = (f: ReturnType<typeof reviewedScenePlanningFixture>) => ({ read: async () => f.saved, validate: async () => build(f).planSignature });

test("approved scene direction and all three moments replace stale timeline prose in identical client/server author and reviewer input", async () => {
  const f = reviewedScenePlanningFixture();
  f.plan.scenes[0].direction = "Diego follows the revised amber route in CLUB_MAIN.";
  f.plan.scenes[0].moments.forEach(moment => { moment.prompt = `Diego performs the reviewed ${moment.role} beside CLUB_MAIN.`; });
  f.prove(0);
  const input = build(f), expected = { planSignature: input.planSignature, bindingSha256: input.bindingSha256 };
  expect((await loadH3ShotPlanningContext(f.saved.project.ownerId, f.saved.project.id, expected, deps(f))).input).toEqual(input);
  expect(input.groups[0].approvedDirection).toContain("revised amber route");
  expect(input.groups[0].approvedDirection).not.toContain(f.project.editPlan.timelineItems[0].prompt);
  for (const role of ["setting", "action", "transition"]) expect(input.groups[0].approvedDirection).toContain(`reviewed ${role}`);
  const calls: { path: string; body: unknown }[] = [];
  const result = await generateH3ShotPlan(input, { env: { SCENE_CAPTION_SMART_GATEWAY_URL: "http://gateway.test", SCENE_CAPTION_SMART_GATEWAY_TOKEN: "fixture" },
    fetchImpl: (async (url, options) => {
      const body = JSON.parse(String(options?.body)), path = new URL(String(url)).pathname; calls.push({ path, body });
      if (path.endsWith("author")) {
        const wire = body as H3ShotAuthorInput;
        return Response.json({ version: 1, bindingSha256: wire.bindingSha256, directions: wire.windows.map(window => ({ windowId: window.id,
          direction: "[Static] Medium shot. Diego follows the revised amber route in CLUB_MAIN.", entryState: `state ${window.id}`, exitState: `state ${window.id + 1}`, actionIndices: [] })) });
      }
      return Response.json({ version: 1, bindingSha256: body.input.bindingSha256, candidateSha256: body.candidateSha256, status: "passed", violations: [] });
    }) as typeof fetch });
  expect(calls.map(call => call.path)).toEqual(["/story/shots/author", "/story/shots/review"]);
  for (const call of calls) expect(JSON.stringify(call.body)).toContain("revised amber route");
  const requests = buildPlannedH3DraftRequests({ projectId: f.saved.project.id, windows: planH3DraftWindows(buildEditPlanPreviewSegments({ project: f.project, videoSources: [] })),
    jobs: [], draftRevision: 0, referenceAssets: f.context.references, planningInput: input, planningResult: result });
  expect(requests[0].prompt).toContain("revised amber route");
  expect(requests[0].sceneProofScopeSha256).toBe(sceneProofScopeSha256(f.source(), requests[0]));
  expect(requests[0].conditioning).toBe(undefined);
  expect(parseH3Request(requests[0]).sceneProofScopeSha256).toBe(requests[0].sceneProofScopeSha256);
});

test("cross-scene cuts retain ordered exact intersections and relevant scene reference authorities", () => {
  const f = reviewedScenePlanningFixture(), scope = sceneProofWindowScope(f.plan, { songStart: 4, songEnd: 6 });
  expect(scope.scenes.map(scene => [scene.sceneId, scene.intersectionStart, scene.intersectionEnd])).toEqual([["amber", 4, 5], ["blue", 5, 6]]);
  const first = sceneProofScopeSha256(f.source(), { songStart: 0, songEnd: 5 });
  const review = structuredClone(f.plan.scenes[0].review);
  f.plan.scenes[1].direction = "Diego turns beside the blue doorway in CLUB_MAIN."; f.prove(1);
  expect(sceneProofScopeSha256(f.source(), { songStart: 0, songEnd: 5 })).toBe(first);
  expect(f.plan.scenes[0].review).toEqual(review);
  expect(sceneProofReviewStatus(f.plan, f.plan.scenes[0], f.plan.contextSha256)).toBe("approved");
  expect(generationScopeSha256(sceneProofWindowScope(f.plan, { songStart: 4, songEnd: 6 }))).not.toBe(generationScopeSha256(scope));
  f.plan.scenes[0].review!.note = "Changed UI note"; f.plan.scenes[0].review!.reviewedAt = "2026-11-09T00:00:00Z";
  expect(sceneProofScopeSha256(f.source(), { songStart: 0, songEnd: 5 })).toBe(first);
});

test("new automatic video references stay inside its approved scene packet, excluding an unrelated environment", () => {
  const f = reviewedScenePlanningFixture();
  f.context.references.push({ ...f.context.references[1], id: "unreviewed-roof", displayName: "ROOF", storagePath: "media-uploads/github-test/references/roof.png" });
  f.plan.contextSha256 = sceneProofContextSha256(f.context); f.prove(0); f.prove(1);
  const input = build(f), result = { version: 1 as const, bindingSha256: input.bindingSha256,
    directions: input.groups.flatMap(group => group.windows.map((window, index) => ({ windowKey: window.key, direction: "[Static] Medium shot. Diego reaches CLUB_MAIN.",
      entryState: `state ${index}`, exitState: `state ${index + 1}`, actionIndices: [] }))) };
  const requests = buildPlannedH3DraftRequests({ projectId: f.saved.project.id,
    windows: planH3DraftWindows(buildEditPlanPreviewSegments({ project: f.project, videoSources: [] })), jobs: [], draftRevision: 0,
    referenceAssets: f.context.references, planningInput: input, planningResult: result });
  expect(requests.every(request => request.referenceAssetIds.join(",") === "diego,club")).toBe(true);
});

test("missing opted-in plan, stale context, invalid windows and unreviewed directions fail before planning", () => {
  for (const variant of ["missing", "stale", "gap", "overlap", "reordered", "unreviewed", "anchor", "section"] as const) {
    const f = reviewedScenePlanningFixture();
    if (variant === "missing") { expect(() => currentSceneProofPlanningPlan({ ...f.source(), sceneProofPlan: undefined })).toThrow(); continue; }
    if (variant === "stale") f.plan.contextSha256 = "0".repeat(64);
    if (variant === "gap") f.plan.scenes[1].songStart += 0.1;
    if (variant === "overlap") f.plan.scenes[1].songStart -= 0.1;
    if (variant === "reordered") f.plan.scenes.reverse();
    if (variant === "unreviewed") f.plan.scenes[0].direction += " Diego stops.";
    if (variant === "anchor") f.plan.scenes[0].anchorId = "unknown";
    if (variant === "section") f.plan.scenes[0].sectionId = "unknown";
    expect(() => build(f)).toThrow();
  }
});

test("approved scene prose admits the service's exact 4000-character bound and rejects longer input before model work", async () => {
  const f = reviewedScenePlanningFixture(), first = build(f);
  f.plan.scenes[0].direction += "x".repeat(4000 - first.groups[0].approvedDirection.length); f.prove(0);
  const admitted = build(f);
  expect(admitted.groups[0].approvedDirection.length).toBe(4000);
  const dependencies = { read: async () => f.saved, validate: async () => admitted.planSignature };
  expect((await loadH3ShotPlanningContext(f.saved.project.ownerId, f.saved.project.id,
    { planSignature: admitted.planSignature, bindingSha256: admitted.bindingSha256 }, dependencies)).input).toEqual(admitted);
  f.plan.scenes[0].direction += "x"; f.prove(0);
  expect(() => build(f)).toThrow("Shorten the scene direction and setting/action/transition prose");
  let modelCalls = 0, writes = 0;
  await expect(executeH3ShotPlanning({ ownerId: f.saved.project.ownerId, projectId: f.saved.project.id,
    planSignature: admitted.planSignature, bindingSha256: admitted.bindingSha256 }, {
    load: (owner, project, expected) => loadH3ShotPlanningContext(owner, project, expected, dependencies), read: async () => null,
    generate: async () => { modelCalls++; throw new Error("Unexpected model work"); },
    store: async () => { writes++; throw new Error("Unexpected plan write"); },
  })).rejects.toThrow("bounded shot planning context");
  expect(modelCalls).toBe(0); expect(writes).toBe(0);
});

test("changed scene direction or proof invalidates the issued cache and late worker result without changing generation scope", async () => {
  const f = reviewedScenePlanningFixture(), first = build(f), records = new Map<string, unknown>();
  const objects: StudioJsonObjectStore = { read: async <T>(key: string) => records.has(key) ? { value: records.get(key) as T, revision: "etag" } : null,
    write: async (key, value) => { records.set(key, value); return "etag"; } };
  const result = { version: 1 as const, bindingSha256: first.bindingSha256, directions: first.groups.flatMap(group => group.windows.map((window, index) => ({ windowKey: window.key,
    direction: "[Static] Medium shot. Diego reaches CLUB_MAIN.", entryState: `state ${index}`, exitState: `state ${index + 1}`, actionIndices: [] }))) };
  await storeH3ShotPlan(f.saved.project.ownerId, f.saved.project.id, first, result, objects);
  expect(await readH3ShotPlan(f.saved.project.ownerId, f.saved.project.id, first, objects)).toEqual(result);
  f.plan.scenes[0].direction += " Diego reaches the rail."; f.prove(0);
  const second = build(f);
  expect(second.planSignature).toBe(first.planSignature);
  expect(second.bindingSha256).not.toBe(first.bindingSha256);
  expect(await readH3ShotPlan(f.saved.project.ownerId, f.saved.project.id, second, objects)).toBeNull();
  const reference = { ownerId: f.saved.project.ownerId, projectId: f.saved.project.id, planSignature: second.planSignature, bindingSha256: second.bindingSha256 };
  let written = 0;
  await expect(executeH3ShotPlanning(reference, { load: (owner, project, expected) => loadH3ShotPlanningContext(owner, project, expected, deps(f)), read: async () => null,
    generate: async input => {
      f.plan.scenes[0].moments[0].proof!.descriptorSha256 = "e".repeat(64);
      f.plan.scenes[0].review = reviewSceneProof(f.plan, f.plan.scenes[0].id, "approved", "Reviewed new proof", f.plan.contextSha256).scenes[0].review;
      return { ...result, bindingSha256: input.bindingSha256 }; },
    store: async () => { written++; return result; } })).rejects.toThrow("planning context changed");
  expect(written).toBe(0);
});

test("legacy requests and already-issued jobs retain exact missing-field bytes", () => {
  const f = h3ProjectFixture(), before = materializeH3Job(f.saved.project.ownerId, f.saved, f.request, "studio");
  expect(Object.hasOwn(parseH3Request(f.request), "sceneProofScopeSha256")).toBe(false);
  expect(materializeH3Job(f.saved.project.ownerId, f.saved, f.request, "studio").id).toBe(before.id);
  const r = reviewedScenePlanningFixture(), input = build(r), old = materializeH3Job(r.saved.project.ownerId, r.saved, r.request, "studio");
  const snapshot = JSON.stringify(old);
  const requests = buildPlannedH3DraftRequests({ projectId: r.saved.project.id, windows: [planH3DraftWindows(buildEditPlanPreviewSegments({ project: r.project, videoSources: [] }))[0]],
    jobs: [old], draftRevision: 0, referenceAssets: r.context.references, planningInput: input });
  expect(requests[0]).toBe(old.request); expect(JSON.stringify(old)).toBe(snapshot);
});
