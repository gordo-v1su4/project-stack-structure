import { expect, test } from "bun:test";
import { reviewedScenePlanningFixture } from "../helpers/sceneProofPlanning";
import { h3StillJobFixture, h3StillResultFixture } from "../helpers/h3StillJob";
import { animaticShotBinding, attachAnimaticJob, importStillAnimatic, stillAnimaticShotRequest } from "@/components/studio/stillAnimatic";
import { animaticReviewBinding, reviewAnimatic } from "@/components/studio/animaticReview";
import { animaticMotionRequest } from "@/components/studio/animaticMotion";
import { materializeAnimaticStill } from "@/lib/h3AnimaticServer";
import { assertAnimaticMotionApproved } from "@/lib/h3AnimaticMotionApproval";
import { assertH3FirstFrameMatchesJob } from "@/lib/h3FirstFrameStore";
import { buildH3StillDescriptor, parseH3StillRequest } from "@/lib/h3StillRequest";
import { createH3StillJob, type H3StillJob } from "@/lib/h3StillJobStore";
import { h3GenerationJobId, materializeH3Job, parseH3Request } from "@/lib/h3GenerationServer";
import { H3_CONDITIONING_PREPARATION_VERSION, H3_PROFILE, type H3GenerationJob } from "@/components/studio/h3Generation";
import { assertH3SceneProofsApproved } from "@/lib/h3SceneProofServer";
import { compileH3Prompt } from "@/lib/h3Workflow";
import { firstFrameArtifactFixture } from "../helpers/h3FirstFrame";
import { H3_FIRST_FRAME_PREPARATION, H3_FIRST_FRAME_PROFILE } from "@/components/studio/h3FirstFrame";

const audioUrl = "/api/storage/media?bucket=studio&objectKey=media-uploads%2Fgithub-test%2Fmaster.wav";
async function fixture() {
  const f = reviewedScenePlanningFixture(), input = f.source();
  f.saved.draft.analysis = { ...f.saved.draft.analysis!, duration: 10, storageBucket: "studio", storagePath: "media-uploads/github-test/master.wav" };
  input.project.placementPlan!.placements[0].songEnd = 3.5; input.project.placementPlan!.placements[1].songStart = 3.5;
  const bounds = [[0, 72], [72, 96], [96, 120], [120, 180], [180, 240]];
  let plan = importStillAnimatic(input, { projectId: input.projectId, fps: 24, masterDuration: 10, totalFrames: 240,
    slots: bounds.map(([startFrame, endFrame], i) => ({ id: `A00${i + 1}`, sceneId: input.sceneProofPlan.scenes[i < 3 ? 0 : 1].id,
      sceneTitle: "Club", timelineItemId: input.project.editPlan.timelineItems[0].id, startFrame, endFrame,
      prompt: "[Static] Medium shot. Diego looks through patrons. Dark concrete CLUB_MAIN.", referenceAssetIds: ["diego", "club"] })) });
  f.saved.draft.storyState.stillAnimaticPlan = plan;
  const jobs = new Map<string, H3StillJob>(), objects = h3StillJobFixture().objects;
  const pin = async (job: H3GenerationJob) => {
    const references = job.references.map((r, i) => ({ ...r, etag: `etag-${i}` }));
    return { ...job, references, id: h3GenerationJobId(job.ownerId, job.request, references,
      { profile: job.profile, conditioningPreparationVersion: job.conditioningPreparationVersion, ...(job.firstFrame ? { firstFrame: job.firstFrame } : {}) }) };
  };
  for (let i = 0; i < plan.shots.length; i++) {
    const shot = plan.shots[i], binding = animaticShotBinding(plan, shot);
    const request = parseH3StillRequest({ shot: stillAnimaticShotRequest(input, plan, shot), creativePrompt: shot.prompt,
      animaticShot: binding, seed: 43, requestIntentId: crypto.randomUUID(), attempt: 0 });
    const record = { version: 1 as const, projectId: plan.projectId, context: binding.bindingSha256, request }; shot.record = record;
    const template = await pin(materializeAnimaticStill("github-test", f.saved, request, "studio"));
    const descriptor = buildH3StillDescriptor(request, template, template.references.map((r, j) => ({ assetId: r.assetId, etag: r.etag!, rawSha256: (j ? "b" : "a").repeat(64) })));
    const queued = await createH3StillJob({ ownerId: "github-test", projectId: plan.projectId, descriptor, template,
      shotRequest: request.shot, requestIntentId: request.requestIntentId, attempt: 0, animaticShot: binding }, objects);
    const result = h3StillResultFixture(queued), artifact = firstFrameArtifactFixture(template, result.native.sha256, result.native.byteLength);
    result.artifactId = artifact.id; result.artifactSha256 = artifact.sha256;
    const job: H3StillJob = { ...queued, state: "ready", runId: "run-ready", promptId: "prompt-ready", workflowSha256: "f".repeat(64), result }; jobs.set(job.id, job);
    plan = attachAnimaticJob(plan, binding, record, job); f.saved.draft.storyState.stillAnimaticPlan = plan;
  }
  plan = reviewAnimatic(plan, plan.contextSha256, audioUrl, animaticReviewBinding(plan, plan.contextSha256, audioUrl)!, "approved", "Reviewed full song");
  f.saved.draft.storyState.stillAnimaticPlan = plan;
  const shot = plan.shots[1], request = parseH3Request(animaticMotionRequest(input, plan, shot, audioUrl,
    "[Tracking shot] Medium shot. Diego walks through passing patrons inside dark CLUB_MAIN."));
  const dependencies = { pin, read: async (_owner: string, _project: string, id: string) => jobs.get(id) ?? null };
  return { ...f, plan, shot, request, jobs, dependencies };
}

test("reviewed motion retains exact cross-placement window and carries the immutable composition still", async () => {
  const f = await fixture(), before = JSON.stringify(f.saved);
  const job = materializeH3Job("github-test", f.saved, f.request, "studio");
  expect(job.target.timelineItemId).toBe("animatic:A002"); expect(job.target.songStart).toBe(3); expect(job.target.songEnd).toBe(4);
  expect(f.saved.draft.musicVideoProject!.placementPlan!.placements[0].songEnd).toBe(3.5);
  expect(job.profile).toBe(H3_PROFILE); expect(job.references.map(r => r.role)).toEqual(["identity", "environment", "composition"]);
  expect(job.references[2].objectKey).toBe(f.shot.proof!.result.master.objectKey);
  expect(job.references[2].aesthetic!.originalSha256).toBe(f.shot.proof!.result.master.sha256);
  expect(compileH3Prompt(job).prompt).toContain("reviewed frame");
  await assertH3SceneProofsApproved("github-test", f.saved, "studio", f.dependencies, f.request);
  expect(JSON.stringify(f.saved)).toBe(before);
});

test("changed shot, image, master, review, references, timing and foreign owner fail before motion", async () => {
  const f = await fixture();
  for (const mutate of [(r: typeof f.request) => { r.songEnd = 3.5; },
    (r: typeof f.request) => { r.animaticMotion!.imageSha256 = "f".repeat(64); },
    (r: typeof f.request) => { r.referenceAssetIds.reverse(); },
    (r: typeof f.request) => { r.animaticMotion!.reviewBindingSha256 = "f".repeat(64); }]) {
    const changed = structuredClone(f.request); mutate(changed);
    expect(() => materializeH3Job("github-test", f.saved, changed, "studio")).toThrow();
  }
  expect(() => materializeH3Job("github-foreign", f.saved, f.request, "studio")).toThrow();
  await expect(assertAnimaticMotionApproved("github-foreign", f.saved, "studio", f.request, f.dependencies)).rejects.toThrow();
  f.saved.draft.analysis!.storagePath += ".replacement";
  expect(() => materializeH3Job("github-test", f.saved, f.request, "studio")).toThrow();
  f.saved.draft.analysis!.storagePath = "media-uploads/github-test/master.wav";
  f.saved.draft.storyState.stillAnimaticPlan!.review!.status = "revise";
  expect(() => materializeH3Job("github-test", f.saved, f.request, "studio")).toThrow();
});

test("canonical completed still and current RAW descriptor are checked again by the worker gate", async () => {
  const f = await fixture(), job = f.jobs.get(f.shot.proof!.jobId)!;
  await assertAnimaticMotionApproved("github-test", f.saved, "studio", f.request, f.dependencies);
  job.state = "failed";
  await expect(assertAnimaticMotionApproved("github-test", f.saved, "studio", f.request, f.dependencies)).rejects.toThrow();
  job.state = "ready"; delete job.animaticShot;
  await expect(assertAnimaticMotionApproved("github-test", f.saved, "studio", f.request, f.dependencies)).rejects.toThrow();
  job.animaticShot = animaticShotBinding(f.plan, f.shot);
  const changed = { ...f.dependencies, pin: async (j: H3GenerationJob) => ({ ...await f.dependencies.pin(j), references: j.references.map(r => ({ ...r, etag: "changed" })) }) };
  await expect(assertAnimaticMotionApproved("github-test", f.saved, "studio", f.request, changed)).rejects.toThrow();
});

test("motion binding is strict and cannot downgrade into legacy or be smuggled through still admission", async () => {
  const f = await fixture();
  expect(parseH3Request(f.request)).toEqual(f.request);
  expect(() => parseH3Request({ ...f.request, animaticMotion: { ...f.request.animaticMotion, extra: true } })).toThrow();
  expect(() => parseH3Request({ ...f.request, sceneProofScopeSha256: "a".repeat(64) })).toThrow();
  expect(() => materializeH3Job("github-test", f.saved, f.request, "studio", { profile: "h3-ref2va-int8-v1" })).toThrow();
  expect(() => parseH3StillRequest({ ...f.shot.record!.request, shot: f.request })).toThrow();
  const current = materializeH3Job("github-test", f.saved, f.request, "studio");
  expect(current.id).toBe(h3GenerationJobId("github-test", f.request, current.references,
    { profile: H3_PROFILE, conditioningPreparationVersion: H3_CONDITIONING_PREPARATION_VERSION }));
});

test("I2VA accepts only the exact reviewed native PNG and keeps its separate artifact/profile", async () => {
  const f = await fixture(), reference = materializeH3Job("github-test", f.saved, f.request, "studio");
  const native = f.shot.proof!.result.native;
  // Stills already register this native artifact against the original named references.
  const artifact = firstFrameArtifactFixture(f.jobs.get(f.shot.proof!.jobId)!.template, native.sha256, native.byteLength);
  const request = parseH3Request({ ...f.request, identityPolicyFamily: "sface-yunet-foreground-frontal-v2",
    conditioning: { kind: "first-frame", artifactId: artifact.id, expectedSha256: artifact.body.pngSha256 } });
  const options = { profile: H3_FIRST_FRAME_PROFILE, conditioningPreparationVersion: H3_FIRST_FRAME_PREPARATION, firstFrame: artifact };
  const job = materializeH3Job("github-test", f.saved, request, "studio", options);
  assertH3FirstFrameMatchesJob(artifact, await f.dependencies.pin(job));
  expect(job.profile).toBe(H3_FIRST_FRAME_PROFILE); expect(job.references).toHaveLength(2);
  expect(job.references.some(r => r.assetId.startsWith("animatic-image:"))).toBe(false);
  expect(job.firstFrame?.body.pngSha256).toBe(native.sha256);
  expect(() => materializeH3Job("github-test", f.saved, request, "studio")).toThrow();
  const different = firstFrameArtifactFixture({ ...reference, references: reference.references.slice(0, -1) }, "f".repeat(64));
  const changedRequest = { ...request, conditioning: { kind: "first-frame" as const, artifactId: different.id, expectedSha256: different.body.pngSha256 } };
  expect(() => materializeH3Job("github-test", f.saved, changedRequest, "studio", { ...options, firstFrame: different })).toThrow();
});
