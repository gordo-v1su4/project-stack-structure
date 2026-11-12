import { idempotencyKeys, runs, tasks } from "@trigger.dev/sdk";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import { assertH3IdentityAssessmentScope, type H3IdentityAssessmentScope } from "@/components/studio/h3IdentityAssessment";

import { auth as applicationAuth } from "@/auth";
import type { LocalGenerationPayload, localGenerationTask } from "@/trigger/localGeneration";
import type { HiggsfieldGenerationPayload, higgsfieldGenerationTask } from "@/trigger/higgsfield";
import type { DeepgramStoredAudioPayload, deepgramTranscriptionTask } from "@/trigger/deepgram";
import type { FfmpegPreviewPayload, ffmpegPreviewTask } from "@/trigger/ffmpeg";
import type { SeedanceAudioReferencePayload, seedanceAudioReferenceTask } from "@/trigger/seedanceAudioReference";
import type { FinalExportPayload, ShaderCaptureExportPayload, finalExportTask, shaderCaptureExportTask } from "@/trigger/export";
import type { SmartSceneCaptionPayload, smartSceneCaptionTask } from "@/trigger/caption";
import type { EssentiaStoredAudioPayload, essentiaStoredAudioTask } from "@/trigger/essentia";
import type { MediaSceneDetectionPayload, mediaVideoPipelineTask } from "@/trigger/media";
import type { FfglitchPayload, ffglitchTask } from "@/trigger/ffglitch";
import type { ImageSplitterPayload, imageSplitterTask } from "@/trigger/imageSplitter";
import type { StoryTreatmentPayload, storyTreatmentTask } from "@/trigger/storyTreatment";
import type { h3ShotPlanningTask } from "@/trigger/h3ShotPlanning";
import type { H3ShotPlanningReference } from "./h3ShotPlanningServer";
import type { h3StillTask } from "@/trigger/h3Still";
import type { H3StillJob } from "./h3StillJobStore";
import { createTriggerIdempotencyKey } from "@/lib/triggerIdempotency";
import { EXPORT_DISPATCH_UPGRADE_MESSAGE, isOwnedExportRequestKey } from "@/components/studio/exportDispatchProtocol";
import { retrieveOwnedTriggerRun } from "@/lib/triggerRunAccess";
import { normalizeTriggerRunStatus } from "@/lib/triggerRunStatus";
import { H3_AUTOMATIC_RECOVERY_ATTEMPTS } from "@/lib/h3AutomaticRecovery";
import type { reviewVideoTask } from "@/trigger/reviewVideo";
import { reviewVideoIdentity, type ReviewVideoSource } from "./preparedReviewVideoStore";

export const STACK_STRUCTURE_TRIGGER_TASKS = {
  mediaVideoPipeline: "media-video-pipeline",
  mediaSceneDetection: "media-video-scene-detect",
  mediaSceneCaptionBatch: "qwen-scene-caption-batch",
  mediaFinalization: "media-video-finalize",
  essentiaAnalysis: "essentia-analyze-stored-audio",
  smartSceneCaption: "qwen-smart-scene-caption",
  storyTreatment: "qwen-story-treatment",
  h3ShotPlanning: "qwen-h3-shot-planning",
  h3Still: "minimax-h3-still",
  localGeneration: "local-ai-generation",
  higgsfieldGeneration: "higgsfield-nano-banana-pro-grid",
  deepgramTranscription: "deepgram-transcribe-stored-audio",
  ffmpegPreview: "ffmpeg-preview-or-concat",
  seedanceAudioReference: "ffmpeg-seedance-audio-reference",
  finalExport: "ffmpeg-final-music-video-export",
  shaderCaptureExport: "ffmpeg-shader-capture-export",
  ffglitch: "ffglitch-transform",
  imageSplitter: "image-split-grid",
  reviewVideo: "prepare-review-video",
} as const;

export async function triggerReviewVideo(source: ReviewVideoSource, intentId: string) {
  assertTriggerConfigured();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(intentId)) throw new Error("Invalid review-video intent.");
  const identity = reviewVideoIdentity(source);
  const dispatch = await buildDispatchContext(["stack-structure", "review-preparation"], {
    stageLabel: "Waiting to prepare video review media", progressMode: "indeterminate",
  });
  if (dispatch.userId !== source.ownerId) throw new Error("Review preparation belongs to another user.");
  return tasks.trigger<typeof reviewVideoTask>(STACK_STRUCTURE_TRIGGER_TASKS.reviewVideo,
    { applicationUserId: dispatch.userId, source }, {
      idempotencyKey: createTriggerIdempotencyKey("review-video-v1", [dispatch.userId, identity, intentId]),
      idempotencyKeyTTL: "1d", tags: dispatch.tags, metadata: dispatch.metadata,
    }) as Promise<{ id: string }>;
}

export async function triggerH3Still(job: H3StillJob) {
  assertTriggerConfigured();
  const dispatch = await buildDispatchContext(["stack-structure", "h3-still", "swarmui", "vm100-heavy"], {
    stageLabel: "Waiting for MiniMax still capacity", progressMode: "provider",
  });
  if (dispatch.userId !== job.ownerId) throw new Error("Still generation belongs to another user.");
  return tasks.trigger<typeof h3StillTask>(STACK_STRUCTURE_TRIGGER_TASKS.h3Still,
    { ownerId: job.ownerId, projectId: job.projectId, jobId: job.id }, {
      idempotencyKey: createTriggerIdempotencyKey("h3-still-v1", [job.ownerId, job.projectId, job.id]),
      idempotencyKeyTTL: "30d", maxAttempts: 1,
      tags: [...dispatch.tags, `project:${job.projectId}`, `h3-still:${job.id}`], metadata: dispatch.metadata,
    }) as Promise<{ id: string }>;
}

/** Authenticated route verifies the previous run is terminal before calling.
 * Reconciliation never creates a new creative attempt or provider submission. */
export async function triggerH3StillReconciliation(job: H3StillJob, previousRunId: string, requestIntentId: string) {
  assertTriggerConfigured();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(requestIntentId)
    || job.runId !== previousRunId || !job.workflowSha256
    || !["submitting", "submission_unknown", "rendering", "persisting", "cancel_requested"].includes(job.state)) throw new Error("Choose an existing unresolved still attempt.");
  const dispatch = await buildDispatchContext(["stack-structure", "h3-still", "still-reconciliation", "vm100-heavy"], {
    stageLabel: "Checking the existing MiniMax still attempt", progressMode: "provider",
  });
  if (dispatch.userId !== job.ownerId) throw new Error("Still reconciliation belongs to another user.");
  return tasks.trigger<typeof h3StillTask>(STACK_STRUCTURE_TRIGGER_TASKS.h3Still,
    { ownerId: job.ownerId, projectId: job.projectId, jobId: job.id, mode: "reconcile", previousRunId }, {
      idempotencyKey: createTriggerIdempotencyKey("h3-still-reconcile-v1", [job.ownerId, job.id, previousRunId, requestIntentId]),
      idempotencyKeyTTL: "30d", maxAttempts: 1,
      tags: [...dispatch.tags, `project:${job.projectId}`, `h3-still:${job.id}`], metadata: dispatch.metadata,
    }) as Promise<{ id: string }>;
}

export async function triggerH3ShotPlanning(reference: H3ShotPlanningReference, attempt = 0) {
  assertTriggerConfigured();
  if (!Number.isInteger(attempt) || attempt < 0 || attempt > 2) throw new Error("Shot planning permits only three explicit attempts.");
  const dispatch = await buildDispatchContext(["stack-structure", "shot-planning", "qwen", "vm100-heavy"], {
    stageLabel: "Waiting for shot planning capacity", progressMode: "indeterminate",
  });
  if (dispatch.userId !== reference.ownerId) throw new Error("Shot planning dispatch owner changed.");
  return tasks.trigger<typeof h3ShotPlanningTask>(STACK_STRUCTURE_TRIGGER_TASKS.h3ShotPlanning, reference, {
    idempotencyKey: createTriggerIdempotencyKey("h3-shot-planning-v1", [reference.ownerId, reference.projectId, reference.planSignature, reference.bindingSha256, String(attempt)]),
    idempotencyKeyTTL: "30d", maxAttempts: 1,
    tags: [...dispatch.tags, `project:${reference.projectId}`, `planning-binding:${reference.bindingSha256}`, `planning-attempt:${attempt}`], metadata: dispatch.metadata,
  });
}

export async function triggerMediaSceneDetection(payload: MediaSceneDetectionPayload) {
  assertTriggerConfigured();
  const dispatch = await buildDispatchContext(["stack-structure", "media", "pipeline-v3"], {
    stageLabel: "Waiting for media pipeline capacity",
    progressMode: "exact",
  });
  return tasks.trigger<typeof mediaVideoPipelineTask>(STACK_STRUCTURE_TRIGGER_TASKS.mediaVideoPipeline, {
    ...payload,
    applicationUserId: dispatch.userId,
  }, {
    idempotencyKey: createTriggerIdempotencyKey("media-video-pipeline-v3", [
      payload.bucket,
      payload.objectKey,
      payload.mode ?? "scene-detect",
      payload.profile ?? "pyscenedetect-adaptive",
      payload.captionPrompt ?? "",
      payload.captionContext ?? "",
      JSON.stringify(payload.captionReferences ?? []),
      "stack-structure-media-pipeline-v3",
    ]),
    idempotencyKeyTTL: "24h",
    maxAttempts: 1,
    tags: dispatch.tags,
    metadata: dispatch.metadata,
  });
}

export async function triggerEssentiaAnalysis(payload: EssentiaStoredAudioPayload) {
  assertTriggerConfigured();
  const dispatch = await buildDispatchContext(["stack-structure", "essentia", "vm100-heavy"], {
    stageLabel: "Waiting for VM100 audio analysis",
    progressMode: "indeterminate",
  });
  return tasks.trigger<typeof essentiaStoredAudioTask>(STACK_STRUCTURE_TRIGGER_TASKS.essentiaAnalysis, payload, {
    idempotencyKey: createTriggerIdempotencyKey("essentia", [
      ...(payload.chunks
        ? payload.chunks.map((chunk) => `${chunk.bucket}:${chunk.objectKey}`)
        : [`${payload.bucket}:${payload.objectKey}`]),
      payload.size ?? "",
      payload.mode ?? "fast",
      "chunked-source-v1",
    ]),
    idempotencyKeyTTL: "24h",
    maxAttempts: 2,
    tags: dispatch.tags,
    metadata: dispatch.metadata,
  });
}

export async function triggerSmartSceneCaption(payload: SmartSceneCaptionPayload, imageDigest: string) {
  assertTriggerConfigured();
  const dispatch = await buildDispatchContext(["stack-structure", "caption", "qwen", "vm100-heavy"], {
    stageLabel: "Waiting for VM100 caption capacity",
    progressMode: "indeterminate",
  });
  return tasks.trigger<typeof smartSceneCaptionTask>(STACK_STRUCTURE_TRIGGER_TASKS.smartSceneCaption, payload, {
    idempotencyKey: createTriggerIdempotencyKey("smart-caption", [
      payload.sourceName ?? "unknown-source",
      payload.sceneId ?? "unknown-scene",
      payload.sampleTime ?? "unknown-time",
      payload.prompt,
      payload.model,
      payload.sceneStart ?? "",
      payload.sceneEnd ?? "",
      payload.sceneDuration ?? "",
      payload.captionContext ?? "",
      JSON.stringify(payload.captionReferences ?? []),
      imageDigest,
    ]),
    idempotencyKeyTTL: "24h",
    maxAttempts: 2,
    tags: dispatch.tags,
    metadata: dispatch.metadata,
  });
}

export type StoryTreatmentTriggerResult = {
  ok: boolean;
  loglineReview?: { version: 1; status: "passed" };
  model: string;
  output: Record<string, unknown>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export type StoryTreatmentDispatchIntent = { requestIntentId: string; validationAttempt?: number };

export function buildStoryTreatmentDispatchKey(payload: StoryTreatmentPayload, userId: string, intent: StoryTreatmentDispatchIntent) {
  return createTriggerIdempotencyKey("story-treatment", [
    userId,
    intent.requestIntentId,
    String(intent.validationAttempt ?? 0),
    payload.operation ?? "generate",
    payload.model,
    payload.instructions,
    payload.input,
    String(payload.maxTokens ?? ""),
    JSON.stringify(payload.reviewContext),
    "story-treatment-logline-review-v3",
  ]);
}

export async function triggerStoryTreatment(payload: StoryTreatmentPayload, intent: StoryTreatmentDispatchIntent = { requestIntentId: crypto.randomUUID() }) {
  assertTriggerConfigured();
  const dispatch = await buildDispatchContext(["stack-structure", "story", "qwen", "vm100-heavy"], {
    stageLabel: "Waiting for VM100 story treatment capacity",
    progressMode: "indeterminate",
  });
  return tasks.trigger<typeof storyTreatmentTask>(STACK_STRUCTURE_TRIGGER_TASKS.storyTreatment, payload, {
    idempotencyKey: buildStoryTreatmentDispatchKey(payload, dispatch.userId, intent),
    idempotencyKeyTTL: "24h",
    maxAttempts: 2,
    tags: dispatch.tags,
    metadata: dispatch.metadata,
  });
}

export async function waitForTriggerRunResult<T>(
  runId: string,
  options: { timeoutMs: number; pollIntervalMs?: number },
): Promise<T> {
  const startedAt = Date.now();
  let currentIntervalMs = options.pollIntervalMs ?? 2_000;

  while (Date.now() - startedAt <= options.timeoutMs) {
    const run = await retrieveTriggerRun(runId);
    if (run.isFailed || run.isCancelled) {
      throw new Error(run.error?.message || `Trigger run ${runId} ended with ${run.status}.`);
    }
    if (run.isCompleted) {
      if (run.isSuccess) return run.output as T;
      throw new Error(run.error?.message || `Trigger run ${runId} ended with ${run.status}.`);
    }

    const elapsedMs = Date.now() - startedAt;
    await sleep(Math.max(0, Math.min(currentIntervalMs, options.timeoutMs - elapsedMs)));
    currentIntervalMs = Math.min(Math.ceil(currentIntervalMs * 1.5), 15_000);
  }

  throw new Error(`Trigger run ${runId} timed out after ${Math.round(options.timeoutMs / 1_000)}s.`);
}

export async function triggerLocalGeneration(payload: LocalGenerationPayload) {
  assertTriggerConfigured();
  const request = payload.request;
  const dispatch = await buildDispatchContext(["stack-structure", "local-generation", request.provider, "vm100-heavy"], {
    stageLabel: "Waiting for VM100 generation capacity",
    progressMode: "provider",
  });
  return tasks.trigger<typeof localGenerationTask>(STACK_STRUCTURE_TRIGGER_TASKS.localGeneration, payload, {
    idempotencyKey: createTriggerIdempotencyKey("local-generation", [
      dispatch.userId,
      request.provider,
      request.kind ?? "image",
      request.prompt,
      request.negativePrompt ?? "",
      request.model ?? "default",
      typeof request.seed === "number" ? String(request.seed) : "random",
      request.width ?? "",
      request.height ?? "",
      request.steps ?? "",
      request.cfg ?? "",
      request.action ?? "",
      request.batchSize ?? "",
      JSON.stringify(request.swarmParams ?? {}),
      JSON.stringify(request.initImage ?? null),
      JSON.stringify(request.videoEndImage ?? null),
      JSON.stringify(request.promptImages ?? []),
      request.workflow ? JSON.stringify(request.workflow) : "swarm-api",
      payload.outputFolder ?? "",
      payload.timeoutSeconds ?? "",
    ]),
    idempotencyKeyTTL: "24h",
    maxAttempts: 1,
    tags: dispatch.tags,
    metadata: dispatch.metadata,
  }) as Promise<{ id: string }>;
}

/** The durable job ID hashes owner, project, plan, ordered refs, profile and revision intent. */
export async function triggerH3Generation(job: H3GenerationJob, resumeIntentId?: string) {
  assertTriggerConfigured();
  const dispatch = await buildDispatchContext(["stack-structure", "local-generation", "h3", "vm100-heavy"], {
    stageLabel: resumeIntentId ? "Reconciling the existing H3 job" : "Waiting for local H3 video capacity", progressMode: "provider",
  });
  if (dispatch.userId !== job.ownerId) throw new Error("Generation job belongs to another user.");
  const idempotencyKey = await idempotencyKeys.create(["h3-job-v1", job.id, resumeIntentId ?? "initial"], { scope: "global" });
  return tasks.trigger<typeof localGenerationTask>(STACK_STRUCTURE_TRIGGER_TASKS.localGeneration, {
    request: { provider: "swarmui", kind: "video", prompt: job.request.prompt },
    h3Job: { ownerId: job.ownerId, projectId: job.projectId, jobId: job.id },
  }, { idempotencyKey, idempotencyKeyTTL: "30d", maxAttempts: H3_AUTOMATIC_RECOVERY_ATTEMPTS,
    tags: [...dispatch.tags, `project:${job.projectId}`, `h3:${job.id}`], metadata: dispatch.metadata }) as Promise<{ id: string }>;
}

/** Reassess existing bytes without submitting a new provider render. */
export async function triggerCurrentIdentityRequest(job:H3GenerationJob,request:import("@/components/studio/currentReferenceIdentity").CurrentIdentityRequest){
  assertTriggerConfigured();
  const dispatch=await buildDispatchContext(["stack-structure","local-generation","h3","current-reference-assessment"],{stageLabel:"Checking current approved references against existing footage",progressMode:"provider"});
  if(dispatch.userId!==job.ownerId||request.scope.ownerId!==job.ownerId||request.scope.projectId!==job.projectId||request.scope.jobId!==job.id)throw new Error("Current-reference request belongs to another user or shot.");
  const idempotencyKey=await idempotencyKeys.create(`h3-current-${request.id}`,{scope:"global"});
  return tasks.trigger<typeof localGenerationTask>(STACK_STRUCTURE_TRIGGER_TASKS.localGeneration,{request:{provider:"swarmui",kind:"video",prompt:job.request.prompt},
    h3Job:{ownerId:job.ownerId,projectId:job.projectId,jobId:job.id,mode:"current-reference-assessment",currentRequestId:request.id}},
    {idempotencyKey,idempotencyKeyTTL:"30d",maxAttempts:1,tags:[...dispatch.tags,`project:${job.projectId}`,`h3:${job.id}`,`current-identity:${request.scope.requestIntentId}`],metadata:dispatch.metadata}) as Promise<{id:string}>;
}

export async function triggerH3IdentityRecheck(job: H3GenerationJob, requestIntentId: string, assessment?: H3IdentityAssessmentScope) {
  assertTriggerConfigured();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestIntentId)) {
    throw new Error("An explicit identity recheck intent UUID is required.");
  }
  if (assessment) {
    assertH3IdentityAssessmentScope(assessment,job);
    if (assessment.requestIntentId !== requestIntentId) throw new Error("The range assessment intent changed.");
  }
  const dispatch = await buildDispatchContext(["stack-structure", "local-generation", "h3", "identity-recheck"], {
    stageLabel: "Checking the existing H3 take against its pinned references", progressMode: "provider",
  });
  if (dispatch.userId !== job.ownerId) throw new Error("Generation job belongs to another user.");
  const idempotencyKey = await idempotencyKeys.create(`h3-identity-${job.id}-${requestIntentId}`, { scope: "global" });
  return tasks.trigger<typeof localGenerationTask>(STACK_STRUCTURE_TRIGGER_TASKS.localGeneration, {
    request: { provider: "swarmui", kind: "video", prompt: job.request.prompt },
    h3Job: { ownerId: job.ownerId, projectId: job.projectId, jobId: job.id, mode: "identity-recheck", ...(assessment ? { assessment } : {}) },
  }, { idempotencyKey, idempotencyKeyTTL: "30d", maxAttempts: 1,
    tags: [...dispatch.tags, `project:${job.projectId}`, `h3:${job.id}`], metadata: dispatch.metadata }) as Promise<{ id: string }>;
}

export async function triggerHiggsfieldGeneration(payload: HiggsfieldGenerationPayload) {
  assertTriggerConfigured();
  const dispatch = await buildDispatchContext(["stack-structure", "higgsfield", "external-paid"], {
    stageLabel: "Waiting for paid generation capacity",
    progressMode: "provider",
  });
  return tasks.trigger<typeof higgsfieldGenerationTask>(STACK_STRUCTURE_TRIGGER_TASKS.higgsfieldGeneration, payload, {
    idempotencyKey: createTriggerIdempotencyKey("higgsfield", [
      dispatch.userId,
      payload.approvalKey ?? "legacy",
      payload.model ?? "nano_banana_pro",
      payload.prompt,
      payload.title ?? "",
      payload.characterName ?? "",
      payload.aspectRatio ?? "16:9",
      payload.resolution ?? "2k",
      String(payload.splitRows),
      String(payload.splitCols),
      ...payload.inputImages.map((image) => `${image.id ?? ""}:${image.url}`),
    ]),
    idempotencyKeyTTL: "24h",
    maxAttempts: 1,
    tags: dispatch.tags,
    metadata: dispatch.metadata,
  });
}

export async function triggerDeepgramTranscription(payload: DeepgramStoredAudioPayload) {
  assertTriggerConfigured();
  const dispatch = await buildDispatchContext(["stack-structure", "deepgram", "external-provider"], {
    stageLabel: "Waiting for transcription capacity",
    progressMode: "provider",
  });
  return tasks.trigger<typeof deepgramTranscriptionTask>(STACK_STRUCTURE_TRIGGER_TASKS.deepgramTranscription, payload, {
    idempotencyKey: createTriggerIdempotencyKey("deepgram", [
      payload.bucket ?? "chunks",
      payload.objectKey ?? String(payload.size ?? payload.chunks?.length ?? 0),
      payload.sourceLabel,
    ]),
    idempotencyKeyTTL: "24h",
    maxAttempts: 1,
    tags: dispatch.tags,
    metadata: dispatch.metadata,
  });
}

export async function triggerFfmpegPreview(payload: FfmpegPreviewPayload) {
  assertTriggerConfigured();
  const dispatch = await buildDispatchContext(["stack-structure", "ffmpeg", "preview", "media-assembly"], {
    stageLabel: "Waiting for media assembly capacity",
    progressMode: "indeterminate",
  });
  return tasks.trigger<typeof ffmpegPreviewTask>(STACK_STRUCTURE_TRIGGER_TASKS.ffmpegPreview, { ...payload, applicationUserId: dispatch.userId }, {
    idempotencyKey: createTriggerIdempotencyKey("ffmpeg-preview", [
      dispatch.userId,
      payload.operation,
      payload.requestKey,
      ...payload.inputFiles.map((file) => `${file.bucket}:${file.objectKey}`),
      JSON.stringify(payload.segments ?? []),
      String(payload.startTime ?? 0),
      String(payload.endTime ?? 1),
    ]),
    idempotencyKeyTTL: "24h",
    maxAttempts: 1,
    tags: dispatch.tags,
    metadata: dispatch.metadata,
  });
}

export async function triggerSeedanceAudioReference(payload: SeedanceAudioReferencePayload) {
  assertTriggerConfigured();
  const dispatch = await buildDispatchContext(["stack-structure", "ffmpeg", "seedance-audio", "media-assembly"], {
    stageLabel: "Preparing Seedance timing reference",
    progressMode: "indeterminate",
  });
  return tasks.trigger<typeof seedanceAudioReferenceTask>(STACK_STRUCTURE_TRIGGER_TASKS.seedanceAudioReference, payload, {
    idempotencyKey: createTriggerIdempotencyKey("seedance-audio-reference", [
      payload.requestKey,
      payload.audio.bucket,
      payload.audio.objectKey,
      String(payload.songStart),
      String(payload.songEnd),
      String(payload.songDuration),
      String(payload.handleSeconds ?? 2),
    ]),
    idempotencyKeyTTL: "24h",
    maxAttempts: 1,
    tags: dispatch.tags,
    metadata: dispatch.metadata,
  });
}

export async function triggerFinalExport(payload: Omit<FinalExportPayload, "ownerId">) {
  assertTriggerConfigured();
  if (!isOwnedExportRequestKey(payload.requestKey, "final")) throw new Error(EXPORT_DISPATCH_UPGRADE_MESSAGE);
  const dispatch = await buildDispatchContext(["stack-structure", "ffmpeg", "export", "media-assembly"], {
    stageLabel: "Waiting for media assembly capacity",
    progressMode: "indeterminate",
  });
  if (payload.projectSnapshot && payload.projectSnapshot.ownerId !== dispatch.userId) throw new Error("Final export belongs to another project owner.");
  return tasks.trigger<typeof finalExportTask>(STACK_STRUCTURE_TRIGGER_TASKS.finalExport, { ...payload, ownerId: dispatch.userId }, {
    idempotencyKey: createTriggerIdempotencyKey("final-export-owned-v1", [
      dispatch.userId,
      payload.requestKey,
      JSON.stringify(payload.projectSnapshot ?? null),
      JSON.stringify(payload.segments),
      JSON.stringify(payload.effectCues ?? []),
      JSON.stringify(payload.accentKinds ?? {}),
      JSON.stringify(payload.beats ?? []),
      JSON.stringify(payload.lyricChunks ?? []),
      payload.shaderPresetId ?? "",
      ...payload.videos.map((video) => `${video.objectKey}:${video.expectedSha256 ?? ""}`),
      payload.audio.objectKey,
    ]),
    idempotencyKeyTTL: "24h",
    maxAttempts: 1,
    tags: dispatch.tags,
    metadata: dispatch.metadata,
  });
}

export async function triggerShaderCaptureExport(payload: Omit<ShaderCaptureExportPayload, "ownerId">) {
  assertTriggerConfigured();
  if (!isOwnedExportRequestKey(payload.requestKey, "capture")) throw new Error(EXPORT_DISPATCH_UPGRADE_MESSAGE);
  const dispatch = await buildDispatchContext(["stack-structure", "ffmpeg", "shader-capture", "media-assembly"], {
    stageLabel: "Waiting for media assembly capacity",
    progressMode: "indeterminate",
  });
  return tasks.trigger<typeof shaderCaptureExportTask>(STACK_STRUCTURE_TRIGGER_TASKS.shaderCaptureExport, { ...payload, ownerId: dispatch.userId }, {
    idempotencyKey: createTriggerIdempotencyKey("shader-capture-export-owned-v1", [dispatch.userId, payload.requestKey, payload.audio.objectKey, payload.shaderCapture.objectKey]),
    idempotencyKeyTTL: "24h",
    maxAttempts: 1,
    tags: dispatch.tags,
    metadata: dispatch.metadata,
  });
}

export async function triggerFfglitch(payload: FfglitchPayload) {
  assertTriggerConfigured();
  const dispatch = await buildDispatchContext(["stack-structure", "ffglitch", "vm100-heavy"], {
    stageLabel: "Waiting for VM100 FFglitch capacity",
    progressMode: "indeterminate",
  });
  return tasks.trigger<typeof ffglitchTask>(STACK_STRUCTURE_TRIGGER_TASKS.ffglitch, payload, {
    idempotencyKey: createTriggerIdempotencyKey("ffglitch", [
      payload.action,
      payload.sourceIdentity ?? payload.inputPath,
      payload.outputPath ?? "",
      JSON.stringify(payload.glitchParams ?? {}),
    ]),
    idempotencyKeyTTL: "24h",
    maxAttempts: 1,
    tags: dispatch.tags,
    metadata: dispatch.metadata,
  });
}

export async function triggerImageSplitter(payload: ImageSplitterPayload) {
  assertTriggerConfigured();
  const dispatch = await buildDispatchContext(["stack-structure", "image-splitter", "external-provider"], {
    stageLabel: "Waiting for image processing capacity",
    progressMode: "exact",
    totalItems: Math.max(1, payload.options.rows ?? 1) * Math.max(1, payload.options.cols ?? 1),
    completedItems: 0,
  });
  return tasks.trigger<typeof imageSplitterTask>(STACK_STRUCTURE_TRIGGER_TASKS.imageSplitter, payload, {
    idempotencyKey: createTriggerIdempotencyKey("image-split", [
      payload.bucket,
      payload.objectKey,
      payload.fileName,
      JSON.stringify(payload.options),
    ]),
    idempotencyKeyTTL: "24h",
    maxAttempts: 1,
    tags: dispatch.tags,
    metadata: dispatch.metadata,
  });
}

export async function retrieveTriggerRun(runId: string) {
  assertTriggerConfigured();
  const userId = await currentApplicationUserId();
  const run = await retrieveOwnedTriggerRun(runId, userId, (id) => runs.retrieve(id));
  return normalizeTriggerRunStatus(run);
}

export function assertTriggerConfigured(
  env?: { TRIGGER_API_URL?: string; TRIGGER_SECRET_KEY?: string },
) {
  const source = env ?? process.env as Record<string, string | undefined>;
  if (!source.TRIGGER_API_URL?.trim() || !source.TRIGGER_SECRET_KEY?.trim()) {
    throw new Error("Trigger.dev is not configured. Set TRIGGER_API_URL and TRIGGER_SECRET_KEY.");
  }
}

async function buildDispatchContext(
  tags: string[],
  metadata: Record<string, string | number>,
) {
  const userId = await currentApplicationUserId();
  return {
    userId,
    tags: [`user:${userId}`, ...tags.filter((tag) => !tag.startsWith("user:"))],
    metadata: {
      stage: "queued",
      providerStatus: "queued",
      ...metadata,
    },
  };
}

async function currentApplicationUserId() {
  const session = await applicationAuth();
  const userId = session?.user?.id?.trim();
  // SECURITY: never fall back to a shared identity. Anonymous jobs all share one
  // Trigger user-tag, which would let any caller read every other caller's runs.
  if (!userId) {
    throw new Error("Sign in with GitHub before dispatching Trigger tasks.");
  }
  return userId;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
