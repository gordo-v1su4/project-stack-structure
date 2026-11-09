import { generationScopeSha256, effectiveGenerationScope, sourceReferenceManifest } from "./generationScope";
import { anchorForStorySection, type StoryTreatment } from "./storyTreatments";
import type { MusicVideoProject, StoryPlanDraft } from "./musicVideoProject";
import type { ReferenceAsset } from "./referenceAssets";
import type { H3GenerationRequest } from "./h3Generation";
import { assertStillClientJob, parseStillClientRecord, type StillClientRecord } from "./h3StillClient";
import type { H3StillJob, H3StillResult } from "@/lib/h3StillJobStore";

export const SCENE_PROOF_ROLES = ["setting", "action", "transition"] as const;
export type SceneProofRole = typeof SCENE_PROOF_ROLES[number];
export type SceneProofBinding = { sceneId: string; momentId: SceneProofRole; bindingSha256: string };
export type SceneProofMoment = { role: SceneProofRole; prompt: string; record?: StillClientRecord;
  proof?: { jobId: string; descriptorSha256: string; result: H3StillResult } };
export type SceneProofScene = { id: string; sectionId: string; anchorId: string; title: string;
  songStart: number; songEnd: number; direction: string; referenceAssetIds: string[]; moments: SceneProofMoment[];
  review?: { status: "approved" | "revise"; bindingSha256: string; reviewedAt: string; note: string } };
export type SceneProofPlan = { version: 1; projectId: string; contextSha256: string; scenes: SceneProofScene[] };
export type SceneProofContext = { projectId: string; project: MusicVideoProject; treatment: StoryTreatment;
  storyBeats: StoryPlanDraft[]; references: ReferenceAsset[] };
const mentionsName = (prose: string, name: string) => new RegExp(`(?<!\\w)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\w)`, "i").test(prose);

/** Every image receives the current scene direction as well as its specific moment. */
export function sceneProofPrompt(scene: SceneProofScene, moment: SceneProofMoment): string {
  const direction = scene.direction.trim(), prose = moment.prompt.trim();
  const prompt = direction === prose ? prose : [direction, prose].filter(Boolean).join("\n");
  if (!direction || !prose || new TextEncoder().encode(prompt).byteLength > 6000) throw new Error("Use a scene direction and visible moment within the 6000-byte image prompt limit.");
  return prompt;
}

/** Rebase seeded prose that still contains the prior direction; retain bespoke moment edits. */
export function reviseSceneDirection(scene: SceneProofScene, direction: string): SceneProofScene {
  const previous = scene.direction.trim();
  return { ...scene, direction, moments: scene.moments.map(moment => ({ ...moment,
    prompt: moment.prompt === previous || !moment.prompt.trim() ? direction.trim()
      : previous ? moment.prompt.replaceAll(previous, direction.trim()) : moment.prompt })) };
}

/** Editorial authority only: saving/reviewing proofs must not invalidate itself. */
export function sceneProofContextSha256(input: SceneProofContext) {
  const { project, treatment, storyBeats, references, projectId } = input;
  return generationScopeSha256({ projectId, treatment, storyBeats, references: sourceReferenceManifest(references),
    scope: effectiveGenerationScope(project), currentIdentity: project.currentIdentity,
    song: project.song && { sourceLabel: project.song.sourceLabel, storageBucket: project.song.storageBucket,
      storagePath: project.song.storagePath, duration: project.song.duration, sections: project.song.sections },
    sections: project.storySections.map(({ id, label, start, end, prompt }) => ({ id, label, start, end, prompt })),
    targets: project.editPlan.timelineItems.map(({ id, sectionId, requirementId, start, end }) => ({ id, sectionId, requirementId, start, end })) });
}

/** One scene per actual song section; no inferred biographies, palettes or approval. */
export function prepareSceneProofPlan(input: SceneProofContext): SceneProofPlan {
  const sections = input.project.storySections;
  if (!sections.length || sections.length > 24 || sections.some(s => !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.end <= s.start)) {
    throw new Error("Confirm a timed story with at most 24 song sections before preparing scene previews.");
  }
  const references = input.references.filter(r => r.storageStatus === "uploaded" && r.storageBucket && r.storagePath);
  const scenes = sections.map((section, index): SceneProofScene => {
    const anchor = anchorForStorySection(input.treatment, section.id, index, sections.length);
    const direction = anchor?.generationPrompt || section.prompt;
    const next = sections[index + 1] && anchorForStorySection(input.treatment, sections[index + 1].id, index + 1, sections.length);
    const moments: SceneProofMoment[] = SCENE_PROOF_ROLES.map(role => ({ role, prompt: (role === "setting"
      ? `${direction} Wide composition establishes the setting and the beginning of this action.`
      : role === "action" ? direction
      : `${direction} The outgoing composition carries the action toward ${next?.description || input.treatment.endingHook || "the final image"}.`).slice(0, 4000) }));
    const sceneProse = [direction, ...moments.map(m => m.prompt)].join("\n");
    return { id: section.id, sectionId: section.id, anchorId: anchor?.id ?? section.id, title: anchor?.title || section.label,
      songStart: section.start, songEnd: section.end, direction,
      referenceAssetIds: references.filter(r => r.kind === "environment" || r.role === "environment" || ((r.kind === "character" || r.role.startsWith("character")) && mentionsName(sceneProse, r.displayName))).map(r => r.id).slice(0, 9),
      moments };
  });
  return { version: 1, projectId: input.projectId, contextSha256: sceneProofContextSha256(input), scenes };
}

export function sceneMomentBinding(plan: SceneProofPlan, scene: SceneProofScene, moment: SceneProofMoment): SceneProofBinding {
  return { sceneId: scene.id, momentId: moment.role, bindingSha256: generationScopeSha256({ version: 1, projectId: plan.projectId,
    context: plan.contextSha256, scene: { id: scene.id, sectionId: scene.sectionId, anchorId: scene.anchorId, title: scene.title,
      songStart: scene.songStart, songEnd: scene.songEnd, direction: scene.direction, referenceAssetIds: scene.referenceAssetIds },
    role: moment.role, prompt: moment.prompt }) };
}

export function sceneReviewSha256(plan: SceneProofPlan, scene: SceneProofScene) {
  return generationScopeSha256(scene.moments.map(moment => ({ binding: sceneMomentBinding(plan, scene, moment), proof: moment.proof ?? null })));
}
export function sceneProofReviewStatus(plan: SceneProofPlan, scene: SceneProofScene, currentContext: string): "stale" | "missing" | "pending" | "approved" | "revise" {
  if (plan.contextSha256 !== currentContext) return "stale";
  if (scene.moments.length !== 3 || SCENE_PROOF_ROLES.some(role => !scene.moments.some(m => m.role === role && m.prompt.trim() && m.proof && m.record
    && m.record.context === sceneMomentBinding(plan, scene, m).bindingSha256))) return "missing";
  return scene.review?.bindingSha256 === sceneReviewSha256(plan, scene) ? scene.review.status : "pending";
}

export function reviewSceneProof(plan: SceneProofPlan, sceneId: string, status: "approved" | "revise", note: string, currentContext: string): SceneProofPlan {
  const scene = plan.scenes.find(s => s.id === sceneId);
  if (!scene || plan.contextSha256 !== currentContext) throw new Error("Prepare previews for the current story and references before reviewing scenes.");
  if (status === "approved" && sceneProofReviewStatus(plan, scene, currentContext) === "missing") throw new Error("Inspect all three current scene images before approving its direction.");
  if (status === "revise" && !note.trim()) throw new Error("Describe the scene change to request.");
  return { ...plan, scenes: plan.scenes.map(s => s.id === sceneId ? { ...s, review: { status, note: note.trim().slice(0, 1000),
    bindingSha256: sceneReviewSha256(plan, scene), reviewedAt: new Date().toISOString() } } : s) };
}

/** Bind the canonical ready job to its exact persisted moment; no automatic consent. */
export function attachSceneProofJob(plan: SceneProofPlan, binding: SceneProofBinding, record: StillClientRecord, job: H3StillJob): SceneProofPlan {
  const scene = plan.scenes.find(s => s.id === binding.sceneId), moment = scene?.moments.find(m => m.role === binding.momentId);
  if (!scene || !moment || generationScopeSha256(binding) !== generationScopeSha256(sceneMomentBinding(plan, scene, moment))
    || record.context !== binding.bindingSha256 || record.projectId !== plan.projectId
    || !moment.record || generationScopeSha256(moment.record.request) !== generationScopeSha256(record.request)) throw new Error("This still result belongs to an earlier scene direction.");
  assertStillClientJob(job, record);
  if (job.state !== "ready" || !job.result) return plan;
  const proof = { jobId: job.id, descriptorSha256: job.descriptor.sha256, result: job.result };
  if (generationScopeSha256(moment.proof ?? null) === generationScopeSha256(proof)) return plan;
  return { ...plan, scenes: plan.scenes.map(s => s.id === scene.id ? { ...s, moments: s.moments.map(m => m.role === moment.role
    ? { ...m, record: { ...record, jobId: job.id }, proof } : m) } : s) };
}

/** Representative images use bounded windows inside current placements, including covered footage. */
export function sceneProofShot(input: SceneProofContext, plan: SceneProofPlan, scene: SceneProofScene, moment: SceneProofMoment): H3GenerationRequest {
  if (plan.contextSha256 !== sceneProofContextSha256(input) || plan.projectId !== input.projectId || !moment.prompt.trim()) throw new Error("Save a current scene direction and image prompt first.");
  const roleIndex = SCENE_PROOF_ROLES.indexOf(moment.role), position = scene.songStart + (scene.songEnd - scene.songStart) * [0.1, 0.5, 0.9][roleIndex];
  const cuts = (input.project.placementPlan?.placements ?? []).flatMap(placement => {
    const item = input.project.editPlan.timelineItems.find(item => item.id === placement.timelineItemId && item.sectionId === placement.sectionId);
    if (!item) return [];
    let start = Math.max(scene.songStart, placement.songStart, item.start), end = Math.min(scene.songEnd, placement.songEnd, item.end);
    if (end <= start) return [];
    // A still needs a representative position, not a new long video or a changed edit.
    if (end - start > 12) { start = Math.max(start, Math.min(position - 2.5, end - 5)); end = start + 5; }
    return [{ ...item, start, end }];
  });
  const target = cuts.sort((a, b) => Math.abs((a.start + a.end) / 2 - position) - Math.abs((b.start + b.end) / 2 - position))[0];
  if (!target) throw new Error("This scene needs a current saved placement before preparing its still.");
  if (!scene.referenceAssetIds.length || scene.referenceAssetIds.some(id => !input.references.some(ref => ref.id === id && ref.storageStatus === "uploaded"))) throw new Error("Select the named references for this scene.");
  const prompt = sceneProofPrompt(scene, moment);
  const referenceAssetIds = scene.referenceAssetIds.filter(id => {
    const reference = input.references.find(ref => ref.id === id)!;
    return !(reference.kind === "character" || reference.role.startsWith("character")) || mentionsName(prompt, reference.displayName);
  });
  if (!referenceAssetIds.some(id => input.references.some(ref => ref.id === id && (ref.kind === "environment" || ref.role === "environment")))) throw new Error("Select the named environment reference for this scene.");
  const planSignature = effectiveGenerationScope(input.project);
  if (!planSignature) throw new Error("Confirm the current placement plan first.");
  return { projectId: input.projectId, planSignature, timelineItemId: target.id,
    ...(target.requirementId ? { requirementId: target.requirementId } : {}), sectionId: target.sectionId, songStart: target.start, songEnd: target.end,
    prompt, referenceAssetIds, requestIntentId: crypto.randomUUID(), attempt: 0 };
}

/** Bounded persisted input. Invalid preview state never acquires approval. */
export function normalizeSceneProofPlan(value: unknown): SceneProofPlan | undefined {
  try {
    const p = value as SceneProofPlan;
    if (!p || p.version !== 1 || !/^[a-zA-Z0-9_-]{1,96}$/.test(p.projectId) || !/^[a-f0-9]{64}$/.test(p.contextSha256)
      || JSON.stringify(p).length > 2_000_000 || !Array.isArray(p.scenes) || !p.scenes.length || p.scenes.length > 24
      || new Set(p.scenes.map(s => s.id)).size !== p.scenes.length) return undefined;
    for (const s of p.scenes) {
      if (!s || !s.id || !s.sectionId || !s.anchorId || typeof s.title !== "string" || s.title.length > 200 || typeof s.direction !== "string" || s.direction.length > 6000
        || !Number.isFinite(s.songStart) || !Number.isFinite(s.songEnd) || s.songStart < 0 || s.songEnd <= s.songStart
        || !Array.isArray(s.referenceAssetIds) || s.referenceAssetIds.length > 9 || new Set(s.referenceAssetIds).size !== s.referenceAssetIds.length
        || s.referenceAssetIds.some(id => typeof id !== "string" || id.length > 200) || !Array.isArray(s.moments) || s.moments.length !== 3
        || SCENE_PROOF_ROLES.some(role => s.moments.filter(m => m.role === role).length !== 1)
        || s.moments.some(m => typeof m.prompt !== "string" || m.prompt.length > 6000)) return undefined;
      for (const m of s.moments) {
        if (m.record !== undefined && !parseStillClientRecord(m.record, p.projectId)) return undefined;
        if (m.proof !== undefined && (!m.record || !/^h3-still-[a-f0-9]{64}$/.test(m.proof.jobId)
          || m.record.jobId !== m.proof.jobId || !/^[a-f0-9]{64}$/.test(m.proof.descriptorSha256)
          || !/^h3-frame-[a-f0-9]{64}$/.test(m.proof.result?.artifactId) || !/^[a-f0-9]{64}$/.test(m.proof.result?.artifactSha256)
          || [m.proof.result?.master, m.proof.result?.native].some(image => !image || typeof image.bucket !== "string" || !image.bucket
            || typeof image.objectKey !== "string" || !image.objectKey || !/^[a-f0-9]{64}$/.test(image.sha256)
            || !Number.isSafeInteger(image.byteLength) || image.byteLength < 1 || !Number.isSafeInteger(image.width) || image.width < 1
            || !Number.isSafeInteger(image.height) || image.height < 1))) return undefined;
      }
      if (s.review && (!["approved", "revise"].includes(s.review.status) || !/^[a-f0-9]{64}$/.test(s.review.bindingSha256)
        || typeof s.review.note !== "string" || s.review.note.length > 1000 || typeof s.review.reviewedAt !== "string"
        || !Number.isFinite(Date.parse(s.review.reviewedAt)))) return undefined;
    }
    return JSON.parse(JSON.stringify(p)) as SceneProofPlan;
  } catch { return undefined; }
}
