import { describe, expect, test } from "bun:test";
import {
  applyApprovedGeneratedAssets,
  generatedAssetIdentityBlockReason,
  hydrateGeneratedStudioAssets,
  sanitizeGeneratedStudioAssetForStorage,
  type GeneratedAssetIdentityVerification,
  type GeneratedStudioAsset,
} from "@/components/studio/generatedAssets";
import {
  applyDraftGeneratedAssets, approveGeneratedDraft, captureGeneratedDraftReview,
  createGeneratedDraftSelection, rejectGeneratedDraftAsset, selectGeneratedDraftAsset,
} from "@/components/studio/generatedDraft";
import type { EditPlanPreviewSegment } from "@/components/studio/musicVideoProject";

const sha = (character: string) => character.repeat(64);
const gap: EditPlanPreviewSegment = {
  planSignature: "plan", requirementId: "arrival", timelineItemId: "arrival", sectionId: "intro", label: "Arrival",
  kind: "gap", videoUrl: "", startTime: 0, endTime: 3, musicStart: 0, musicEnd: 3,
};

/** Synthetic contract evidence only; this does not assess any real clip. */
function candidate(): GeneratedStudioAsset {
  const identityVerification: GeneratedAssetIdentityVerification = {
    version: 1, status: "passed", assetId: "asset", jobId: "h3-job", generationModel: "h3-ref2va-int8-v1",
    mediaSha256: sha("a"), referenceHashes: [sha("b"), sha("c")], identityReferenceHashes: [sha("b")],
    durationSeconds: 3, frameCount: 72, frameRate: 24, examinedFrameCount: 72, unverifiableFrameCount: 0, ambiguousFrameCount: 0,
    verifiedStartFrame: 0, verifiedEndFrameExclusive: 72,
    assessedAt: "2026-11-06T00:00:00.000Z",
    verifier: { method: "face-embedding-cosine", model: "synthetic-contract-fixture", modelSha256: sha("d"),
      version: "1", preprocessVersion: "fixture-1", calibrationId: "synthetic-fixture-only" },
    threshold: 0.8, coverage: "complete",
    samples: [0, 1, 2].map((timeSeconds, index) => ({ timeSeconds, frameSha256: sha(String(index + 1)),
      scores: [{ referenceHash: sha("b"), trackId: "person-1", score: 0.9 }] })),
  };
  return { id: "asset", provider: "swarmui", model: "h3-ref2va-int8-v1", jobId: "h3-job", prompt: "fixture",
    createdAt: "2026-11-06T00:00:00.000Z", status: "completed", mediaKind: "video", durationSeconds: 3,
    reviewStatus: "pending", resultUrl: "https://media.example/asset.mp4", mediaSha256: sha("a"),
    mediaFrameCount: 72, mediaFrameRate: 24,
    generationReferenceHashes: [sha("b"), sha("c")], identityReferenceHashes: [sha("b")], identityVerification,
    target: { planSignature: "plan", requirementId: "arrival", timelineItemId: "arrival", sectionId: "intro", sectionLabel: "Intro", songStart: 0, songEnd: 3 } };
}

function select(asset: GeneratedStudioAsset, assets = [asset]) {
  return selectGeneratedDraftAsset({ draft: createGeneratedDraftSelection("plan"), assets, asset, segments: [gap] });
}

describe("H3 identity contract", () => {
  test("missing old-job assessment blocks automatic selection and forged old approval", () => {
    const asset = candidate();
    delete asset.identityVerification;
    expect(generatedAssetIdentityBlockReason(asset)).toBe("Needs identity check");
    expect(select(asset).assetIds).toEqual([]);
    asset.reviewStatus = "approved";
    expect(applyApprovedGeneratedAssets([gap], [asset])).toEqual([gap]);
    const draft = { ...createGeneratedDraftSelection("plan"), assetIds: [asset.id] };
    expect(captureGeneratedDraftReview([gap], [asset], draft)).toBeNull();
    expect(applyDraftGeneratedAssets([gap], [asset], draft)).toEqual([gap]);
    const empty = createGeneratedDraftSelection("plan");
    const review = captureGeneratedDraftReview([gap], [asset], empty)!;
    expect(approveGeneratedDraft({ draft: empty, assets: [asset], segments: [gap], review }).error).toContain("Unfilled");
  });

  test("valid byte-bound calibrated evidence permits review, never approval by itself", () => {
    const asset = candidate();
    expect(generatedAssetIdentityBlockReason(asset)).toBeNull();
    const draft = select(asset);
    expect(draft.assetIds).toEqual([asset.id]);
    expect(applyApprovedGeneratedAssets([gap], [asset])).toEqual([gap]);
    const review = captureGeneratedDraftReview([gap], [asset], draft)!;
    const result = approveGeneratedDraft({ draft, assets: [asset], segments: [gap], review });
    expect(result.error).toBeNull();
    expect(result.assets[0].reviewStatus).toBe("approved");
  });

  for (const field of ["media", "job", "model", "refs", "identity refs"]) test(`changed ${field} invalidates evidence`, () => {
    const asset = candidate();
    if (field === "media") asset.mediaSha256 = sha("e");
    if (field === "job") asset.jobId = "h3-another";
    if (field === "model") asset.model = "h3-ref2va-int8-v2";
    if (field === "refs") asset.generationReferenceHashes!.reverse();
    if (field === "identity refs") asset.identityReferenceHashes = [];
    expect(generatedAssetIdentityBlockReason(asset)).toBe("Identity check does not match this clip");
    expect(select(asset).assetIds).toEqual([]);
  });

  for (const failure of ["few", "duplicate times", "duplicate frames", "low score", "nonfinite", "ambiguous", "missing calibration", "wrong method", "outside media", "partial scan", "unverifiable frame", "ambiguous frame", "frame count changed", "duration changed"]) test(`fails closed on ${failure} evidence`, () => {
    const asset = candidate();
    const proof = asset.identityVerification!;
    if (failure === "few") proof.samples.pop();
    if (failure === "duplicate times") proof.samples[2].timeSeconds = proof.samples[1].timeSeconds;
    if (failure === "duplicate frames") proof.samples[2].frameSha256 = proof.samples[1].frameSha256;
    if (failure === "low score") proof.samples[1].scores[0].score = 0.79;
    if (failure === "nonfinite") proof.samples[1].scores[0].score = NaN;
    if (failure === "ambiguous") proof.coverage = "ambiguous";
    if (failure === "missing calibration") proof.verifier.calibrationId = "";
    if (failure === "wrong method") (proof.verifier as { method: string }).method = "llm-judge";
    if (failure === "outside media") proof.samples[2].timeSeconds = 3;
    if (failure === "partial scan") proof.examinedFrameCount = 3;
    if (failure === "unverifiable frame") proof.unverifiableFrameCount = 1;
    if (failure === "ambiguous frame") proof.ambiguousFrameCount = 1;
    if (failure === "frame count changed") asset.mediaFrameCount = 73;
    if (failure === "duration changed") asset.durationSeconds = 4;
    expect(generatedAssetIdentityBlockReason(asset)).not.toBeNull();
    expect(select(asset).assetIds).toEqual([]);
  });

  test("exemption requires explicit worker-bound absence of identity references", () => {
    const asset = candidate();
    const proof = asset.identityVerification!;
    proof.status = "not_required"; proof.coverage = "not_required"; proof.samples = [];
    expect(generatedAssetIdentityBlockReason(asset)).not.toBeNull();
    asset.identityReferenceHashes = []; proof.identityReferenceHashes = [];
    expect(generatedAssetIdentityBlockReason(asset)).toBeNull();
    delete asset.identityReferenceHashes;
    expect(generatedAssetIdentityBlockReason(asset)).not.toBeNull();
  });

  test("verified trim scope permits unused handles but fails after moving beyond verified frames", () => {
    const asset = candidate();
    asset.target!.songEnd = 1.5;
    asset.trimStart = 0.5;
    const proof = asset.identityVerification!;
    proof.verifiedStartFrame = 12; proof.verifiedEndFrameExclusive = 48; proof.examinedFrameCount = 36;
    proof.samples.forEach((sample, index) => { sample.timeSeconds = 0.5 + index * 0.5; });
    expect(generatedAssetIdentityBlockReason(asset)).toBeNull();
    asset.trimStart = 0.6;
    expect(generatedAssetIdentityBlockReason(asset)).toBe("Identity check does not cover this trim");
    asset.trimStart = 0.25;
    expect(generatedAssetIdentityBlockReason(asset)).toBe("Identity check does not cover this trim");
  });

  test("a raw trim cannot pass when playback would clamp it into unverified earlier frames", () => {
    const asset = candidate();
    asset.target!.songEnd = 1.5;
    asset.trimStart = 2;
    const proof = asset.identityVerification!;
    proof.verifiedStartFrame = 48; proof.verifiedEndFrameExclusive = 72; proof.examinedFrameCount = 24;
    proof.samples.forEach((sample, index) => { sample.timeSeconds = 2 + index / 3; });
    // Playback would clamp trimStart to 1.5s, exposing frames 36..47 outside proof.
    expect(generatedAssetIdentityBlockReason(asset)).toBe("Identity check does not cover this trim");
    expect(select(asset).assetIds).toEqual([]);
    asset.reviewStatus = "approved";
    expect(applyApprovedGeneratedAssets([gap], [asset])).toEqual([gap]);
  });

  test("identity rejection persists through normalization and cannot revive with a positive result", () => {
    const asset = candidate();
    asset.identityVerification!.status = "rejected";
    asset.reviewStatus = "approved"; asset.approvedAt = asset.createdAt;
    const saved = hydrateGeneratedStudioAssets(JSON.parse(JSON.stringify([sanitizeGeneratedStudioAssetForStorage(asset)])))[0];
    expect(saved.reviewStatus).toBe("rejected");
    expect(saved.approvedAt).toBe(undefined);
    expect(generatedAssetIdentityBlockReason(saved)).toBe("Rejected");
    expect(select(candidate(), [saved]).assetIds).toEqual([]);
    saved.identityVerification = candidate().identityVerification;
    expect(generatedAssetIdentityBlockReason(saved)).toBe("Rejected");
    expect(select(saved).assetIds).toEqual([]);
  });

  test("manual rejection stays terminal without inventing an identity judgment", () => {
    const asset = candidate();
    const result = rejectGeneratedDraftAsset({ draft: select(asset), assets: [asset], assetId: asset.id });
    expect(result.assets[0].identityVerification!.status).toBe("passed");
    expect(generatedAssetIdentityBlockReason(result.assets[0])).toBe("Rejected");
    expect(select(candidate(), result.assets).assetIds).toEqual([]);
  });

  test("evidence changes invalidate the viewed draft even if new evidence still passes", () => {
    const asset = candidate();
    const draft = select(asset);
    const review = captureGeneratedDraftReview([gap], [asset], draft)!;
    asset.identityVerification!.verifier.calibrationId = "different-fixture";
    expect(generatedAssetIdentityBlockReason(asset)).toBeNull();
    expect(approveGeneratedDraft({ draft, assets: [asset], segments: [gap], review }).error).toContain("draft changed");
  });

  test("approved base identity evidence also belongs to the viewed snapshot", () => {
    const asset = candidate(); asset.reviewStatus = "approved";
    const draft = createGeneratedDraftSelection("plan");
    const review = captureGeneratedDraftReview([gap], [asset], draft)!;
    asset.identityVerification!.verifier.calibrationId = "different-fixture";
    expect(approveGeneratedDraft({ draft, assets: [asset], segments: [gap], review }).error).toContain("draft changed");
  });

  test("legacy other-provider and generic Swarm assets retain their review flow", () => {
    const asset = candidate();
    delete asset.identityVerification;
    asset.provider = "higgsfield"; asset.model = "Seedance"; delete asset.jobId;
    expect(generatedAssetIdentityBlockReason(asset)).toBeNull();
    expect(select(asset).assetIds).toEqual([asset.id]);
    asset.provider = "swarmui"; asset.model = "MiniMax H3";
    expect(generatedAssetIdentityBlockReason(asset)).toBeNull();
  });
});
