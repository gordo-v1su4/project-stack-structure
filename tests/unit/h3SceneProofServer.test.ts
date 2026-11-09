import { expect, test } from "bun:test";
import { h3ProjectFixture } from "../helpers/h3Project";
import { h3StillResultFixture } from "../helpers/h3StillJob";
import { attachSceneProofJob, prepareSceneProofPlan, reviewSceneProof, sceneMomentBinding, sceneProofContextSha256, sceneProofPrompt, sceneProofShot,
  sceneReviewSha256, type SceneProofContext } from "@/components/studio/sceneProofs";
import { assertH3SceneProofsApproved, savedH3SceneProofRequest } from "@/lib/h3SceneProofServer";
import { prepareH3StillJob, validateH3StillJobContext } from "@/lib/h3StillServer";
import { createH3StillJob, type H3StillJob } from "@/lib/h3StillJobStore";
import { parseH3StillRequest, type H3StillRequest } from "@/lib/h3StillRequest";
import type { StudioJsonObjectStore } from "@/lib/studioProjectObjectStore";
import { prepareApprovedPlacements } from "@/components/studio/musicVideoProject";
import { createPersistableStudioProjectDraft, hydrateStudioProjectDraft } from "@/components/studio/projectPersistence";

async function fixture(ready = false, split = false) {
  const f = h3ProjectFixture(), rows = new Map<string, unknown>(), jobs = new Map<string, H3StillJob>();
  if (split) {
    const project = f.saved.draft.musicVideoProject!, item = project.editPlan.timelineItems[0];
    project.editPlan.timelineItems = [{ ...item, end: 5 }, { ...item, id: `${item.id}-second`, start: 5 }];
    f.saved.draft.musicVideoProject = prepareApprovedPlacements({ project, videoSources: [] });
  }
  f.saved.draft.storyState.confirmedTreatmentSnapshot!.anchors = [{ id: "arrival", title: "Arrival", description: "Diego reaches CLUB_MAIN.",
    purpose: "Reach the doorway", generationPrompt: "Diego reaches CLUB_MAIN.", coverage: "missing", candidates: [], selectedCandidateId: null, resolution: "generate" }];
  const context: SceneProofContext = { projectId: f.saved.project.id, project: f.saved.draft.musicVideoProject!,
    treatment: f.saved.draft.storyState.confirmedTreatmentSnapshot!, storyBeats: [], references: f.saved.draft.referenceAssets! };
  const plan = prepareSceneProofPlan(context);
  if (split) plan.scenes = [
    { ...structuredClone(plan.scenes[0]), id: "journey-arrival", songEnd: 5 },
    { ...structuredClone(plan.scenes[0]), id: "journey-crossing", songStart: 5 },
  ];
  plan.scenes.forEach(scene => scene.moments.forEach(moment => { moment.prompt = "[Static] Medium shot. Diego stands beside the CLUB_MAIN doorway."; }));
  f.saved.draft.storyState.sceneProofPlan = plan;
  const objects: StudioJsonObjectStore = {
    read: async <T>(key: string) => rows.has(key) ? { value: structuredClone(rows.get(key)) as T, revision: "etag" } : null,
    write: async (key, value) => { rows.set(key, structuredClone(value)); return "etag"; },
  };
  let etag = "original";
  const pin: NonNullable<Parameters<typeof prepareH3StillJob>[2]>["pin"] = async template => ({ ...template,
    references: template.references.map((ref, i) => ({ ...ref, etag: `${etag}-${i}` })) });
  const deps: NonNullable<Parameters<typeof prepareH3StillJob>[2]> = {
    read: async () => f.saved, config: () => ({ bucket: "studio" }) as never,
    validate: async () => undefined, baseline: async () => {}, pin,
    download: async ref => ({ bytes: new TextEncoder().encode(`raw:${ref.assetId}`).buffer, mime: "image/png", etag: ref.etag! }),
    create: async input => { const job = await createH3StillJob(input, objects); jobs.set(job.id, job); return job; }, rejectIntent: async () => true,
  };
  const requests: H3StillRequest[] = [];
  for (const scene of plan.scenes) for (const moment of scene.moments) {
    const binding = sceneMomentBinding(plan, scene, moment);
    const request: H3StillRequest = { shot: sceneProofShot(context, plan, scene, moment), creativePrompt: sceneProofPrompt(scene, moment),
      seed: 12, requestIntentId: crypto.randomUUID(), attempt: 0, sceneProof: binding };
    requests.push(request);
    moment.record = { version: 1, projectId: plan.projectId, context: binding.bindingSha256, request };
    if (ready) {
      const queued = await prepareH3StillJob("github-test", request, deps);
      const job: H3StillJob = { ...queued, state: "ready", runId: "run-ready", promptId: "prompt-ready", workflowSha256: "f".repeat(64), result: h3StillResultFixture(queued) };
      jobs.set(job.id, structuredClone(job));
      f.saved.draft.storyState.sceneProofPlan = attachSceneProofJob(f.saved.draft.storyState.sceneProofPlan!, binding, moment.record, job);
    }
  }
  if (ready) {
    for (const scene of plan.scenes) {
      const current = f.saved.draft.storyState.sceneProofPlan!;
      f.saved.draft.storyState.sceneProofPlan = reviewSceneProof(current, scene.id, "approved", "Reviewed full scene coverage", current.contextSha256);
    }
  }
  const approval = { read: async (owner: string, project: string, id: string) => {
    expect(owner).toBe("github-test"); expect(project).toBe(f.saved.project.id); return jobs.get(id) ?? null;
  }, pin };
  return { ...f, deps, requests, jobs, approval, changeEtag: () => { etag = "changed"; } };
}

test("scene still admission freezes binding and rejects changed saved intent before creation", async () => {
  const f = await fixture(), request = f.requests[0];
  expect(parseH3StillRequest(request).sceneProof).toEqual(request.sceneProof);
  const job = await prepareH3StillJob("github-test", request, f.deps);
  expect(job.sceneProof).toEqual(request.sceneProof);
  await validateH3StillJobContext(job, f.deps);
  await expect(prepareH3StillJob("github-test", { ...request, seed: 13 }, f.deps)).rejects.toThrow("scene previews");
  await expect(prepareH3StillJob("github-test", { ...request, shot: { ...request.shot, songEnd: 4 } }, f.deps)).rejects.toThrow("scene previews");
  f.saved.draft.storyState.sceneProofPlan!.scenes[0].moments[0].record!.request.requestIntentId = crypto.randomUUID();
  await expect(validateH3StillJobContext(job, f.deps)).rejects.toThrow("scene previews");
});

test("scene proof metadata accepts only bounded scene IDs, declared roles and exact hashes", async () => {
  const f = await fixture(), request = f.requests[0];
  for (const sceneProof of [null, { ...request.sceneProof, sceneId: "x".repeat(201) },
    { ...request.sceneProof, sceneId: "verse\n" }, { ...request.sceneProof, momentId: "custom" },
    { ...request.sceneProof, bindingSha256: "A".repeat(64) }, { ...request.sceneProof, workflow: "injected" }]) {
    expect(() => parseH3StillRequest({ ...request, sceneProof })).toThrow("scene preview binding");
  }
});

test("edited scene direction must reach the frozen still prose and raw per-moment prose is rejected", async () => {
  const f = await fixture(), original = f.requests[0];
  const oldJob = await prepareH3StillJob("github-test", original, f.deps);
  const plan = f.saved.draft.storyState.sceneProofPlan!, scene = plan.scenes[0], moment = scene.moments[0];
  scene.direction = "Diego reaches the amber CLUB_MAIN doorway.";
  await expect(validateH3StillJobContext(oldJob, f.deps)).rejects.toThrow("scene previews");
  const binding = sceneMomentBinding(plan, scene, moment), context: SceneProofContext = {
    projectId: f.saved.project.id, project: f.saved.draft.musicVideoProject!, treatment: f.saved.draft.storyState.confirmedTreatmentSnapshot!,
    storyBeats: f.saved.draft.storyState.storyBeats, references: f.saved.draft.referenceAssets! };
  const revised: H3StillRequest = { ...original, shot: sceneProofShot(context, plan, scene, moment),
    sceneProof: binding, creativePrompt: sceneProofPrompt(scene, moment), requestIntentId: crypto.randomUUID() };
  moment.record = { version: 1, projectId: plan.projectId, context: binding.bindingSha256,
    request: { ...revised, creativePrompt: moment.prompt } };
  expect(() => savedH3SceneProofRequest(f.saved, binding)).toThrow("scene previews");
  moment.record.request = revised;
  const job = await prepareH3StillJob("github-test", revised, f.deps);
  expect(job.descriptor.body.prompt).toContain("reaches the amber");
  expect(job.shotRequest.prompt).toBe(sceneProofPrompt(scene, moment));
});

test("video gate requires reviewed owned ready jobs and actual current reference pins", async () => {
  const f = await fixture(true);
  await assertH3SceneProofsApproved("github-test", f.saved, "studio", f.approval);
  f.changeEtag();
  await expect(assertH3SceneProofsApproved("github-test", f.saved, "studio", f.approval)).rejects.toThrow("raw references changed");
});

test("distinct narrative scenes can divide one musical section and cover the whole master", async () => {
  const f = await fixture(true, true);
  expect(f.saved.draft.storyState.sceneProofPlan!.scenes).toHaveLength(2);
  expect(f.saved.draft.musicVideoProject!.storySections).toHaveLength(1);
  await assertH3SceneProofsApproved("github-test", f.saved, "studio", f.approval);
});

test("missing, overlapping, reordered or incomplete narrative windows cannot authorize video", async () => {
  for (const variant of ["gap", "overlap", "reordered", "missing", "start", "end"] as const) {
    const f = await fixture(true, true), plan = f.saved.draft.storyState.sceneProofPlan!;
    if (variant === "gap") plan.scenes[1].songStart += 0.01;
    if (variant === "overlap") plan.scenes[1].songStart -= 0.01;
    if (variant === "reordered") plan.scenes.reverse();
    if (variant === "missing") plan.scenes.pop();
    if (variant === "start") plan.scenes[0].songStart = 0.01;
    if (variant === "end") plan.scenes[1].songEnd = 9.99;
    await expect(assertH3SceneProofsApproved("github-test", f.saved, "studio", f.approval)).rejects.toThrow("scene previews");
  }
});

test("scene source links require a confirmed treatment anchor and an overlapping current musical section", async () => {
  for (const variant of ["unknown-anchor", "unknown-section", "nonoverlapping-section"] as const) {
    const f = await fixture(), plan = f.saved.draft.storyState.sceneProofPlan!, scene = plan.scenes[0], moment = scene.moments[0];
    if (variant === "unknown-anchor") scene.anchorId = "invented-journey";
    if (variant === "unknown-section") scene.sectionId = "invented-section";
    if (variant === "nonoverlapping-section") {
      f.saved.draft.musicVideoProject!.storySections.push({ ...f.saved.draft.musicVideoProject!.storySections[0], id: "outside-scene", start: 10, end: 11 });
      scene.sectionId = "outside-scene";
      plan.contextSha256 = sceneProofContextSha256({ projectId: f.saved.project.id, project: f.saved.draft.musicVideoProject!,
        treatment: f.saved.draft.storyState.confirmedTreatmentSnapshot!, storyBeats: [], references: f.saved.draft.referenceAssets! });
    }
    const binding = sceneMomentBinding(plan, scene, moment);
    moment.record!.context = binding.bindingSha256;
    moment.record!.request.sceneProof = binding;
    expect(() => savedH3SceneProofRequest(f.saved, binding)).toThrow("scene previews");
  }
});

test("malformed opted-in preview state cannot become legacy video admission after hydration and save", async () => {
  const f = await fixture(), plan = f.saved.draft.storyState.sceneProofPlan!;
  plan.scenes = [];
  const hydrated = hydrateStudioProjectDraft({ draft: f.saved.draft });
  expect(hydrated.storyState.sceneProofPlan).toBe(undefined);
  expect(hydrated.storyState.sceneProofReviewRequired).toBe(true);
  const normalized = createPersistableStudioProjectDraft({ ...hydrated, analysis: null, videoSources: [] });
  expect(normalized.storyState.sceneProofPlan).toBe(undefined);
  expect(normalized.storyState.sceneProofReviewRequired).toBe(true);
  f.saved.draft = normalized;
  await expect(assertH3SceneProofsApproved("github-test", f.saved, "studio", f.approval)).rejects.toThrow("scene previews");
});

test("client-copied master/native/artifact or descriptor claims cannot approve video", async () => {
  for (const field of ["master", "native", "artifact", "descriptor", "job"] as const) {
    const f = await fixture(true), plan = f.saved.draft.storyState.sceneProofPlan!, scene = plan.scenes[0], proof = scene.moments[0].proof!;
    if (field === "master" || field === "native") proof.result[field].sha256 = "1".repeat(64);
    if (field === "artifact") proof.result.artifactSha256 = "1".repeat(64);
    if (field === "descriptor") proof.descriptorSha256 = "1".repeat(64);
    if (field === "job") f.jobs.delete(proof.jobId);
    scene.review!.bindingSha256 = sceneReviewSha256(plan, scene);
    await expect(assertH3SceneProofsApproved("github-test", f.saved, "studio", f.approval)).rejects.toThrow();
  }
});

test("scene context, complete whole-song coverage and approval are required only when plan exists", async () => {
  const pending = await fixture();
  await expect(assertH3SceneProofsApproved("github-test", pending.saved, "studio", pending.approval)).rejects.toThrow("scene previews");
  const f = await fixture(true), before = structuredClone(f.saved);
  f.saved.draft.musicVideoProject!.storySections[0].prompt = "New story direction";
  await expect(assertH3SceneProofsApproved("github-test", f.saved, "studio", f.approval)).rejects.toThrow("scene previews");
  f.saved = before;
  f.saved.draft.storyState.sceneProofPlan!.scenes = [];
  await expect(assertH3SceneProofsApproved("github-test", f.saved, "studio", f.approval)).rejects.toThrow("scene previews");
  delete f.saved.draft.storyState.sceneProofPlan;
  await assertH3SceneProofsApproved("github-test", f.saved, "studio", f.approval);
});
