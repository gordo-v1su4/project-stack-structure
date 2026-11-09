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
  expect(input.project.videoMoments.length).toBe(0); expect(plan.scenes.length).toBe(input.treatment.anchors.length);
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

test("corrupt opted-in scene state keeps its review fence through hydration and subsequent save", () => {
  const { saved } = fixture();
  saved.draft.storyState.sceneProofPlan = {} as SceneProofPlan;
  const restored = hydrateStudioProjectDraft({ draft: saved.draft });
  expect(restored.storyState.sceneProofPlan).toBe(undefined);
  expect(restored.storyState.sceneProofReviewRequired).toBe(true);
  const again = createPersistableStudioProjectDraft({ ...restored, analysis: null, videoSources: [] });
  expect(again.storyState.sceneProofPlan).toBe(undefined);
  expect(again.storyState.sceneProofReviewRequired).toBe(true);
});

test("direction revisions reach actual image prose and rebase seeded earlier scene facts", () => {
  const { plan } = fixture(), original = plan.scenes[0];
  const revised = reviseSceneDirection(original, "Diego crosses CLUB_MAIN under violet shafts.");
  for (const moment of revised.moments) {
    expect(sceneProofPrompt(revised, moment)).toContain("violet shafts");
    expect(sceneProofPrompt(revised, moment).includes("amber doorway")).toBe(false);
  }
  const retyped = reviseSceneDirection(reviseSceneDirection(original, ""), "Diego crosses CLUB_MAIN under violet shafts.");
  expect(retyped.moments.every(moment => Boolean(moment.prompt.trim()))).toBe(true);
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

test("whole-story preparation retains every ordered anchor and ending when music has fewer sections", () => {
  const { input } = fixture(), original = input.treatment.anchors[0], section = input.project.storySections[0];
  input.project.duration = 100;
  input.project.storySections = Array.from({ length: 10 }, (_, i) => ({ ...section, id: `music-${i}`, start: i * 10, end: (i + 1) * 10 }));
  input.treatment.anchors = Array.from({ length: 17 }, (_, i) => ({ ...original, id: `narrative-${i}`, title: `Story beat ${i}`,
    generationPrompt: `Diego reaches CLUB_MAIN marker ${i}.`, description: `Diego reaches marker ${i}.` }));
  const plan = prepareSceneProofPlan(input);
  expect(plan.scenes.map(s => s.anchorId)).toEqual(input.treatment.anchors.map(a => a.id));
  expect(plan.scenes.map(s => s.id)).toEqual(input.treatment.anchors.map(a => a.id));
  expect(plan.scenes.at(-1)!.direction).toBe(input.treatment.anchors.at(-1)!.generationPrompt);
  expect(plan.scenes[0].songStart).toBe(0); expect(plan.scenes.at(-1)!.songEnd).toBe(100);
  plan.scenes.forEach((scene, i) => {
    expect(scene.songEnd > scene.songStart).toBe(true);
    expect(scene.songStart).toBe(i ? plan.scenes[i - 1].songEnd : 0);
    const music = input.project.storySections.find(s => s.id === scene.sectionId)!;
    expect(Math.min(music.end, scene.songEnd) > Math.max(music.start, scene.songStart)).toBe(true);
    expect(scene.review).toBe(undefined);
    expect(scene.moments.every(m => !m.record && !m.proof)).toBe(true);
    expect(sceneProofReviewStatus(plan, scene, plan.contextSha256)).toBe("missing");
  });
  expect(normalizeSceneProofPlan(plan)).toEqual(plan);
});

test("explicit narrative windows cross musical sections without being collapsed to section count", () => {
  const { input } = fixture(), anchor = input.treatment.anchors[0], section = input.project.storySections[0];
  input.project.duration = 30;
  input.project.storySections = Array.from({ length: 3 }, (_, i) => ({ ...section, id: `music-${i}`, start: i * 10, end: (i + 1) * 10 }));
  input.treatment.anchors = [{ ...anchor, songWindow: { start: 0, end: 15 } },
    { ...anchor, id: "ending", songWindow: { start: 15, end: 30 } }];
  const plan = prepareSceneProofPlan(input);
  expect(plan.scenes.map(s => [s.anchorId, s.songStart, s.songEnd, s.sectionId])).toEqual([
    [anchor.id, 0, 15, "music-0"], ["ending", 15, 30, "music-2"],
  ]);
});

test("cross-section role proofs use their actual current cut and authored phase's named actors", () => {
  const { input } = fixture(), anchor = input.treatment.anchors[0], section = input.project.storySections[0];
  const item = input.project.editPlan.timelineItems[0], placement = input.project.placementPlan!.placements[0];
  input.references.push({ ...input.references[0], id: "valentina", role: "character-2", displayName: "Valentina", storagePath: "media-uploads/github-test/references/valentina.png" });
  input.project.duration = 40;
  input.project.storySections = Array.from({ length: 4 }, (_, i) => ({ ...section, id: `music-${i}`, start: i * 10, end: (i + 1) * 10 }));
  input.project.editPlan.timelineItems = input.project.storySections.map((s, i) => ({ ...item, id: `cut-${i}`, sectionId: s.id, start: s.start, end: s.end }));
  input.project.placementPlan!.placements = input.project.editPlan.timelineItems.map((cut, i) => ({ ...placement,
    id: `placement-${i}`, timelineItemId: cut.id, sectionId: cut.sectionId, songStart: cut.start, songEnd: cut.end }));
  input.project.placementPlan!.inputSignature = placementInputSignature(input.project, input.project.placementPlan!.settings);
  input.treatment.anchors = [{ ...anchor, generationPrompt: "CLUB_MAIN contains the declared story phases.", songWindow: { start: 0, end: 30 }, requirements: [
    { id: "entry", momentId: anchor.id, description: "Diego stands at the CLUB_MAIN entry.", durationSeconds: 10, constraints: {} },
    { id: "floor", momentId: anchor.id, description: "Valentina stands at the CLUB_MAIN center.", durationSeconds: 10, constraints: {} },
    { id: "exit", momentId: anchor.id, description: "Diego stands at the CLUB_MAIN exit.", durationSeconds: 10, constraints: {} },
  ] }, { ...anchor, id: "ending", generationPrompt: "Valentina stands at the CLUB_MAIN door.",
    description: "Valentina stands at the CLUB_MAIN door.", songWindow: { start: 30, end: 40 } }];
  const plan = prepareSceneProofPlan(input), scene = plan.scenes[0];
  expect(scene.sectionId).toBe("music-0");
  const shots = scene.moments.map(m => sceneProofShot(input, plan, scene, m));
  expect(shots.map(s => s.timelineItemId)).toEqual(["cut-0", "cut-1", "cut-2"]);
  expect(shots.map(s => s.sectionId)).toEqual(["music-0", "music-1", "music-2"]);
  expect(shots.map(s => s.referenceAssetIds)).toEqual([["diego", "club"], ["club", "valentina"], ["diego", "club", "valentina"]]);
  shots.forEach((shot, i) => {
    const position = scene.songStart + (scene.songEnd - scene.songStart) * [0.1, 0.5, 0.9][i];
    expect(shot.songStart <= position && shot.songEnd > position).toBe(true);
    expect(shot.songEnd - shot.songStart).toBeLessThanOrEqual(12);
    expect(shot.songStart >= scene.songStart && shot.songEnd <= scene.songEnd).toBe(true);
  });
  expect(shots[0].prompt).toContain("Diego stands at the CLUB_MAIN entry.");
  expect(shots[2].prompt).toContain("Diego stands at the CLUB_MAIN exit.");
  expect(shots[2].prompt).toContain("Valentina stands at the CLUB_MAIN door.");
});

test("representative proof cannot switch to a closer adjacent cut or hide missing beginning/ending coverage", () => {
  const { input } = fixture(), placement = input.project.placementPlan!.placements[0];
  input.project.placementPlan!.placements = [{ ...placement, songEnd: 9.5 }, { ...placement, id: "tail", songStart: 9.5 }];
  input.project.placementPlan!.inputSignature = placementInputSignature(input.project, input.project.placementPlan!.settings);
  let plan = prepareSceneProofPlan(input), scene = plan.scenes[0];
  expect(sceneProofShot(input, plan, scene, scene.moments[2]).songEnd).toBe(9.5);
  for (const [songStart, songEnd, roleIndex] of [[2, 10, 0], [0, 8, 2]]) {
    input.project.placementPlan!.placements = [{ ...placement, songStart, songEnd }];
    input.project.placementPlan!.inputSignature = placementInputSignature(input.project, input.project.placementPlan!.settings);
    plan = prepareSceneProofPlan(input); scene = plan.scenes[0];
    expect(() => sceneProofShot(input, plan, scene, scene.moments[roleIndex])).toThrow("at its song position");
  }
});

test("long anchor proofs select authored phases by duration and remain bounded to real current cuts", () => {
  const { input } = fixture();
  input.project.duration = 60; input.project.storySections[0].end = 60;
  input.project.editPlan.timelineItems[0].end = 60;
  input.project.placementPlan!.placements[0].songEnd = 60;
  input.project.placementPlan!.inputSignature = placementInputSignature(input.project, input.project.placementPlan!.settings);
  input.treatment.anchors[0].requirements = [
    { id: "entry", momentId: "arrival", description: "Diego stands beside the CLUB_MAIN entry.", durationSeconds: 12, constraints: {} },
    { id: "floor", momentId: "arrival", description: "Diego stands at the CLUB_MAIN center.", durationSeconds: 36, constraints: {} },
    { id: "exit", momentId: "arrival", description: "Diego stands beside the CLUB_MAIN exit.", durationSeconds: 12, constraints: {} },
  ];
  const plan = prepareSceneProofPlan(input), scene = plan.scenes[0];
  expect(scene.moments[0].prompt).toContain("CLUB_MAIN entry");
  expect(scene.moments[1].prompt).toBe("Diego stands at the CLUB_MAIN center.");
  expect(scene.moments[2].prompt).toContain("CLUB_MAIN exit");
  for (const moment of scene.moments) {
    const shot = sceneProofShot(input, plan, scene, moment);
    expect(shot.songEnd - shot.songStart).toBeLessThanOrEqual(12);
    expect(shot.songStart >= scene.songStart && shot.songEnd <= scene.songEnd).toBe(true);
    expect(shot.prompt).toBe(sceneProofPrompt(scene, moment));
  }
});

test("story duration weights use actual music cues and permit more musical sections than narrative scenes", () => {
  const { input } = fixture(), anchor = input.treatment.anchors[0], section = input.project.storySections[0];
  input.project.duration = 50;
  input.project.storySections = Array.from({ length: 25 }, (_, i) => ({ ...section, id: `music-${i}`, start: i * 2, end: (i + 1) * 2 }));
  input.project.song = { ...input.project.song!, onsets: [19, 39], beats: [] };
  input.treatment.anchors = [{ ...anchor, id: "first", title: "First" }, { ...anchor, id: "middle", title: "Middle" },
    { ...anchor, id: "last", title: "Last", role: "closing" }];
  const plan = prepareSceneProofPlan(input);
  expect(plan.scenes.map(s => [s.songStart, s.songEnd])).toEqual([[0, 19], [19, 39], [39, 50]]);
  input.project.song.onsets = [21, 41];
  expect(sceneProofReviewStatus(plan, plan.scenes[0], sceneProofContextSha256(input))).toBe("stale");
  expect(prepareSceneProofPlan(input).scenes.map(s => [s.songStart, s.songEnd])).toEqual([[0, 21], [21, 41], [41, 50]]);
});

test("malformed or incomplete whole-story timing fails closed without silently losing moments", () => {
  const mutations: Array<(input: SceneProofContext) => void> = [
    input => { input.treatment.anchors = []; },
    input => { input.treatment.anchors.push({ ...input.treatment.anchors[0] }); },
    input => { input.treatment.anchors = Array.from({ length: 25 }, (_, i) => ({ ...input.treatment.anchors[0], id: `beat-${i}` })); },
    input => { input.treatment.anchors[0].songWindow = { start: 1, end: 10 }; },
    input => { input.treatment.anchors[0].songWindow = { start: 0, end: 9 }; },
    input => { input.treatment.anchors = [{ ...input.treatment.anchors[0], songWindow: { start: 0, end: 6 } },
      { ...input.treatment.anchors[0], id: "overlap", songWindow: { start: 5, end: 10 } }]; },
    input => { input.treatment.anchors[0].songWindow = { start: 0, end: 11 }; },
    input => { input.treatment.anchors[0].requirements = [{ id: "bad", momentId: "arrival", description: "Declared action", durationSeconds: NaN, constraints: {} }]; },
    input => { input.treatment.anchors[0].generationPrompt = ""; },
    input => { input.project.storySections[0].start = 1; },
    input => { input.project.duration = NaN; },
  ];
  for (const mutate of mutations) { const { input } = fixture(); mutate(input); expect(() => prepareSceneProofPlan(input)).toThrow(); }
});
