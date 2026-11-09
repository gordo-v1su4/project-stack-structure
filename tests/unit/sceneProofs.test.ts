import { expect, test } from "bun:test";
import { h3ProjectFixture } from "../helpers/h3Project";
import { prepareSceneProofPlan, sceneProofContextSha256, sceneProofReviewStatus, sceneProofShot, sceneMomentBinding,
  attachSceneProofJob, reviewSceneProof, normalizeSceneProofPlan, sceneProofPrompt, reviseSceneDirection, type SceneProofContext, type SceneProofPlan } from "@/components/studio/sceneProofs";
import { prepareSceneProofSave } from "@/components/studio/sceneProofPersistence";
import { createPersistableStudioProjectDraft, hydrateStudioProjectDraft } from "@/components/studio/projectPersistence";
import type { StoryTreatment } from "@/components/studio/storyTreatments";
import type { StillClientRecord } from "@/components/studio/h3StillClient";
import type { H3StillJob } from "@/lib/h3StillJobStore";
import { placementInputSignature } from "@/components/studio/musicVideoProject";

function fixture() {
  const { saved } = h3ProjectFixture();
  const treatment: StoryTreatment = { id: "story-1", kind: "faithful", title: "Arrival", logline: "Diego travels to the club.", synopsis: "A purposeful route.",
    visualThesis: "Connected spaces", endingHook: "The next doorway", expectedReusePercent: 0, expectedGenerationPercent: 100,
    anchors: [{ id: "arrival", title: "Warm route", description: "Diego crosses CLUB_MAIN toward the doorway.", purpose: "Reach the main floor",
      generationPrompt: "Diego crosses CLUB_MAIN toward the amber doorway.", coverage: "missing", candidates: [], selectedCandidateId: null, resolution: "generate" }] };
  saved.draft.storyState.confirmedTreatmentSnapshot = treatment;
  const input: SceneProofContext = { projectId: saved.project.id, project: saved.draft.musicVideoProject!, treatment,
    storyBeats: saved.draft.storyState.storyBeats, references: saved.draft.referenceAssets! };
  return { saved, input, plan: prepareSceneProofPlan(input) };
}
function proof(input: SceneProofContext, initial: SceneProofPlan, roleIndex: number) {
  let plan = structuredClone(initial); const scene = plan.scenes[0], moment = scene.moments[roleIndex];
  const binding = sceneMomentBinding(plan, scene, moment), shot = sceneProofShot(input, plan, scene, moment);
  const record: StillClientRecord = { version: 1, projectId: plan.projectId, context: binding.bindingSha256,
    request: { shot, creativePrompt: sceneProofPrompt(scene, moment), seed: 42, requestIntentId: crypto.randomUUID(), attempt: 0, sceneProof: binding } };
  moment.record = record;
  const id = `h3-still-${String(roleIndex + 1).repeat(64)}`, image = { bucket: "studio", objectKey: `proof/${roleIndex}.png`, sha256: "a".repeat(64), byteLength: 100, width: 2048, height: 1152 };
  const job = { id, projectId: plan.projectId, requestIntentId: record.request.requestIntentId, attempt: 0, state: "ready", sceneProof: binding,
    shotRequest: shot, descriptor: { sha256: "b".repeat(64), body: { seed: 42, target: { songStart: shot.songStart, songEnd: shot.songEnd }, planSignature: shot.planSignature } },
    result: { master: image, native: { ...image, width: 1344, height: 768 }, artifactId: `h3-frame-${"c".repeat(64)}`, artifactSha256: "d".repeat(64) } } as unknown as H3StillJob;
  plan = attachSceneProofJob(plan, binding, record, job);
  return { plan, record, binding, job };
}

test("zero-footage planning uses actual song windows with three unapproved proposed moments", () => {
  const { input, plan } = fixture();
  expect(input.project.videoMoments.length).toBe(0); expect(plan.scenes.length).toBe(input.project.storySections.length);
  expect(plan.scenes[0].songStart).toBe(0); expect(plan.scenes.at(-1)!.songEnd).toBe(10);
  expect(plan.scenes[0].moments.map(m => m.role)).toEqual(["setting", "action", "transition"]);
  expect(plan.scenes[0].referenceAssetIds).toEqual(["diego", "club"]);
  expect(sceneProofReviewStatus(plan, plan.scenes[0], plan.contextSha256)).toBe("missing");
  expect(() => reviewSceneProof(plan, plan.scenes[0].id, "approved", "", plan.contextSha256)).toThrow("three current");
});

test("ready proofs do not approve scenes, reviewed exact proofs survive save/hydration", () => {
  const { input, saved } = fixture(); let { plan } = fixture();
  for (let i = 0; i < 3; i++) plan = proof(input, plan, i).plan;
  expect(sceneProofReviewStatus(plan, plan.scenes[0], plan.contextSha256)).toBe("pending");
  plan = reviewSceneProof(plan, plan.scenes[0].id, "approved", "Observed all three images", plan.contextSha256);
  const draft = prepareSceneProofSave(saved.project.id, saved.draft, plan);
  const persisted = createPersistableStudioProjectDraft({ ...draft, analysis: null, videoSources: [] });
  const restored = hydrateStudioProjectDraft({ draft: persisted });
  expect(restored.storyState.sceneProofPlan).toEqual(plan);
  expect(sceneProofReviewStatus(plan, plan.scenes[0], sceneProofContextSha256(input))).toBe("approved");
  expect(sceneProofContextSha256(input)).toBe(sceneProofContextSha256({ ...input, references: input.references.map(r => ({ ...r, previewUrl: "blob:new" })) }));
  expect(normalizeSceneProofPlan(plan)).toEqual(plan);
});

test("scene edits invalidate only its review; changed shared story/reference/timing stales context", () => {
  const { input } = fixture(); let { plan } = fixture();
  for (let i = 0; i < 3; i++) plan = proof(input, plan, i).plan;
  plan = reviewSceneProof(plan, plan.scenes[0].id, "approved", "", plan.contextSha256);
  plan.scenes[0].direction += " Diego reaches a different doorway.";
  expect(sceneProofReviewStatus(plan, plan.scenes[0], plan.contextSha256)).toBe("missing");
  for (const changed of [{ ...input, treatment: { ...input.treatment, synopsis: "Different journey" } },
    { ...input, references: input.references.map(r => ({ ...r, createdAt: "new-version" })) },
    { ...input, project: { ...input.project, storySections: input.project.storySections.map(s => ({ ...s, end: s.end + 1 })) } }]) {
    expect(sceneProofReviewStatus(plan, plan.scenes[0], sceneProofContextSha256(changed))).toBe("stale");
  }
});

test("late results and stale compare-before-save cannot replace newer scene changes", () => {
  const { input, saved, plan: initial } = fixture(), { plan, record, binding, job } = proof(input, initial, 0);
  const changed = structuredClone(plan); changed.scenes[0].moments[0].prompt += " Revised framing.";
  expect(() => attachSceneProofJob(changed, binding, record, job)).toThrow("earlier scene direction");
  saved.draft.storyState.sceneProofPlan = changed;
  expect(() => prepareSceneProofSave(saved.project.id, saved.draft, plan, initial)).toThrow("changed before saving");
  expect(() => prepareSceneProofSave("other-project", saved.draft, changed, changed)).toThrow("current project");
  expect(attachSceneProofJob(plan, binding, { ...record, jobId: job.id }, job)).toBe(plan);
});

test("corrupt records/proofs and duplicate roles cannot become durable approved directions", () => {
  const { input, plan: initial } = fixture(), { plan } = proof(input, initial, 0);
  for (const mutate of [
    (p: SceneProofPlan) => { p.scenes[0].moments[0].record = {} as StillClientRecord; },
    (p: SceneProofPlan) => { p.scenes[0].moments[0].proof!.result.master.objectKey = ""; },
    (p: SceneProofPlan) => { p.scenes[0].moments[1].role = "setting"; },
    (p: SceneProofPlan) => { p.scenes.push(p.scenes[0]); },
  ]) { const corrupt = structuredClone(plan); mutate(corrupt); expect(normalizeSceneProofPlan(corrupt)).toBe(undefined); }
});

test("direction revisions reach actual image prose and rebase seeded earlier scene facts", () => {
  const { plan } = fixture(), original = plan.scenes[0];
  const revised = reviseSceneDirection(original, "Diego crosses CLUB_MAIN under violet shafts.");
  for (const moment of revised.moments) {
    expect(sceneProofPrompt(revised, moment)).toContain("violet shafts");
    expect(sceneProofPrompt(revised, moment).includes("amber doorway")).toBe(false);
  }
});

test("transition refs include the next named lead while single-lead moments select only mentioned identities", () => {
  const { input } = fixture();
  input.references.push({ ...input.references[0], id: "valentina", role: "character-2", displayName: "Valentina", storagePath: "media-uploads/github-test/references/valentina.png" });
  const first = input.project.storySections[0];
  input.project.storySections = [{ ...first, end: 5 }, { ...first, id: "second", start: 5, end: 10 }];
  input.treatment.anchors.push({ ...input.treatment.anchors[0], id: "next", description: "Valentina crosses CLUB_MAIN.", generationPrompt: "Valentina crosses CLUB_MAIN." });
  input.treatment.sectionAnchorIds = { [first.id]: "arrival", second: "next" };
  input.project.placementPlan!.inputSignature = placementInputSignature(input.project, input.project.placementPlan!.settings);
  const plan = prepareSceneProofPlan(input), scene = plan.scenes[0];
  expect(scene.referenceAssetIds).toEqual(["diego", "club", "valentina"]);
  expect(sceneProofShot(input, plan, scene, scene.moments[1]).referenceAssetIds).toEqual(["diego", "club"]);
  expect(sceneProofShot(input, plan, scene, scene.moments[2]).referenceAssetIds).toEqual(["diego", "club", "valentina"]);
  scene.direction = scene.direction.toLowerCase(); scene.moments[1].prompt = scene.moments[1].prompt.toLowerCase();
  expect(sceneProofShot(input, plan, scene, scene.moments[1]).referenceAssetIds).toEqual(["diego", "club"]);
});

test("representative stills use bounded saved placement windows within long parent items", () => {
  const { input } = fixture();
  input.project.duration = 20;
  input.project.storySections[0].end = 20;
  input.project.editPlan.timelineItems = [{ ...input.project.editPlan.timelineItems[0], start: 0, end: 20 }];
  input.project.placementPlan!.placements = [{ ...input.project.placementPlan!.placements[0], songStart: 0, songEnd: 20 }];
  input.project.placementPlan!.inputSignature = placementInputSignature(input.project, input.project.placementPlan!.settings);
  const plan = prepareSceneProofPlan(input), scene = plan.scenes[0];
  const shot = sceneProofShot(input, plan, scene, scene.moments[2]);
  expect(shot.songEnd - shot.songStart).toBe(5); expect(shot.songStart >= 0 && shot.songEnd <= 20).toBe(true);
  expect(shot.timelineItemId).toBe(input.project.editPlan.timelineItems[0].id);
});
