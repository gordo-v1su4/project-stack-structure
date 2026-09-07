import { describe, expect, test } from "bun:test";
import { buildCaptionRevisionKey, createCaptionRevisionGuard, createMediaEvidence, normalizeMediaEvidence, sceneEvidenceInput } from "@/components/studio/mediaEvidence";
import type { SceneCaptionSettings, UploadedVideoSource } from "@/components/studio/types";
import { normalizeServerCaptionPayload } from "@/components/studio/sceneCaptioningServer";
import { applyCaptionResult } from "@/trigger/media";
import actualGatewayResponse from "../fixtures/story-evidence/qwen-flattened-response.json";

const observation = {
  subjects: [{ name: "Diego", confidence: "supported", role: "focal" }, { name: null, confidence: "unknown", role: "background" }],
  focalSubjectCount: 1, actions: ["walking"], transitions: ["enters doorway"], interaction: "solo",
  physicalState: ["intact"], unknowns: ["Purpose of walking is unknown"],
};
const input = { kind: "ordered-frames" as const, sampleTimes: [2, 3, 4], urls: ["https://media.example/strip.jpg"] };
const evidence = () => createMediaEvidence({ observation, sourceId: "source-1", sceneId: "scene-2", sourceStart: 2, sourceEnd: 4, input, model: "qwen", rawCaption: "Diego walks across the room." });

describe("factual media evidence", () => {
  test("preserves uncertain identities and intent instead of assigning all crowd members a name", () => {
    const result = evidence();
    expect(result.focalSubjectCount).toBe(1);
    expect(result.subjects[1]).toEqual({ name: null, confidence: "unknown", role: "background" });
    expect(result.unknowns).toContain("Purpose of walking is unknown");
    expect("storyPhase" in result).toBe(false);
    expect(result.provenance.promptVersion).toBe("visible-evidence-v1");
  });
  test("a legacy caption is not upgraded to structured evidence by parsing its prose", () => {
    const result = createMediaEvidence({ sourceId: "1", sceneId: "1", sourceStart: 0, sourceEnd: 1, input: { kind: "single-frame", sampleTimes: [0.2], urls: [] }, rawCaption: "Diego is searching for Valentina." });
    expect(result.actions).toEqual([]);
    expect(result.subjects).toEqual([]);
    expect(result.provenance.origin).toBe("legacy");
    expect(result.unknowns).toHaveLength(2);
  });
  test("single-frame input cannot prove a transition even if the model invents it", () => {
    const result = createMediaEvidence({ ...evidence(), observation, input: { kind: "single-frame", sampleTimes: [2], urls: [] }, rawCaption: "walks" });
    expect(result.transitions).toEqual([]);
    expect(result.unknowns.some((reason) => reason.includes("Temporal change"))).toBe(true);
  });
  test("declares ordered input only for known chronological source times", () => {
    expect(sceneEvidenceInput({ start: 2, end: 4, storyboardUrl: "strip", sampleTimes: { first: 2, middle: 3, last: 4 } }, 2.2).kind).toBe("ordered-frames");
    expect(sceneEvidenceInput({ start: 2, end: 4, storyboardUrl: "strip", sampleTimes: { first: 4, middle: 3, last: 2 } }, 2.2).kind).toBe("unknown");
    expect(sceneEvidenceInput({ start: 2, end: 4, storyboardUrl: "strip" }, 2.2).kind).toBe("unknown");
  });
  test("durable evidence round trips and invalid source intervals are rejected", () => {
    expect(normalizeMediaEvidence(JSON.parse(JSON.stringify(evidence())))).toEqual(evidence());
    expect(normalizeMediaEvidence({ ...evidence(), sourceEnd: 1 })).toEqual(undefined);
  });
  test("JSON-in-text and gateway meta preserve observations through batch finalization", () => {
    const payload = { text: "Diego walks.", meta: { caption: "Diego walks.", subjects: ["Diego"], evidence: observation }, mediaEvidence: evidence(), source: "qwen3-vl-server" };
    expect(normalizeServerCaptionPayload({ text: JSON.stringify(payload.meta) }).observation?.actions).toEqual(["walking"]);
    const merged = applyCaptionResult({ index: 2, start_seconds: 2, end_seconds: 4 }, payload);
    expect(merged.sceneData?.subjects).toEqual(["Diego"]);
    expect(merged.mediaEvidence).toEqual(evidence());
  });
  test("live flattened Qwen response survives gateway and application normalization", () => {
    const result = normalizeServerCaptionPayload(actualGatewayResponse);
    expect(result.observation?.focalSubjectCount).toBe(2);
    expect(result.observation?.actions).toEqual(["dancing", "moving"]);
    expect(result.observation?.unknowns).toContain("time of day");
    // This model result omitted visible floor damage; preserving it is not a human approval.
    expect(result.observation?.physicalState).toEqual(["wet floor", "reflective surface"]);
    expect(result.meta?.subjects).toEqual(["Diego", "Valentina"]);
  });
});


test("caption revision changes for visual refs and source edits but not story wording", () => {
  const source = { id: 1, name: "a.mp4", duration: 2, size: 1, videoUrl: "a", thumbnailUrl: "a", storagePath: "media/a" };
  const settings = { mode: "smart" as const, context: { storySummary: "old" }, referenceImages: [{ name: "Diego", role: "primary" as const, bucket: "bucket", objectKey: "refs/old" }] };
  const original = buildCaptionRevisionKey(source, settings);
  expect(buildCaptionRevisionKey(source, { ...settings, context: { storySummary: "revised" } })).toBe(original);
  expect(buildCaptionRevisionKey(source, { ...settings, referenceImages: [{ ...settings.referenceImages[0]!, objectKey: "refs/new" }] }) === original).toBe(false);
  expect(buildCaptionRevisionKey({ ...source, storagePath: "media/replaced" }, settings) === original).toBe(false);
});

test("caption guard accepts its own detection publication and rejects changed references", () => {
  let current: UploadedVideoSource = { id: 1, name: "a.mp4", duration: 2, size: 1, videoUrl: "a", thumbnailUrl: "a", storagePath: "media/a" };
  let settings: SceneCaptionSettings = { mode: "smart" };
  const guard = createCaptionRevisionGuard(current, settings, () => current, () => settings);
  const detected: UploadedVideoSource = { ...current, scenes: [{ id: 0, sourceClipId: 1, label: "scene", start: 0, end: 2, duration: 2, detector: "pyscenedetect-adaptive", confidence: null }] };
  expect(guard.acceptUpdate(detected)).toBe(true);
  // React may publish later; both the original and this run's detected revision are valid.
  expect(guard.isCurrent()).toBe(true);
  current = detected;
  expect(guard.isCurrent()).toBe(true);
  settings = { mode: "fast" };
  expect(guard.acceptUpdate(detected)).toBe(false);
  settings = { mode: "smart" };
  expect(guard.isCurrent()).toBe(false);
});

test("caption guard rejects source intervals edited outside the running pipeline", () => {
  let current: UploadedVideoSource = { id: 1, name: "a.mp4", duration: 2, size: 1, videoUrl: "a", thumbnailUrl: "a", storagePath: "media/a" };
  const settings: SceneCaptionSettings = { mode: "smart" };
  const guard = createCaptionRevisionGuard(current, settings, () => current, () => settings);
  current = { ...current, storagePath: "media/replacement" };
  expect(guard.isCurrent()).toBe(false);
});
