import { createHash } from "node:crypto";
import { validateSavedGenerationScope } from "./generationScopeServer";
import { buildGeneratedAssetPlaybackUrl, generatedAssetDraftIdentityBlockReason, type GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import { isPlacementPlanCurrent } from "@/components/studio/musicVideoProject";
import { buildStoryDraftSegments } from "@/components/studio/animaticDraft";
import { findH3TargetSegment } from "@/components/studio/h3DraftPlan";
import { hydrateStudioProjectDraft } from "@/components/studio/projectPersistence";
import { finalExportSnapshotSha256 } from "@/components/studio/finalExportRecovery";
import { buildStudioSourceContextSignature } from "@/components/studio/studioSourceContext";
import { buildStoryContentSignature } from "@/components/studio/storyTreatments";
import { clipAudioKey, normalizeClipAudioSettings, usesClipAudio } from "@/components/studio/clipAudio";
import type { FinalExportPayload, StoredExportInput } from "@/trigger/export";
import { resolveDurableInput, type DurableExportInput } from "./exportInputs";
import { readH3Job } from "./h3JobStore";
import { readStudioProject } from "./studioProjectStore";
import { normalizeStudioOwnerSegment } from "./studioStoragePaths";
import { canonicalIdentityPolicyJson, currentIdentityEvidenceSha256, normalizeH3PublicIssuedDraftPolicy } from "@/components/studio/issuedIdentityPolicy";
import { assertIssuedH3DraftPolicyMatchesJob, readIssuedH3DraftPolicy } from "./h3DraftPolicyStore";
import { readH3IdentityAssessment } from "./h3IdentityAssessmentStore";
import { identityAssessmentAsset } from "@/components/studio/h3IdentityAssessment";
import { assertCanonicalH3FirstFrame } from "./canonicalH3FirstFrame";
import {currentIdentityReviewSha256,currentReferenceIdentityApprovalSha256} from "@/components/studio/currentReferenceIdentity";
import { applyAcceptedGeneratedDraft } from "@/components/studio/generatedDraft";
import { reusedTakeReviewSha256 } from "@/components/studio/reusedTakePlacements";
import { resolveCanonicalSelectedFootageEvidence } from "./selectedFootageEvidenceServer";

export class ProjectExportError extends Error { constructor(message: string, readonly status: 400 | 403 | 409 = 409) { super(message); } }
export type ProjectExportContext = { projectId: string; planSignature: string; placementRevision: number; draftRevision: number };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const near = (a: unknown, b: unknown) => typeof a === "number" && typeof b === "number" && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-6;
const mediaKey = (input: Pick<StoredExportInput, "bucket" | "objectKey">) => `${input.bucket}\n${input.objectKey}`;

/** Durable namespace is authoritative even when browser asset tags are stripped or relabeled. */
export function h3ExportMediaIdentity(objectKey: string) {
  const match = /^media-uploads\/projects\/([^/]+)\/generated\/([^/]+)\/(h3-[a-f0-9]{64})(?:\/|$)/.exec(objectKey);
  return match ? { owner: match[1], projectId: match[2], jobId: match[3] } : null;
}

export function parseProjectExportContext(form: FormData): ProjectExportContext | null {
  const keys = ["projectId", "planSignature", "placementRevision", "draftRevision"];
  if (keys.every(key => form.get(key) === null)) return null;
  const projectId = form.get("projectId"), planSignature = form.get("planSignature");
  const placementRevision = Number(form.get("placementRevision")), draftRevision = Number(form.get("draftRevision"));
  if (typeof projectId !== "string" || !/^[a-zA-Z0-9_-]{1,96}$/.test(projectId)
    || typeof planSignature !== "string" || !planSignature.trim() || planSignature.length > 200
    || keys.some(key => form.get(key) === null) || !Number.isSafeInteger(placementRevision) || placementRevision < 0
    || !Number.isSafeInteger(draftRevision) || draftRevision < 0) throw new ProjectExportError("A complete current project export context is required.", 400);
  return { projectId, planSignature, placementRevision, draftRevision };
}

export async function reconcileProjectFinalExport(params: {
  ownerId: string; context: ProjectExportContext | null; audio: DurableExportInput; videos: DurableExportInput[];
  segments: FinalExportPayload["segments"];
}): Promise<{ audio: StoredExportInput; videos: StoredExportInput[]; segments: FinalExportPayload["segments"]; projectSnapshot?: FinalExportPayload["projectSnapshot"] }> {
  const { ownerId, context } = params;
  const knownH3 = params.videos.flatMap(video => [video.objectKey, ...(video.chunks ?? []).map(chunk => chunk.objectKey)])
    .map(h3ExportMediaIdentity).filter(identity => identity !== null);
  if (!context) {
    if (knownH3.length) throw new ProjectExportError("Generated H3 media requires its current approved project snapshot.");
    return { audio: params.audio, videos: params.videos, segments: params.segments };
  }
  if (knownH3.some(identity => identity.owner !== normalizeStudioOwnerSegment(ownerId) || identity.projectId !== context.projectId)) {
    throw new ProjectExportError("Generated media does not belong to this account and project.", 403);
  }
  // Canonical H3 returns one complete video, never a client-assembled chunk manifest.
  if (params.videos.some(video => video.chunks?.some(chunk => h3ExportMediaIdentity(chunk.objectKey)))) {
    throw new ProjectExportError("An H3 output cannot be relabeled as an ordinary source chunk.");
  }
  const saved = await readStudioProject(ownerId, context.projectId, { fresh: true });
  if (!saved) throw new ProjectExportError("Project not found.", 403);
  const { draft } = saved;
  const project = draft.musicVideoProject;
  if (!project || !isPlacementPlanCurrent(project) || project.placementPlan!.inputSignature !== context.planSignature
    || project.placementPlan!.revision !== context.placementRevision || (draft.generatedDraft?.revision ?? 0) !== context.draftRevision
    || (draft.generatedDraft?.assetIds.length ?? 0) !== 0 || !draft.storyState.storyGenerated) {
    throw new ProjectExportError("The accepted project snapshot changed. Save and review the current draft before exporting.");
  }
  const runtime = hydrateStudioProjectDraft({ draft });
  const base = buildStoryDraftSegments({ projectId: context.projectId, project: runtime.musicVideoProject, videoSources: runtime.videoSources,
    storyState: runtime.storyState, referenceAssets: runtime.referenceAssets, audio: runtime.analysis ?? project.song }).map(segment => {
      const source = runtime.videoSources.find(source => source.videoUrl === segment.videoUrl);
      return { ...segment, useClipAudio: segment.kind !== "gap" && usesClipAudio(normalizeClipAudioSettings(runtime.clipAudioSettings), source ? clipAudioKey(source) : undefined) };
    });
  let generationScope: string | undefined;
  try { generationScope = await validateSavedGenerationScope(ownerId, saved); }
  catch { throw new ProjectExportError("The canonical source confirmation changed. Review and confirm the current sources before exporting."); }
  if (!generationScope || (project.generationScope && (draft.generatedDraft?.sourceReviewRequired !== false
    || draft.generatedDraft.sourceConfirmationSha256 !== project.generationScope.sha256))) {
    throw new ProjectExportError("Review and accept the assembled cut after confirming its appended sources.");
  }
  if(project.currentIdentity&&draft.generatedDraft?.currentIdentityApprovalSha256!==currentIdentityReviewSha256(project.currentIdentity))throw new ProjectExportError("Review and accept the current-reference assessment context before exporting.");
  const assets: GeneratedStudioAsset[] = [];
  const currentUsedUrls = project.currentIdentity ? new Set(applyAcceptedGeneratedDraft(base, runtime.generatedAssets, draft.generatedDraft).map(segment => segment.videoUrl)) : undefined;
  const canonicalByKey = new Map<string, GeneratedStudioAsset>();
  const environmentOnlyNativeBounds = new Set<string>();
  const receipts: NonNullable<FinalExportPayload["projectSnapshot"]>["h3"] = [];
  if (draft.generatedDraft?.reusedTakePlacements?.some(row => !runtime.generatedAssets.some(asset => asset.id === row.assetId))) throw new ProjectExportError("Reused footage is missing from the current saved bank.");
  for (const asset of runtime.generatedAssets) {
    const reuseRows = draft.generatedDraft?.reusedTakePlacements?.filter(row => row.assetId === asset.id) ?? [];
    for (const row of reuseRows) {
      if (row.approvedReviewSha256 !== reusedTakeReviewSha256(row, asset)
        || !await resolveCanonicalSelectedFootageEvidence({ selected: true, ownerId, projectId: context.projectId,
          generationScope, asset, reusedTakePlacement: row, reuseOrigins: project.generationScope?.body.reuseOrigins,
          currentIdentity: project.currentIdentity, window: { songStart: row.target.songStart, songEnd: row.target.songEnd,
            sourceStart: row.sourceStart, sourceEnd: row.sourceEnd } })) throw new ProjectExportError("Reused footage provenance, placement or fresh creative review changed.");
    }
    if (asset.reviewStatus !== "approved" && !reuseRows.length) { assets.push(asset); continue; }
    // Retained superseded approvals are history. Only actual current overlays need new-context consent/evidence.
    if(currentUsedUrls&&!currentUsedUrls.has(buildGeneratedAssetPlaybackUrl(asset)??""))continue;
    // Match only target coordinates here; never use client identity/hash claims
    // to decide which canonical media evidence must be read below.
    if (base.some(segment => segment.animaticShotId) && !reuseRows.length && (!asset.target || !findH3TargetSegment(base, asset.target))) continue;
    // Approved history from another plan is retained in the project but cannot overlay this cut.
    if (asset.target?.planSignature && asset.target.planSignature !== generationScope && !reuseRows.length) continue;
    const objectKey = asset.fullStorage?.objectKey ?? asset.fullStorage?.storagePath ?? "";
    const identity = h3ExportMediaIdentity(objectKey);
    const h3 = identity || asset.jobId?.startsWith("h3-") || /^h3-ref2va-/.test(asset.model);
    if (!h3) { assets.push(asset); continue; }
    const jobId = identity?.jobId ?? asset.jobId;
    if (!jobId || !/^h3-[a-f0-9]{64}$/.test(jobId) || (identity && (identity.owner !== normalizeStudioOwnerSegment(ownerId) || identity.projectId !== context.projectId))) {
      throw new ProjectExportError("An approved generated take has no canonical project job.");
    }
    const job = await readH3Job(ownerId, context.projectId, jobId);
    let canonical = job?.result?.asset;
    if (!job || job.state !== "ready" || !canonical || canonical.id !== asset.id || canonical.reviewStatus === "rejected"
      || (!reuseRows.length && (job.target.planSignature !== generationScope || canonical.target?.planSignature !== generationScope))) {
      throw new ProjectExportError("An approved generated take no longer matches its canonical ready job.");
    }
    if (asset.identityAssessmentId) {
      try {
        const assessment = await readH3IdentityAssessment(ownerId,context.projectId,job.id,asset.identityAssessmentId);
        if (!assessment) throw new Error("Missing assessment");
        canonical = identityAssessmentAsset(assessment,job,asset.trimStart ?? 0);
      } catch { throw new ProjectExportError("The selected range assessment does not match this owned shot, policy and exact trim."); }
    }
    const identityHashes = job.references.flatMap((reference, index) => reference.role === "identity" && job.referenceHashes?.[index] ? [job.referenceHashes[index]] : []);
    if (!job.referenceHashes || job.referenceHashes.length !== job.references.length
      || JSON.stringify(canonical.generationReferenceHashes) !== JSON.stringify(job.referenceHashes)
      || JSON.stringify(canonical.identityReferenceHashes) !== JSON.stringify(identityHashes)) {
      throw new ProjectExportError("The canonical take does not match its actual generation references.");
    }
    let authoritative: GeneratedStudioAsset = { ...canonical, id: canonical.id, jobId: job.id, provider: "swarmui", model: job.profile,
      target: job.target, trimStart: asset.trimStart ?? 0, reviewStatus: "approved", approvedAt: asset.approvedAt,
      approvedIdentityEvidenceSha256: asset.approvedIdentityEvidenceSha256,approvedCurrentReferenceEvidenceSha256:asset.approvedCurrentReferenceEvidenceSha256 };
    try{if(project.currentIdentity)authoritative=await(await import("./currentIdentityValidation")).canonicalCurrentIdentityAsset(ownerId,context.projectId,job,authoritative,project.currentIdentity);}
    catch{throw new ProjectExportError("Current-reference canonical evidence changed. Review this exact take again.");}
    try { await assertCanonicalH3FirstFrame(ownerId, context.projectId, job, asset); }
    catch { throw new ProjectExportError("The approved first-frame artifact or its canonical still screen changed. This take cannot enter export."); }
    if (!reuseRows.length && asset.identityAssessmentId && asset.approvedIdentityEvidenceSha256 !== currentIdentityEvidenceSha256(authoritative)) {
      throw new ProjectExportError("The range evidence changed after approval. Review and accept the exact assembled draft again.");
    }
    if (job.request.identityPolicyFamily) {
      if (!job.identityPolicy) throw new ProjectExportError("The take has no canonical issued identity policy.");
      const policy = await readIssuedH3DraftPolicy(ownerId, context.projectId, job.identityPolicy);
      if (!policy) throw new ProjectExportError("The canonical identity policy is unavailable.");
      assertIssuedH3DraftPolicyMatchesJob(policy, job, job.referenceHashes);
      const publicPolicy = normalizeH3PublicIssuedDraftPolicy(policy);
      if (!publicPolicy || !canonical.identityVerification?.issuedPolicy || canonical.identityVerification.status !== "unverifiable"
        || canonicalIdentityPolicyJson(canonical.identityVerification.issuedPolicy) !== canonicalIdentityPolicyJson(publicPolicy)
        || (!reuseRows.length && asset.approvedIdentityEvidenceSha256 !== currentIdentityEvidenceSha256(authoritative))) {
        throw new ProjectExportError("The issued identity evidence changed after approval. View and approve this exact draft again.");
      }
    }
    if(!reuseRows.length&&project.currentIdentity&&asset.approvedCurrentReferenceEvidenceSha256!==currentReferenceIdentityApprovalSha256(authoritative))throw new ProjectExportError("Current-reference evidence changed after approval. Review this exact draft again.");
    // Owner approval is consent to this snapshot; eligibility comes only from worker evidence.
    const reason = generatedAssetDraftIdentityBlockReason(authoritative);
    if (reason) throw new ProjectExportError(`${reason}. This take cannot enter final export.`);
    if (!authoritative.fullStorage?.bucket || !authoritative.fullStorage.objectKey || !/^[a-f0-9]{64}$/.test(authoritative.mediaSha256 ?? "")) {
      throw new ProjectExportError("The canonical generated take has no verified durable media binding.");
    }
    const canonicalKey = mediaKey({ bucket: authoritative.fullStorage.bucket, objectKey: authoritative.fullStorage.objectKey });
    canonicalByKey.set(canonicalKey, authoritative);
    // No identity claim is made for an environment-only shot. Its immutable
    // full-media SHA/probe permits another valid native trim without reassessing faces.
    if (canonical.identityVerification?.status === "not_required" && job.references.every(reference => reference.role !== "identity")
      && canonical.identityReferenceHashes?.length === 0) environmentOnlyNativeBounds.add(canonicalKey);
    assets.push(authoritative);
    receipts.push({ jobId: job.id, assetId: authoritative.id, mediaSha256: authoritative.mediaSha256!,
      ...(authoritative.identityAssessmentId ? { identityAssessmentId: authoritative.identityAssessmentId } : {}),
      ...(authoritative.currentReferenceIdentity?.assessment?.status==="ready"?{currentIdentityAssessmentId:authoritative.currentReferenceIdentity.assessment.scope.id,currentIdentityProofSha256:authoritative.currentReferenceIdentity.assessment.proofSha256}:{}),
      proofSha256: digest(authoritative.identityVerification), trimStart: authoritative.trimStart ?? 0,
      trimEnd: (authoritative.trimStart ?? 0) + job.target.songEnd - job.target.songStart });
  }
  for (const video of params.videos) if (h3ExportMediaIdentity(video.objectKey) && !canonicalByKey.has(mediaKey(video))) {
    throw new ProjectExportError("Generated media is not an approved canonical take in this snapshot.");
  }
  if (receipts.length) {
    const story = draft.storyState;
    const liveContext = buildStudioSourceContextSignature({ analysis: runtime.analysis, videoSources: runtime.videoSources, referenceAssets: runtime.referenceAssets });
    if (story.confirmedSourceContextSignature !== liveContext || project.sourceContextSignature !== liveContext
      || !story.confirmedTreatmentSnapshot || story.confirmedTreatmentId !== story.confirmedTreatmentSnapshot.id
      || story.storyContentSignature !== buildStoryContentSignature(story.confirmedTreatmentSnapshot, story.storyBeats)) {
      throw new ProjectExportError("The song, references or story changed after generated-shot approval.");
    }
  }
  const preview = applyAcceptedGeneratedDraft(base, assets, draft.generatedDraft);
  if (draft.generatedDraft?.reusedTakePlacements?.some(row => !preview.some(segment => segment.reusedTakePlacementId === row.id))) throw new ProjectExportError("A reused placement no longer belongs to the accepted cut.");
  if (preview.length !== params.segments.length || preview.some(segment => segment.kind === "gap" || !segment.videoUrl)) {
    throw new ProjectExportError("The submitted export does not match a complete accepted project cut.");
  }
  const audio = resolveDurableInput({ bucket: runtime.analysis?.storageBucket, objectKey: runtime.analysis?.storagePath }, "audio/wav");
  if (mediaKey(audio) !== mediaKey(params.audio) || params.audio.chunks?.length) throw new ProjectExportError("The submitted master does not match the accepted project.");
  const videos: StoredExportInput[] = [];
  const segments: FinalExportPayload["segments"] = [];
  let songCursor = 0;
  for (const [index, segment] of preview.entries()) {
    const source = runtime.videoSources.find(source => source.videoUrl === segment.videoUrl);
    const generated = assets.find(asset => buildGeneratedAssetPlaybackUrl(asset) === segment.videoUrl);
    const key = generated?.fullStorage?.objectKey ?? generated?.fullStorage?.storagePath ?? source?.storagePath;
    const bucket = generated?.fullStorage?.bucket ?? source?.storageBucket;
    const expected = resolveDurableInput({ bucket, objectKey: key, ...(source?.uploadChunks?.chunks?.length ? { chunks: source.uploadChunks.chunks } : {}) }, "video/mp4");
    const canonical = canonicalByKey.get(mediaKey(expected));
    if (h3ExportMediaIdentity(expected.objectKey) && !canonical) throw new ProjectExportError("An H3 output cannot be relabeled as ordinary source footage.");
    const submitted = params.segments[index];
    const ref = params.videos[submitted.sourceIndex ?? 0];
    if (!ref || mediaKey(expected) !== mediaKey(ref) || JSON.stringify(expected.chunks ?? []) !== JSON.stringify(ref.chunks ?? [])
      || !near(submitted.startTime, segment.startTime) || !near(submitted.endTime, segment.endTime)
      || !near(submitted.musicStart, segment.musicStart) || !near(submitted.musicEnd, segment.musicEnd)
      || Boolean(submitted.useClipAudio) !== Boolean(segment.useClipAudio) || !near(segment.musicStart, songCursor)
      || segment.musicEnd <= segment.musicStart || segment.endTime <= segment.startTime) {
      throw new ProjectExportError("Export media or trim timing changed after draft acceptance.");
    }
    let sourceIndex = videos.findIndex(video => mediaKey(video) === mediaKey(expected));
    if (sourceIndex < 0) { sourceIndex = videos.length; videos.push({ ...expected, ...(canonical ? { expectedSha256: canonical.mediaSha256 } : {}) }); }
    let sourceFrameWindow: FinalExportPayload["segments"][number]["sourceFrameWindow"];
    if (canonical) {
      const proof = canonical.identityVerification;
      const startFrame = Math.floor(segment.startTime * 24 + 1e-6), endFrameExclusive = Math.ceil(segment.endTime * 24 - 1e-6);
      const environmentOnly = environmentOnlyNativeBounds.has(mediaKey(expected));
      if (!proof || canonical.mediaFrameRate !== 24 || !Number.isSafeInteger(canonical.mediaFrameCount)
        || proof.frameCount !== canonical.mediaFrameCount || proof.frameRate !== 24
        || startFrame < (environmentOnly ? 0 : proof.verifiedStartFrame)
        || endFrameExclusive > (environmentOnly ? canonical.mediaFrameCount! : proof.verifiedEndFrameExclusive)) {
        throw new ProjectExportError("The canonical H3 source frames are outside the approved verification window.");
      }
      sourceFrameWindow = { startFrame, endFrameExclusive, frameRate: 24, totalFrames: canonical.mediaFrameCount! };
    }
    segments.push({ sourceIndex, startTime: segment.startTime, endTime: segment.endTime, musicStart: segment.musicStart,
      musicEnd: segment.musicEnd, useClipAudio: segment.useClipAudio, label: segment.label,
      ...(sourceFrameWindow ? { sourceFrameWindow } : {}) });
    songCursor = segment.musicEnd;
  }
  if (!near(songCursor, project.duration)) throw new ProjectExportError("The accepted cut does not cover the full master song.");
  return { audio, videos, segments, projectSnapshot: { ownerId, projectId: context.projectId, planSignature: context.planSignature,
    placementRevision: context.placementRevision, draftRevision: context.draftRevision, acceptedSnapshotSha256: finalExportSnapshotSha256(draft), h3: receipts,
    ...(project.generationScope ? { generationScope: { signature: generationScope, receiptSha256: project.generationScope.sha256 } } : {}),
    ...(project.currentIdentity?{currentIdentityContextSha256:project.currentIdentity.contextSha256,currentIdentityMigrationSha256:project.currentIdentity.migrationSha256}: {}) } };
}
