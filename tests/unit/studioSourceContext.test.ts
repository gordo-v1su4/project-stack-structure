import { expect, test } from "bun:test";
import { buildStudioSourceContextSignature } from "@/components/studio/studioSourceContext";
import type { BeatJoinAnalysis, UploadedVideoSource } from "@/components/studio/types";
import type { ReferenceAsset } from "@/components/studio/referenceAssets";

const analysis: BeatJoinAnalysis = { sourceLabel: "song.wav", audioUrl: "blob:old", waveform: [0.2], energy: [0.4], beats: [0, 1], onsets: [0.5], sections: [{ label: "Intro", start: 0, end: 2 }], duration: 2 };
const video: UploadedVideoSource = { id: 1, name: "scene.mp4", size: 20, duration: 2, videoUrl: "blob:video-old", thumbnailUrl: "blob:thumb", scenes: [{ id: 1, sourceClipId: 1, label: "Scene", start: 0, end: 2, duration: 2, detector: "pyscenedetect-adaptive", caption: "Diego walks alone" }] };
const reference: ReferenceAsset = { id: "char", role: "character-1", kind: "character", displayName: "Diego", fileName: "diego.png", previewUrl: "blob:ref", promptHint: "identity", storageStatus: "uploaded", storagePath: "refs/v1.png", createdAt: "2026-09-06" };
const input = { analysis, videoSources: [video], referenceAssets: [reference] };

test("live caption, reference identity, and song boundary changes invalidate saved source context", () => {
  const initial = buildStudioSourceContextSignature(input);
  expect(buildStudioSourceContextSignature({ ...input, videoSources: [{ ...video, scenes: [{ ...video.scenes![0]!, caption: "Diego and Valentina dance together" }] }] })).not.toBe(initial);
  expect(buildStudioSourceContextSignature({ ...input, referenceAssets: [{ ...reference, storagePath: "refs/v2.png" }] })).not.toBe(initial);
  expect(buildStudioSourceContextSignature({ ...input, referenceAssets: [{ ...reference, displayName: "Someone else" }] })).not.toBe(initial);
  expect(buildStudioSourceContextSignature({ ...input, analysis: { ...analysis, sections: [{ label: "Verse", start: 0, end: 2 }] } })).not.toBe(initial);
});

test("blob hydration and reference prop representation preserve the same source context", () => {
  expect(buildStudioSourceContextSignature({ analysis: { ...analysis, audioUrl: "blob:new" }, videoSources: [{ ...video, videoUrl: "blob:video-new" }], referenceRevision: JSON.stringify([{ ...reference, previewUrl: "blob:newref" }]) })).toBe(buildStudioSourceContextSignature(input));
});
