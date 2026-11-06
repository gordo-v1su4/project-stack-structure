import type { GeneratedStudioAsset, GeneratedStudioAssetTarget } from "./generatedAssets";

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
};

export type H3GenerationState = "queued" | "preparing" | "submitting" | "submission_unknown"
  | "rendering" | "persisting" | "ready" | "failed" | "cancel_requested" | "cancelled";

export type H3GenerationJob = {
  version: 1;
  id: string;
  ownerId: string;
  projectId: string;
  profile: "h3-ref2va-int8-v1";
  request: H3GenerationRequest;
  references: H3ReferenceSnapshot[];
  target: GeneratedStudioAssetTarget;
  state: H3GenerationState;
  createdAt: string;
  updatedAt: string;
  runId?: string;
  promptId?: string;
  error?: string;
  cancelRequestedAt?: string;
  referenceHashes?: string[];
  compiledPrompt?: string;
  frames?: number;
  result?: { asset: GeneratedStudioAsset };
};

export const H3_PROFILE = "h3-ref2va-int8-v1" as const;
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
