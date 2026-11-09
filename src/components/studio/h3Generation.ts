import type { GeneratedStudioAsset, GeneratedStudioAssetTarget } from "./generatedAssets";
import type { H3IdentityPolicyFamilyId, H3IssuedDraftPolicyBinding } from "./issuedIdentityPolicy";
import { H3_FIRST_FRAME_PROFILE, H3_FIRST_FRAME_PREPARATION, type H3FirstFrameChoice, type H3FirstFrameArtifact, type H3FirstFrameAssessment } from "./h3FirstFrame";

/** Browser input contains project identities, never provider paths or workflow JSON. */
export type H3GenerationRequest = {
  projectId: string;
  planSignature: string;
  requirementId?: string;
  timelineItemId?: string;
  sectionId: string;
  songStart: number;
  songEnd: number;
  prompt: string;
  referenceAssetIds: string[];
  requestIntentId: string;
  attempt?: number;
  seed?: number;
  /** Review revision at dispatch. Missing legacy revisions require explicit selection. */
  draftRevision?: number;
  /** Explicit new-job opt-in; historical missing-field requests remain immutable. */
  identityPolicyFamily?: H3IdentityPolicyFamilyId;
  conditioning?: H3FirstFrameChoice;
};

export type H3ReferenceSnapshot = {
  assetId: string;
  canonicalName: string;
  role: "identity" | "environment" | "composition" | "style" | "crowd" | "prop" | "vehicle" | "wardrobe";
  bucket: string;
  objectKey: string;
  version: string;
  /** Storage version pinned before queueing; conditional download rejects an overwrite. */
  etag?: string;
  /** Only new explicitly selected aesthetic inputs carry this restriction. */
  aesthetic?: { purpose: "shot" | "style"; guidance: string; originalSha256: string };
};

export type H3GenerationState = "queued" | "preparing" | "submitting" | "submission_unknown"
  | "rendering" | "persisting" | "ready" | "failed" | "cancel_requested" | "cancelled";

export const H3_LEGACY_PROFILE = "h3-ref2va-int8-v1" as const;
export const H3_V2_PROFILE = "h3-ref2va-int8-v2" as const;
export const H3_V2_CONDITIONING_PREPARATION_VERSION = "canonical-front-crop-v1" as const;
export const H3_PROFILE = "h3-ref2va-int8-v3" as const;
export const H3_CONDITIONING_PREPARATION_VERSION = "canonical-front-crops-v2" as const;
export type H3GenerationProfile = typeof H3_LEGACY_PROFILE | typeof H3_V2_PROFILE | typeof H3_PROFILE | typeof H3_FIRST_FRAME_PROFILE;
export type H3ConditioningPreparationVersion = typeof H3_V2_CONDITIONING_PREPARATION_VERSION | typeof H3_CONDITIONING_PREPARATION_VERSION | typeof H3_FIRST_FRAME_PREPARATION;
export type H3GenerationProfileOptions = {
  profile: H3GenerationProfile;
  conditioningPreparationVersion?: H3ConditioningPreparationVersion;
  firstFrame?: H3FirstFrameArtifact;
};
export type H3ConditioningPreparation = {
  version: "original-v1" | H3ConditioningPreparationVersion;
  /** Authority bytes remain distinct from the PNG bytes actually sent to H3. */
  rawSha256: string;
  operation: "original" | "crop";
  sourceWidth: number;
  sourceHeight: number;
  crop?: { x: number; y: number; width: number; height: number };
  ffmpegFilter?: string;
};

export type H3GenerationJob = {
  version: 1;
  id: string;
  ownerId: string;
  projectId: string;
  profile: H3GenerationProfile;
  conditioningPreparationVersion?: H3ConditioningPreparationVersion;
  request: H3GenerationRequest;
  references: H3ReferenceSnapshot[];
  target: GeneratedStudioAssetTarget;
  state: H3GenerationState;
  createdAt: string;
  updatedAt: string;
  runId?: string;
  /** Server-owned worker dispatch receipts; a missing runId is an uncertain ACK, not a new creative attempt. */
  workerRecoveries?: { requestIntentId: string; previousRunId?: string; createdAt: string; runId?: string }[];
  promptId?: string;
  error?: string;
  cancelRequestedAt?: string;
  referenceHashes?: string[];
  conditioningReferenceHashes?: string[];
  conditioningPreparations?: H3ConditioningPreparation[];
  compiledPrompt?: string;
  frames?: number;
  result?: { asset: GeneratedStudioAsset };
  /** Server-issued immutable reference/gallery screen, never client-provided policy JSON. */
  identityPolicy?: H3IssuedDraftPolicyBinding;
  firstFrame?: H3FirstFrameArtifact;
  firstFrameAssessment?: H3FirstFrameAssessment;
};

export const H3_FPS = 24;
export const H3_WIDTH = 1344;
export const H3_HEIGHT = 768;
export const H3_MAX_SHOT_SECONDS = 12;

export function h3FrameCount(seconds: number) {
  const frames = Math.max(124, Math.ceil(seconds * H3_FPS));
  return frames + (17 - ((frames - 5) % 17)) % 17;
}

export function isH3JobTerminal(job: Pick<H3GenerationJob, "state">) {
  return job.state === "ready" || job.state === "failed" || job.state === "cancelled";
}
