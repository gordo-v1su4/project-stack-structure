import { createMediaEvidence, normalizeMediaObservation, sceneEvidenceInput, type MediaObservation } from "./mediaEvidence";
import type { DetectedSceneSegment } from "./types";

export type SceneEvidenceReview = { caption: string; observation: MediaObservation };

/** A review endorses only the facts entered by the reviewer, never old model metadata. */
export function applySceneEvidenceReview(scene: DetectedSceneSegment, review: SceneEvidenceReview): DetectedSceneSegment {
  const caption = review.caption.trim();
  if (!caption) throw new Error("Describe what this interval shows before saving.");
  const observation = normalizeMediaObservation(review.observation)!;
  const evidence = createMediaEvidence({
    observation, sourceId: String(scene.sourceClipId), sceneId: String(scene.id),
    sourceStart: scene.start, sourceEnd: scene.end,
    input: sceneEvidenceInput(scene, scene.sampleTimes?.first ?? scene.start), rawCaption: caption,
  });
  evidence.provenance = { ...evidence.provenance, origin: "manual", promptVersion: "manual-scene-review-v1" };
  const previousCaption = scene.caption ?? scene.captionMeta?.caption ?? "";
  return {
    ...scene, caption, mediaEvidence: evidence, captionSource: "manual", captionModel: undefined,
    captionSampleStrategy: undefined, captionError: null,
    captionHistory: [...(scene.captionHistory ?? []), ...(previousCaption || scene.mediaEvidence ? [{
      caption: previousCaption, model: scene.captionModel, source: scene.captionSource, evidence: scene.mediaEvidence,
    }] : [])],
    captionMeta: {
      caption, subjects: observation.subjects.filter(subject => subject.confidence === "supported" && subject.name).map(subject => subject.name!),
      action: observation.actions.join("; ") || undefined, setting: observation.location ?? undefined,
      shotType: observation.shotScale ?? undefined,
    },
  };
}

/** Model guesses must be reviewed explicitly; only earlier manual facts prefill the editor. */
export function initialSceneEvidenceReview(scene: DetectedSceneSegment): SceneEvidenceReview {
  return {
    caption: scene.captionMeta?.caption ?? scene.caption ?? "",
    observation: normalizeMediaObservation(scene.mediaEvidence?.provenance.origin === "manual" ? scene.mediaEvidence : {})!,
  };
}
