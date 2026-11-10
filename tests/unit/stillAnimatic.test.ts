import { expect, test } from "bun:test";
import { reviewedScenePlanningFixture } from "../helpers/sceneProofPlanning";
import { animaticContextSha256, animaticImage, animaticShotAtTime, animaticShotBinding, attachAnimaticJob,
  importStillAnimatic, normalizeStillAnimaticPlan, prepareAnimaticSave, refreshStillAnimaticContext, replaceStillAnimatic, stillAnimaticShotRequest } from "@/components/studio/stillAnimatic";
import { sceneProofContextSha256 } from "@/components/studio/sceneProofs";
import { parseH3StillRequest, buildH3StillDescriptor } from "@/lib/h3StillRequest";
import { materializeAnimaticStill, savedAnimaticStillRequest, assertAnimaticStillJob } from "@/lib/h3AnimaticServer";
import { createPersistableStudioProjectDraft, hydrateStudioProjectDraft } from "@/components/studio/projectPersistence";
import { h3StillDigest } from "@/lib/h3StillProfile";
import { createH3StillJob, assertH3StillJob } from "@/lib/h3StillJobStore";
import type { StillClientRecord } from "@/components/studio/h3StillClient";
import type { StudioJsonObjectStore } from "@/lib/studioProjectObjectStore";

function fixture() {
  const f = reviewedScenePlanningFixture(), input = f.source(), item = input.project.editPlan.timelineItems[0];
  // A 3–4s shot crosses an older placement boundary at 3.5s inside the same scene.
  const placements = input.project.placementPlan!.placements;
  placements[0].songEnd = 3.5; placements[1].songStart = 3.5;
  const bounds = [[0, 72], [72, 96], [96, 120], [120, 180], [180, 240]];
  const manifest = { projectId: f.saved.project.id, fps: 24, masterDuration: 10, totalFrames: 240,
    slots: bounds.map(([startFrame, endFrame], index) => ({ id: `A00${index + 1}`, sceneId: input.sceneProofPlan.scenes[index < 3 ? 0 : 1].id,
      sceneTitle: "Diego's route", timelineItemId: item.id, startFrame, endFrame,
      prompt: "[Static] Medium shot. Diego looks through moving patrons. Dark concrete CLUB_MAIN, amber lamps, red haze.", referenceAssetIds: ["diego", "club"] })) };
  const plan = importStillAnimatic(input, manifest);
  f.saved.draft.storyState.stillAnimaticPlan = plan;
  const shot = plan.shots[1], binding = animaticShotBinding(plan, shot), request = parseH3StillRequest({ shot: stillAnimaticShotRequest(input, plan, shot),
    creativePrompt: shot.prompt, animaticShot: binding, seed: 43, requestIntentId: crypto.randomUUID(), attempt: 0 });
  const record: StillClientRecord = { version: 1, projectId: plan.projectId, context: binding.bindingSha256, request };
  shot.record = record;
  return { ...f, input, manifest, plan, shot, binding, request, record };
}

test("full partition imports with independent exact timing across an old placement", () => {
  const f = fixture(), template = materializeAnimaticStill("github-test", f.saved, f.request, "studio");
  expect(template.target.timelineItemId).toBe("animatic:A002");
  expect(template.target.songStart).toBe(3); expect(template.target.songEnd).toBe(4);
  expect(f.saved.draft.musicVideoProject!.placementPlan!.placements[0].songEnd).toBe(3.5);
  expect(savedAnimaticStillRequest(f.saved, f.binding).request).toEqual(f.request);
  for (const mutate of [(m: typeof f.manifest) => { m.slots[1].startFrame++; },
    (m: typeof f.manifest) => { m.slots[1].endFrame--; }, (m: typeof f.manifest) => { m.masterDuration = 9; },
    (m: typeof f.manifest) => { m.slots[1].id = m.slots[0].id; }]) {
    const invalid = structuredClone(f.manifest); mutate(invalid); expect(() => importStillAnimatic(f.input, invalid)).toThrow();
  }
});

test("forged prompt, frame window, binding and conflicting proof kind fail before inference", () => {
  const f = fixture();
  for (const mutate of [(r: typeof f.request) => { r.shot.songStart = 2; },
    (r: typeof f.request) => { r.creativePrompt += " A different room."; },
    (r: typeof f.request) => { r.animaticShot!.bindingSha256 = "0".repeat(64); }]) {
    const invalid = structuredClone(f.request); mutate(invalid);
    expect(() => materializeAnimaticStill("github-test", f.saved, invalid, "studio")).toThrow();
  }
  expect(() => materializeAnimaticStill("github-foreign", f.saved, f.request, "studio")).toThrow("Project not found");
  expect(() => parseH3StillRequest({ ...f.request, sceneProof: { sceneId: "S01", momentId: "action", bindingSha256: "a".repeat(64) } })).toThrow("scene proof or an animatic");
});

test("ordinary receipt updates preserve bindings; creative changes retain history but hide stale images", () => {
  const f = fixture(), before = animaticShotBinding(f.plan, f.shot);
  f.plan.shots[0].record = { ...f.record, context: animaticShotBinding(f.plan, f.plan.shots[0]).bindingSha256,
    request: { ...f.request, animaticShot: animaticShotBinding(f.plan, f.plan.shots[0]) } };
  expect(animaticShotBinding(f.plan, f.shot)).toEqual(before);
  expect(animaticContextSha256(f.input)).toBe(f.plan.contextSha256);
  const image = { bucket: "studio", objectKey: "media-uploads/github-test/frame.png", sha256: "a".repeat(64), byteLength: 100, width: 2048, height: 1152 };
  f.shot.record!.jobId = `h3-still-${"b".repeat(64)}`;
  f.shot.proof = { jobId: f.shot.record!.jobId, descriptorSha256: "c".repeat(64), result: { master: image, native: image,
    artifactId: `h3-frame-${"d".repeat(64)}`, artifactSha256: "d".repeat(64) } };
  expect(animaticImage(f.plan, f.shot, f.plan.contextSha256)).toEqual(image);
  f.shot.prompt += " Diego turns toward a doorway.";
  expect(normalizeStillAnimaticPlan(f.plan)?.shots[1].proof).toEqual(f.shot.proof);
  expect(animaticImage(f.plan, f.shot, f.plan.contextSha256)).toBe(undefined);
  expect(() => savedAnimaticStillRequest(f.saved, f.binding)).toThrow();
});

test("CAS preparation and normal project save/reload preserve every frame and request", () => {
  const f = fixture(), expected = structuredClone(f.plan), next = structuredClone(f.plan); next.shots[0].title = "A wider establishing view";
  const draft = prepareAnimaticSave(f.saved.project.id, f.saved.draft, next, expected);
  const stored = createPersistableStudioProjectDraft({ ...draft, analysis: null, videoSources: [] });
  expect(hydrateStudioProjectDraft({ draft: stored }).storyState.stillAnimaticPlan).toEqual(next);
  expect(() => prepareAnimaticSave(f.saved.project.id, f.saved.draft, next)).toThrow("changed before saving");
  f.input.sceneProofPlan.scenes[0].direction += " Revised lighting.";
  expect(() => prepareAnimaticSave(f.saved.project.id, f.saved.draft, next, expected)).toThrow();
});

test("unfinished prompt edits preserve all saved shot history through autosave and reload", () => {
  const f = fixture(), originalRecord = structuredClone(f.shot.record);
  f.shot.prompt = "";
  const stored = createPersistableStudioProjectDraft({ ...f.saved.draft, analysis: null, videoSources: [] });
  const restored = hydrateStudioProjectDraft({ draft: stored }).storyState.stillAnimaticPlan!;
  expect(restored.shots.length).toBe(f.plan.shots.length);
  expect(restored.shots[1].record).toEqual(originalRecord);
  expect(restored.shots[1].prompt).toBe("");
  expect(() => stillAnimaticShotRequest(f.input, restored, restored.shots[1])).toThrow("Save the current timed still shot");
  f.plan.shots[1].startFrame++;
  expect(() => createPersistableStudioProjectDraft({ ...f.saved.draft, analysis: null, videoSources: [] })).toThrow("existing history has not been removed");
  expect(f.saved.draft.storyState.stillAnimaticPlan).toBe(f.plan);
});

test("explicit context refresh archives every receipt and admits new work without replaying old intents", () => {
  const f = fixture(), previous = structuredClone(f.plan), previousRecord = structuredClone(f.record);
  f.input.references[0].createdAt = "2026-11-10T00:00:00Z";
  f.input.sceneProofPlan.contextSha256 = sceneProofContextSha256(f.input);
  const next = refreshStillAnimaticContext(f.input, previous);
  expect(next.contextSha256).not.toBe(previous.contextSha256);
  expect(next.priorVersions?.[0].shots[1].record).toEqual(previousRecord);
  expect(next.shots.every(s => !s.record && !s.proof && !s.sourceFrame?.image)).toBe(true);
  const stored = prepareAnimaticSave(f.saved.project.id, f.saved.draft, next, f.plan);
  expect(hydrateStudioProjectDraft({ draft: { ...stored, version: 3 } }).storyState.stillAnimaticPlan?.priorVersions).toEqual(next.priorVersions);
  const shot = stillAnimaticShotRequest(f.input, next, next.shots[1]);
  expect(shot.requestIntentId).not.toBe(previousRecord.request.shot.requestIntentId);
  expect(previous.shots[1].record).toEqual(previousRecord);
  const changedTiming = structuredClone(f.manifest); changedTiming.slots[0].endFrame = 60; changedTiming.slots[1].startFrame = 60;
  const replaced = replaceStillAnimatic(f.input, previous, changedTiming);
  expect(replaced.shots[1].startFrame).toBe(60);
  expect(replaced.priorVersions?.[0].shots[1].startFrame).toBe(72);
});

test("song position selects exact containing frames including reverse seek and final rounding hold", () => {
  const { plan } = fixture();
  for (let frame = 0; frame < plan.totalFrames; frame++) {
    const shot = animaticShotAtTime(plan, (frame + 0.25) / plan.fps);
    expect(shot.startFrame <= frame && frame < shot.endFrame).toBe(true);
  }
  expect(animaticShotAtTime(plan, 4).id).toBe("A003"); expect(animaticShotAtTime(plan, 3).id).toBe("A002");
  expect(animaticShotAtTime(plan, plan.masterDuration).id).toBe("A005");
  expect(animaticShotAtTime(plan, -5).id).toBe("A001");
});

test("owned job store freezes the animatic binding and same-intent replay reuses one job", async () => {
  const f = fixture(), template = materializeAnimaticStill("github-test", f.saved, f.request, "studio");
  template.references = template.references.map(ref => ({ ...ref, etag: '"fixed"' }));
  const receipts = template.references.map(ref => ({ assetId: ref.assetId, etag: ref.etag!, rawSha256: "a".repeat(64) }));
  const descriptor = buildH3StillDescriptor(f.request, template, receipts);
  const objects = new Map<string, unknown>();
  const store: StudioJsonObjectStore = { async read<T>(key: string) { return objects.has(key) ? { value: structuredClone(objects.get(key)) as T, revision: '"one"' } : null; },
    async write(key, data) { if (objects.has(key)) throw new Error("Duplicate write"); objects.set(key, structuredClone(data)); return '"one"'; } };
  const input = { ownerId: "github-test", projectId: f.plan.projectId, descriptor, template, shotRequest: f.request.shot,
    requestIntentId: f.request.requestIntentId, attempt: 0, animaticShot: f.binding };
  const job = await createH3StillJob(input, store); expect(await createH3StillJob(input, store)).toEqual(job);
  expect(job.animaticShot).toEqual(f.binding); expect(() => assertH3StillJob(job)).not.toThrow();
  expect(() => assertAnimaticStillJob(f.saved, job, template)).not.toThrow();
  const forged = structuredClone(job); forged.animaticShot!.shotId = "A099";
  expect(() => assertH3StillJob(forged)).toThrow();
  const ready = { ...job, state: "ready" as const, result: { master: { bucket: "studio", objectKey: "master.png", sha256: "a".repeat(64), byteLength: 100, width: 2048, height: 1152 },
    native: { bucket: "studio", objectKey: "native.png", sha256: "b".repeat(64), byteLength: 100, width: 1344, height: 768 }, artifactId: `h3-frame-${"c".repeat(64)}`, artifactSha256: "c".repeat(64) } };
  expect(attachAnimaticJob(f.plan, f.binding, f.record, ready).shots[1].proof?.jobId).toBe(job.id);
  f.shot.startFrame++;
  expect(() => attachAnimaticJob(f.plan, f.binding, f.record, ready)).toThrow("earlier timed shot");
  expect(h3StillDigest(job)).not.toBe(h3StillDigest(forged));
});
