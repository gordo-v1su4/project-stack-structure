import { generationScopeSha256, effectiveGenerationScope } from "./generationScope";
import { sceneProofContextSha256, type SceneProofContext, type SceneProofPlan } from "./sceneProofs";
import { assertStillClientJob, parseStillClientRecord, type StillClientRecord } from "./h3StillClient";
import type { H3GenerationRequest } from "./h3Generation";
import type { H3StillImage, H3StillJob, H3StillResult } from "@/lib/h3StillJobStore";
import type { PersistedStudioProjectDraft } from "./projectPersistence";

export type AnimaticShotBinding = { shotId: string; bindingSha256: string };
export type AnimaticShot = {
  id: string; sceneId: string; title: string; sourceTimelineItemId: string;
  startFrame: number; endFrame: number; prompt: string; referenceAssetIds: string[];
  sourceFrame?: { sourceId: number; sourceSecond: number; sourceSha256: string; image?: H3StillImage };
  record?: StillClientRecord;
  proof?: { jobId: string; descriptorSha256: string; result: H3StillResult };
};
export type StillAnimaticPlan = {
  version: 1; projectId: string; contextSha256: string; fps: number;
  masterDuration: number; totalFrames: number; shots: AnimaticShot[];
  review?: { status: "approved" | "revise"; bindingSha256: string; reviewedAt: string; note: string };
  priorVersions?: Array<{ contextSha256: string; fps: number; masterDuration: number; totalFrames: number;
    shots: AnimaticShot[]; archivedAt: string }>;
};
export type AnimaticContext = SceneProofContext & { sceneProofPlan: SceneProofPlan };
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,96}$/.test(value);
const same = (a: unknown, b: unknown) => generationScopeSha256(a) === generationScopeSha256(b);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const imageValid = (image: H3StillImage) => Boolean(image && typeof image.bucket === "string" && image.bucket
  && typeof image.objectKey === "string" && image.objectKey && hash(image.sha256)
  && Number.isSafeInteger(image.byteLength) && image.byteLength > 0 && image.byteLength <= 32 * 1024 * 1024
  && Number.isSafeInteger(image.width) && image.width > 0 && Number.isSafeInteger(image.height) && image.height > 0);

/** Reviews, intents and image completion do not change creative authority. */
export function animaticContextSha256(input: AnimaticContext) {
  return generationScopeSha256({ context: sceneProofContextSha256(input),
    scenes: input.sceneProofPlan.scenes.map(({ id, sectionId, anchorId, title, songStart, songEnd, direction, referenceAssetIds }) =>
      ({ id, sectionId, anchorId, title, songStart, songEnd, direction, referenceAssetIds })) });
}

export function animaticShotBinding(plan: StillAnimaticPlan, shot: AnimaticShot): AnimaticShotBinding {
  return { shotId: shot.id, bindingSha256: generationScopeSha256({ projectId: plan.projectId, context: plan.contextSha256,
    fps: plan.fps, masterDuration: plan.masterDuration, totalFrames: plan.totalFrames,
    shot: { id: shot.id, sceneId: shot.sceneId, title: shot.title, sourceTimelineItemId: shot.sourceTimelineItemId,
      startFrame: shot.startFrame, endFrame: shot.endFrame, prompt: shot.prompt, referenceAssetIds: shot.referenceAssetIds,
      sourceFrame: shot.sourceFrame ? { ...shot.sourceFrame, image: undefined } : undefined } }) };
}

/** The complete partition is mandatory; gaps or overlaps cannot disappear on load. */
export function normalizeStillAnimaticPlan(value: unknown): StillAnimaticPlan | undefined {
  try {
    const plan = value as StillAnimaticPlan;
    if (!plan || plan.version !== 1 || !id(plan.projectId) || !hash(plan.contextSha256)
      || !Number.isInteger(plan.fps) || plan.fps < 1 || plan.fps > 120
      || !Number.isFinite(plan.masterDuration) || plan.masterDuration <= 0 || plan.masterDuration > 3600
      || plan.totalFrames !== Math.ceil(plan.masterDuration * plan.fps)
      || !Array.isArray(plan.shots) || !plan.shots.length || plan.shots.length > 2000
      || JSON.stringify(plan).length > 8_000_000 || new Set(plan.shots.map(s => s.id)).size !== plan.shots.length) return undefined;
    let frame = 0;
    for (const shot of plan.shots) {
      if (!shot || !id(shot.id) || !id(shot.sceneId) || typeof shot.title !== "string" || shot.title.length > 200
        || typeof shot.sourceTimelineItemId !== "string" || !shot.sourceTimelineItemId || shot.sourceTimelineItemId.length > 500
        || shot.startFrame !== frame || !Number.isSafeInteger(shot.endFrame) || shot.endFrame <= frame || shot.endFrame > plan.totalFrames
        || shot.endFrame - frame > plan.fps * 12 || typeof shot.prompt !== "string" || shot.prompt.length > 6000
        || !Array.isArray(shot.referenceAssetIds) || shot.referenceAssetIds.length > 9
        || shot.referenceAssetIds.some(r => typeof r !== "string" || !r || r.length > 200)
        || new Set(shot.referenceAssetIds).size !== shot.referenceAssetIds.length) return undefined;
      frame = shot.endFrame;
      if (shot.sourceFrame) {
        const source = shot.sourceFrame;
        if (!Number.isSafeInteger(source.sourceId) || !Number.isFinite(source.sourceSecond) || source.sourceSecond < 0
          || !hash(source.sourceSha256) || (source.image && !imageValid(source.image)) || shot.record || shot.proof) return undefined;
      } else if (!shot.referenceAssetIds.length) return undefined;
      if (shot.record && (!parseStillClientRecord(shot.record, plan.projectId)
        || shot.record.request.animaticShot?.shotId !== shot.id
        || shot.record.context !== shot.record.request.animaticShot.bindingSha256)) return undefined;
      if (shot.proof && (!shot.record || shot.record.jobId !== shot.proof.jobId || !/^h3-still-[a-f0-9]{64}$/.test(shot.proof.jobId)
        || !hash(shot.proof.descriptorSha256) || !imageValid(shot.proof.result?.master) || !imageValid(shot.proof.result?.native)
        || !hash(shot.proof.result?.artifactSha256) || shot.proof.result.artifactId !== `h3-frame-${shot.proof.result.artifactSha256}`)) return undefined;
    }
    if (frame !== plan.totalFrames) return undefined;
    if (plan.priorVersions && (!Array.isArray(plan.priorVersions) || plan.priorVersions.length > 32
      || plan.priorVersions.some(p => !p || !Number.isFinite(Date.parse(p.archivedAt))
        || !normalizeStillAnimaticPlan({ version: 1, projectId: plan.projectId, contextSha256: p.contextSha256,
          fps: p.fps, masterDuration: p.masterDuration, totalFrames: p.totalFrames, shots: p.shots })))) return undefined;
    if (plan.review && (!["approved", "revise"].includes(plan.review.status) || !hash(plan.review.bindingSha256)
      || typeof plan.review.note !== "string" || plan.review.note.length > 2000 || !Number.isFinite(Date.parse(plan.review.reviewedAt)))) return undefined;
    return clone(plan);
  } catch { return undefined; }
}

/** Adopt planning data without importing old intents, images or approvals. */
export function importStillAnimatic(input: AnimaticContext, value: unknown): StillAnimaticPlan {
  const manifest = value as { projectId: string; fps: number; totalFrames: number; masterDuration: number;
    slots: Array<AnimaticShot & { sceneTitle: string; timelineItemId: string }> };
  if (!manifest || manifest.projectId !== input.projectId || !Array.isArray(manifest.slots)) throw new Error("Choose this project's full-song still plan.");
  const plan: StillAnimaticPlan = { version: 1, projectId: input.projectId, contextSha256: animaticContextSha256(input),
    fps: manifest.fps, totalFrames: manifest.totalFrames, masterDuration: manifest.masterDuration,
    shots: manifest.slots.map(s => ({ id: s.id, sceneId: s.sceneId, title: s.sceneTitle, sourceTimelineItemId: s.timelineItemId,
      startFrame: s.startFrame, endFrame: s.endFrame, prompt: s.prompt, referenceAssetIds: s.referenceAssetIds,
      ...(s.sourceFrame ? { sourceFrame: { sourceId: s.sourceFrame.sourceId, sourceSecond: s.sourceFrame.sourceSecond, sourceSha256: s.sourceFrame.sourceSha256 } } : {}) })) };
  // The external v5 plan calls retained frames sourceStill; accept only its provenance fields.
  plan.shots.forEach((s, index) => {
    const source = (manifest.slots[index] as unknown as { sourceStill?: AnimaticShot["sourceFrame"] }).sourceStill;
    if (source) s.sourceFrame = { sourceId: source.sourceId, sourceSecond: source.sourceSecond, sourceSha256: source.sourceSha256 };
  });
  if (!normalizeStillAnimaticPlan(plan) || Math.abs(plan.masterDuration - input.project.duration) > 0.001) throw new Error("The still plan must partition the complete original master on exact frame boundaries.");
  for (const shot of plan.shots) {
    const scene = input.sceneProofPlan.scenes.find(s => s.id === shot.sceneId);
    const target = input.project.editPlan.timelineItems.find(t => t.id === shot.sourceTimelineItemId);
    if (!scene || !target || !shot.prompt.trim() || shot.startFrame / plan.fps < scene.songStart - 1 / plan.fps
      || shot.endFrame / plan.fps > scene.songEnd + 1 / plan.fps
      || shot.referenceAssetIds.some(r => !input.references.some(ref => ref.id === r && ref.storageStatus === "uploaded"))) throw new Error("A still shot differs from the current scene, provenance or named references.");
  }
  return plan;
}

/** Explicit adoption keeps previous immutable receipts outside the active cut. */
export function replaceStillAnimatic(input: AnimaticContext, previous: StillAnimaticPlan, manifest: unknown): StillAnimaticPlan {
  if (input.sceneProofPlan.contextSha256 !== sceneProofContextSha256(input) || !normalizeStillAnimaticPlan(previous)) throw new Error("Prepare the current scene directions before refreshing the animatic.");
  const next = importStillAnimatic(input, manifest);
  next.priorVersions = [...(previous.priorVersions ?? []), { contextSha256: previous.contextSha256, fps: previous.fps,
    masterDuration: previous.masterDuration, totalFrames: previous.totalFrames, shots: clone(previous.shots), archivedAt: new Date().toISOString() }];
  if (!normalizeStillAnimaticPlan(next)) throw new Error("The retained animatic history exceeds its safe save bound. No previous image history was removed.");
  return next;
}

export function refreshStillAnimaticContext(input: AnimaticContext, previous: StillAnimaticPlan): StillAnimaticPlan {
  return replaceStillAnimatic(input, previous, { projectId: previous.projectId, fps: previous.fps,
    totalFrames: previous.totalFrames, masterDuration: previous.masterDuration,
    slots: previous.shots.map(s => ({ ...s, timelineItemId: s.sourceTimelineItemId, sceneTitle: s.title })) });
}

export function stillAnimaticShotRequest(input: AnimaticContext, plan: StillAnimaticPlan, shot: AnimaticShot): H3GenerationRequest {
  const scope = effectiveGenerationScope(input.project), scene = input.sceneProofPlan.scenes.find(s => s.id === shot.sceneId);
  if (plan.projectId !== input.projectId || plan.contextSha256 !== animaticContextSha256(input) || !scope || !scene || shot.sourceFrame || !shot.prompt.trim()
    || !plan.shots.some(s => s.id === shot.id && same(animaticShotBinding(plan, s), animaticShotBinding(plan, shot)))) throw new Error("Save the current timed still shot before generating it.");
  return { projectId: plan.projectId, planSignature: scope, timelineItemId: `animatic:${shot.id}`, sectionId: scene.sectionId,
    songStart: shot.startFrame / plan.fps, songEnd: Math.min(shot.endFrame / plan.fps, plan.masterDuration),
    prompt: shot.prompt, referenceAssetIds: [...shot.referenceAssetIds], requestIntentId: crypto.randomUUID(), attempt: 0 };
}

export function attachAnimaticJob(plan: StillAnimaticPlan, binding: AnimaticShotBinding, record: StillClientRecord, job: H3StillJob) {
  const shot = plan.shots.find(s => s.id === binding.shotId);
  if (!shot || !same(binding, animaticShotBinding(plan, shot)) || record.context !== binding.bindingSha256
    || !shot.record || !same(shot.record.request, record.request)) throw new Error("This still belongs to an earlier timed shot.");
  assertStillClientJob(job, record);
  if (job.state !== "ready" || !job.result) return plan;
  const proof = { jobId: job.id, descriptorSha256: job.descriptor.sha256, result: job.result };
  return { ...plan, shots: plan.shots.map(s => s.id === shot.id ? { ...s, record: { ...record, jobId: job.id }, proof } : s) };
}

export function prepareAnimaticSave(projectId: string, draft: PersistedStudioProjectDraft, next: StillAnimaticPlan, expected?: StillAnimaticPlan) {
  const project = draft.musicVideoProject, story = draft.storyState;
  if (!project || !story.confirmedTreatmentSnapshot || !story.sceneProofPlan || !story.storyGenerated
    || next.projectId !== projectId || !normalizeStillAnimaticPlan(next)
    || !same(story.stillAnimaticPlan ?? null, expected ?? null)
    || next.contextSha256 !== animaticContextSha256({ projectId, project, treatment: story.confirmedTreatmentSnapshot,
      storyBeats: story.storyBeats, references: draft.referenceAssets ?? [], sceneProofPlan: story.sceneProofPlan })) throw new Error("The story, timed still plan or references changed before saving.");
  return { ...draft, storyState: { ...story, stillAnimaticPlan: next } };
}

export function animaticImage(plan: StillAnimaticPlan, shot: AnimaticShot, currentContext: string): H3StillImage | undefined {
  if (currentContext !== plan.contextSha256) return undefined;
  if (shot.sourceFrame) return shot.sourceFrame.image;
  return shot.record?.context === animaticShotBinding(plan, shot).bindingSha256 ? shot.proof?.result.master : undefined;
}

/** Retained frames stay source frames, with their original stored pixel receipt. */
export function attachAnimaticSourceImage(plan: StillAnimaticPlan, shotId: string,
  source: NonNullable<AnimaticShot["sourceFrame"]>, image: H3StillImage): StillAnimaticPlan {
  const shot = plan.shots.find(s => s.id === shotId);
  if (!shot?.sourceFrame || !imageValid(image) || !same({ ...source, image: undefined }, { ...shot.sourceFrame, image: undefined })) throw new Error("The retained frame differs from its saved source provenance.");
  return { ...plan, shots: plan.shots.map(s => s.id === shotId ? { ...s, sourceFrame: { ...s.sourceFrame!, image } } : s) };
}

export function animaticShotAtTime(plan: StillAnimaticPlan, seconds: number): AnimaticShot {
  const frame = Math.max(0, Math.min(plan.totalFrames - 1, Math.floor((Number.isFinite(seconds) ? seconds : 0) * plan.fps)));
  let low = 0, high = plan.shots.length - 1;
  while (low < high) { const middle = Math.floor((low + high) / 2); if (plan.shots[middle].endFrame <= frame) low = middle + 1; else high = middle; }
  return plan.shots[low];
}
