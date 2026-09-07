import { describe, expect, test } from "bun:test";
import { applySceneEvidenceReview, initialSceneEvidenceReview } from "@/components/studio/sceneEvidenceReview";
import { buildCaptionRevisionKey, createCaptionRevisionGuard, createMediaEvidence, normalizeMediaEvidence, normalizeMediaObservation } from "@/components/studio/mediaEvidence";
import { buildStudioSourceContextSignature } from "@/components/studio/studioSourceContext";
import { createPersistableStudioProjectDraft, hydrateStudioProjectDraft } from "@/components/studio/projectPersistence";
import type { DetectedSceneSegment, UploadedVideoSource } from "@/components/studio/types";

const scene: DetectedSceneSegment = {
  id: 2, sourceClipId: 7, label: "Cut 3", start: 3, end: 7, duration: 4, detector: "pyscenedetect-adaptive",
  firstFrameUrl: "https://media.example/first.jpg", middleFrameUrl: "https://media.example/middle.jpg", lastFrameUrl: "https://media.example/last.jpg",
  storyboardUrl: "https://media.example/strip.jpg", sampleTimes: { first: 3.1, middle: 5, last: 6.9 },
  caption: "Diego dances.", captionSource: "qwen3-vl-server", captionModel: "qwen", captionMode: "smart",
  captionMeta: { caption: "Diego dances.", subjects: ["Diego"], action: "dancing", setting: "club", lighting: "amber" },
  mediaEvidence: createMediaEvidence({ sourceId: "7", sceneId: "2", sourceStart: 3, sourceEnd: 7,
    input: { kind: "ordered-frames", sampleTimes: [3.1, 5, 6.9], urls: ["https://media.example/strip.jpg"] },
    rawCaption: "Diego dances.", model: "qwen", observation: { subjects: [{ name: "Diego", role: "focal", confidence: "supported" }], actions: ["dancing"] } }),
};
const source: UploadedVideoSource = { id: 7, name: "source.mp4", duration: 12, size: 42,
  videoUrl: "https://media.example/source.mp4", thumbnailUrl: scene.firstFrameUrl!, storageUrl: "https://media.example/source.mp4", scenes: [scene] };
const review = { caption: "Generic patrons walk toward the cave entrance.", observation: normalizeMediaObservation({
  actions: ["walking toward entrance"], location: "cave entrance", unknowns: ["Identities are not established"],
})! };

describe("manual scene evidence review", () => {
  test("model guesses do not prefill structured facts for endorsement", () => {
    const initial = initialSceneEvidenceReview(scene);
    expect(initial.caption).toBe("Diego dances.");
    expect(initial.observation.subjects).toEqual([]);
    expect(initial.observation.actions).toEqual([]);
    expect(initial.observation.focalSubjectCount).toBeNull();
  });
  test("preserves original evidence and source interval while replacing stale caption metadata", () => {
    const result = applySceneEvidenceReview(scene, review);
    expect(result.captionHistory).toEqual([{ caption: scene.caption!, model: "qwen", source: scene.captionSource, evidence: scene.mediaEvidence }]);
    expect(result.captionSource).toBe("manual");
    expect(result.captionModel).toBe(undefined);
    expect(result.captionMeta?.subjects).toEqual([]);
    expect(result.captionMeta?.lighting).toBe(undefined);
    expect(result.captionMeta?.action).toBe("walking toward entrance");
    expect(result.mediaEvidence?.provenance).toEqual({ origin: "manual", promptVersion: "manual-scene-review-v1", model: null, rawCaption: review.caption, referenceKeys: [] });
    for (const key of ["id", "sourceClipId", "start", "end", "duration", "firstFrameUrl", "middleFrameUrl", "lastFrameUrl", "sampleTimes"] as const) expect(result[key]).toEqual(scene[key]);
    expect(scene.captionMeta?.subjects).toEqual(["Diego"]);
  });
  test("later reviews preserve earlier manual corrections and prefill only those facts", () => {
    const first = applySceneEvidenceReview(scene, review);
    const next = applySceneEvidenceReview(first, { ...review, caption: "Patrons enter a cave." });
    expect(next.captionHistory).toHaveLength(2);
    expect(next.captionHistory?.[1]?.evidence).toEqual(first.mediaEvidence);
    expect(initialSceneEvidenceReview(first).observation.actions).toEqual(review.observation.actions);
  });
  test("same-caption observation changes reject in-flight model results and stale story assessments", () => {
    const first = applySceneEvidenceReview(scene, review);
    let current = { ...source, scenes: [first] };
    const settings = { mode: "smart" as const };
    const guard = createCaptionRevisionGuard(current, settings, () => current, () => settings);
    const before = buildCaptionRevisionKey(current, settings);
    const storyBefore = buildStudioSourceContextSignature({ analysis: null, videoSources: [current] });
    current = { ...current, scenes: [applySceneEvidenceReview(first, { ...review, observation: { ...review.observation, physicalState: ["intact floor"] } })] };
    expect(current.scenes[0]!.caption).toBe(first.caption);
    expect(buildCaptionRevisionKey(current, settings)).not.toBe(before);
    expect(buildStudioSourceContextSignature({ analysis: null, videoSources: [current] })).not.toBe(storyBefore);
    expect(guard.isCurrent()).toBe(false);
  });
  test("manual facts and history survive project persistence and evidence normalization", () => {
    const edited = applySceneEvidenceReview(scene, review);
    const draft = createPersistableStudioProjectDraft({ analysis: null, videoSources: [{ ...source, scenes: [edited] }],
      storyState: { vocalStemName: "", transcriptSummary: null, storyBeats: [], activeBeatId: "", storyGenerated: false }, musicVideoProject: null });
    const restored = hydrateStudioProjectDraft({ draft: JSON.parse(JSON.stringify(draft)) }).videoSources[0]!.scenes![0]!;
    expect(restored.captionSource).toBe("manual");
    expect(normalizeMediaEvidence(restored.mediaEvidence)).toEqual(edited.mediaEvidence);
    expect(restored.captionHistory).toEqual(edited.captionHistory);
  });
  test("blank captions cannot replace existing evidence", () => {
    expect(() => applySceneEvidenceReview(scene, { ...review, caption: "   " })).toThrow("Describe what this interval shows");
  });
});
