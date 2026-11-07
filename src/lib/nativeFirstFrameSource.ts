import { createHash } from "node:crypto";
import sharp from "sharp";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { nativeFirstFrameSelection, type NativeFirstFrameSelection, type NativeFirstFrameReceipt } from "@/components/studio/nativeFirstFrame";
import { h3FirstFrameDigest, H3_FIRST_FRAME_PREPARATION, H3_FIRST_FRAME_PROFILE } from "@/components/studio/h3FirstFrame";
import { identityAssessmentAsset } from "@/components/studio/h3IdentityAssessment";
import type { H3GenerationJob, H3GenerationRequest } from "@/components/studio/h3Generation";
import type { SavedStudioProject } from "./studioProjectStore";
import { readH3Job } from "./h3JobStore";
import { readH3IdentityAssessment } from "./h3IdentityAssessmentStore";
import { canonicalCurrentIdentityAsset } from "./currentIdentityValidation";
import { sourceConfirmationStorage } from "./generationScopeStore";
import { getMediaGatewayConfig } from "./mediaGateway";
import { mediaUploadBelongsToOwner } from "./essentiaUpload";
import { normalizeStudioOwnerSegment, normalizeStudioProjectId } from "./studioStoragePaths";
import { H3RequestError, h3GenerationJobId } from "./h3GenerationServer";
import { validateH3FirstFramePng, registerH3FirstFrame } from "./h3FirstFrameStore";

/** OpenCV proof hashes include shape and exact uint8 BGR pixels. No color correction or tolerance is allowed. */
export async function nativePngFrameSha256(bytes: Uint8Array, expectedPngSha256: string) {
  await validateH3FirstFramePng(bytes, expectedPngSha256);
  const image = sharp(bytes, { ignoreIcc: true, autoOrient: false, limitInputPixels: 1344 * 768, failOn: "warning" });
  const metadata = await image.metadata();
  if (metadata.icc || metadata.orientation && metadata.orientation !== 1) throw new H3RequestError("Use a canonical PNG without a color profile or orientation transform.");
  const { data, info } = await image.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== 1344 || info.height !== 768 || info.channels !== 3) throw new H3RequestError("Native source pixels have the wrong shape.");
  const bgr = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 3) { bgr[i] = data[i + 2]; bgr[i + 1] = data[i + 1]; bgr[i + 2] = data[i]; }
  return createHash("sha256").update("(768, 1344, 3)").update(bgr).digest("hex");
}

export async function canonicalNativeFirstFrameSource(ownerId: string, saved: SavedStudioProject, target: H3GenerationJob, input: NativeFirstFrameSelection) {
  if (!input || input.version !== 1 || !/^h3-[a-f0-9]{64}$/.test(input.jobId) || !Number.isSafeInteger(input.frameIndex)) throw new H3RequestError("Choose an exact owned native source frame.");
  const bank = saved.draft.generatedAssets?.filter(asset => asset.id === input.assetId);
  const job = await readH3Job(ownerId, saved.project.id, input.jobId);
  if (!job || job.ownerId !== ownerId || job.projectId !== saved.project.id || job.state !== "ready" || !job.result?.asset
    || bank?.length !== 1 || bank[0].jobId !== job.id || bank[0].reviewStatus === "rejected" || job.result.asset.reviewStatus === "rejected"
    || job.result.asset.id !== input.assetId || job.target.planSignature !== target.target.planSignature || job.target.songEnd > target.target.songStart + 1e-6) {
    throw new H3RequestError("The earlier source no longer matches this owned story and bank.", 409);
  }
  let source = job.result.asset;
  if (bank[0].identityAssessmentId) {
    const assessment = await readH3IdentityAssessment(ownerId, saved.project.id, job.id, bank[0].identityAssessmentId);
    if (!assessment) throw new H3RequestError("The canonical historical source range is unavailable.", 409);
    source = identityAssessmentAsset(assessment, job, bank[0].trimStart ?? 0);
  }
  source = await canonicalCurrentIdentityAsset(ownerId, saved.project.id, job,
    { ...source, trimStart: bank[0].trimStart ?? 0, reviewStatus: bank[0].reviewStatus }, saved.draft.musicVideoProject?.currentIdentity);
  const identities = source.identityVerification?.issuedPolicy?.body.galleries.map(gallery => gallery.referenceAssetId);
  const targetIdentities = target.references.filter(reference => reference.role === "identity").map(reference => reference.assetId);
  if (!identities?.length || h3FirstFrameDigest(identities) !== h3FirstFrameDigest(targetIdentities)) throw new H3RequestError("The source and new shot need the same named character authorities.", 409);
  const canonical = nativeFirstFrameSelection(source, input.frameIndex);
  if (h3FirstFrameDigest(canonical) !== h3FirstFrameDigest(input)) throw new H3RequestError("The source frame, range, media or current evidence changed.", 409);
  return canonical;
}

function sourcePrefix(ownerId: string, projectId: string) {
  if (normalizeStudioProjectId(projectId) !== projectId) throw new H3RequestError("Invalid native-source project.");
  return `media-uploads/projects/${normalizeStudioOwnerSegment(ownerId)}/native-first-frame-sources/${projectId}`;
}
function receiptKey(ownerId: string, projectId: string, id: string) {
  if (!/^h3-native-source-[a-f0-9]{64}$/.test(id)) throw new H3RequestError("Invalid native-source receipt.");
  return `${sourcePrefix(ownerId, projectId)}/${id}.json`;
}
export async function readNativeFirstFrameReceipt(ownerId: string, projectId: string, id: string): Promise<NativeFirstFrameReceipt | null> {
  const { client, bucket } = sourceConfirmationStorage();
  try {
    const value = await client.send(new GetObjectCommand({ Bucket: bucket, Key: receiptKey(ownerId, projectId, id) }), { abortSignal: AbortSignal.timeout(15_000) });
    if (!value.Body || !Number.isSafeInteger(value.ContentLength) || value.ContentLength! < 1 || value.ContentLength! > 32 * 1024) throw new H3RequestError("Native-source receipt exceeds its bound.", 503);
    const bytes = await value.Body.transformToByteArray(); if (bytes.length > 32 * 1024) throw new H3RequestError("Native-source receipt exceeds its bound.", 503);
    const receipt = JSON.parse(new TextDecoder().decode(bytes)) as NativeFirstFrameReceipt;
    if (receipt.version !== 1 || receipt.body?.version !== 1 || receipt.id !== id || receipt.sha256 !== h3FirstFrameDigest(receipt.body) || id !== `h3-native-source-${receipt.sha256}`
      || receipt.body.ownerId !== ownerId || receipt.body.projectId !== projectId || receipt.body.purpose !== "verified-native-frame-source-v1") throw new H3RequestError("Native-source receipt differs from its owned immutable record.", 409);
    return receipt;
  } catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404) return null; throw error; }
}
function jobIndexKey(ownerId: string, projectId: string, jobId: string) {
  if (!/^h3-[a-f0-9]{64}$/.test(jobId)) throw new H3RequestError("Invalid native-source target job.");
  return `${sourcePrefix(ownerId, projectId)}/by-job/${jobId}.json`;
}
/** The immutable index makes source provenance discoverable from a canonical job after local storage is lost. */
export async function readNativeFirstFrameReceiptForJob(ownerId: string, projectId: string, jobId: string) {
  const { client, bucket } = sourceConfirmationStorage();
  let id: string;
  try {
    const value = await client.send(new GetObjectCommand({ Bucket: bucket, Key: jobIndexKey(ownerId, projectId, jobId) }), { abortSignal: AbortSignal.timeout(15_000) });
    if (!value.Body || !Number.isSafeInteger(value.ContentLength) || value.ContentLength! < 1 || value.ContentLength! > 1024) throw new H3RequestError("Native-source index exceeds its bound.", 503);
    const bytes = await value.Body.transformToByteArray(); if (bytes.length > 1024) throw new H3RequestError("Native-source index exceeds its bound.", 503);
    id = JSON.parse(new TextDecoder().decode(bytes)).receiptId;
  } catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404) return null; throw error; }
  const receipt = await readNativeFirstFrameReceipt(ownerId, projectId, id);
  if (!receipt || receipt.body.targetJobId !== jobId) throw new H3RequestError("Native-source index differs from its canonical target job.", 409);
  return receipt;
}
function nativeSourceOriginSha256(body: NativeFirstFrameReceipt["body"]): string {
  // These record authority at first enrollment. Every retry separately proves fresh authority;
  // neither belongs to the immutable source/target identity used to recover that enrollment.
  const origin = Object.fromEntries(Object.entries(body).filter(([key]) => key !== "baselineSha256" && key !== "projectRevision"));
  return h3FirstFrameDigest(origin);
}
export async function registerNativeFirstFrame(params: { ownerId: string; saved: SavedStudioProject; target: H3GenerationJob; shot: H3GenerationRequest;
  source: NativeFirstFrameSelection; upload: { bucket: string; objectKey: string }; expectedSha256: string; baselineSha256: string; isCurrent: () => Promise<boolean> }) {
  const { ownerId, saved, target, shot, upload, expectedSha256 } = params, config = getMediaGatewayConfig();
  const source = await canonicalNativeFirstFrameSource(ownerId, saved, target, params.source);
  if (!config || upload?.bucket !== config.bucket || !mediaUploadBelongsToOwner(upload.objectKey, ownerId)
    || upload.objectKey.includes("\\") || upload.objectKey.split("/").some(part => !part || part === "." || part === "..")) throw new H3RequestError("Choose an image owned by this account.", 403);
  const storage = sourceConfirmationStorage();
  const downloaded = await storage.client.send(new GetObjectCommand({ Bucket: upload.bucket, Key: upload.objectKey }), { abortSignal: AbortSignal.timeout(60_000) });
  if (!downloaded.Body || !Number.isSafeInteger(downloaded.ContentLength) || downloaded.ContentLength! < 33 || downloaded.ContentLength! > 32 * 1024 * 1024) {
    (downloaded.Body as { destroy?: () => void } | undefined)?.destroy?.(); throw new H3RequestError("Native PNG exceeds its byte bound.", 409);
  }
  const chunks: Uint8Array[] = []; let length = 0;
  for await (const chunk of downloaded.Body as AsyncIterable<Uint8Array>) {
    length += chunk.length;
    if (length > downloaded.ContentLength!) { (downloaded.Body as { destroy?: () => void }).destroy?.(); throw new H3RequestError("Native PNG exceeded its declared byte count.", 409); }
    chunks.push(chunk);
  }
  if (length !== downloaded.ContentLength) throw new H3RequestError("Native PNG is incomplete.", 409);
  const bytes = Buffer.concat(chunks);
  if (bytes.length > 32 * 1024 * 1024 || await nativePngFrameSha256(bytes, expectedSha256) !== source.frameSha256) throw new H3RequestError("PNG pixels do not exactly match this canonical native frame. Import a lossless PNG from the canonical decoder; no color tolerance is applied.", 409);
  if (!await params.isCurrent()) throw new H3RequestError("The saved project changed while checking native pixels.", 409);
  // Existing artifact registration rereads the upload and checks the same full encoded SHA.
  const artifact = await registerH3FirstFrame(target, upload, expectedSha256);
  if (!await params.isCurrent()) throw new H3RequestError("The saved project changed before native-source enrollment. No generation was submitted.", 409);
  const conditioned = { ...shot, conditioning: { kind: "first-frame" as const, artifactId: artifact.id, expectedSha256 } };
  const body: NativeFirstFrameReceipt["body"] = { version: 1, purpose: "verified-native-frame-source-v1", ownerId, projectId: saved.project.id,
    source, artifactId: artifact.id, descriptorSha256: artifact.sha256, pngSha256: expectedSha256,
    targetJobId: h3GenerationJobId(ownerId, conditioned, target.references, { profile: H3_FIRST_FRAME_PROFILE, conditioningPreparationVersion: H3_FIRST_FRAME_PREPARATION, firstFrame: artifact }),
    requestSha256: h3FirstFrameDigest(shot), baselineSha256: params.baselineSha256, projectRevision: saved.revision! };
  const sha256 = h3FirstFrameDigest(body), receipt: NativeFirstFrameReceipt = { version: 1, id: `h3-native-source-${sha256}`, sha256, body };
  const recover = async (existing: NativeFirstFrameReceipt) => {
    if (nativeSourceOriginSha256(existing.body) !== nativeSourceOriginSha256(body)) throw new H3RequestError("Immutable target job already has a different native source.", 409);
    if (!await params.isCurrent()) throw new H3RequestError("The saved project changed while recovering native-source enrollment. No generation was submitted.", 409);
    return { artifact, sourceReceipt: existing };
  };
  // Only recover after canonical old/current proof, exact PNG and fresh project validation above.
  const existing = await readNativeFirstFrameReceiptForJob(ownerId, saved.project.id, body.targetJobId);
  if (existing) return recover(existing);
  if (!await params.isCurrent()) throw new H3RequestError("The saved project changed before native-source enrollment. No generation was submitted.", 409);
  const { client, bucket } = sourceConfirmationStorage();
  try { await client.send(new PutObjectCommand({ Bucket: bucket, Key: receiptKey(ownerId, saved.project.id, receipt.id), Body: JSON.stringify(receipt), ContentType: "application/json", IfNoneMatch: "*" }), { abortSignal: AbortSignal.timeout(15_000) }); }
  catch (error) {
    if (![409, 412].includes((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode ?? 0)) throw error;
    if (h3FirstFrameDigest(await readNativeFirstFrameReceipt(ownerId, saved.project.id, receipt.id)) !== h3FirstFrameDigest(receipt)) throw new H3RequestError("Immutable native-source receipt conflicts.", 409);
  }
  try { await client.send(new PutObjectCommand({ Bucket: bucket, Key: jobIndexKey(ownerId, saved.project.id, body.targetJobId), Body: JSON.stringify({ receiptId: receipt.id }), ContentType: "application/json", IfNoneMatch: "*" }), { abortSignal: AbortSignal.timeout(15_000) }); }
  catch (error) {
    if (![409, 412].includes((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode ?? 0)) throw error;
    const winner = await readNativeFirstFrameReceiptForJob(ownerId, saved.project.id, body.targetJobId);
    if (!winner) throw new H3RequestError("Native-source enrollment could not be recovered.", 409);
    return recover(winner);
  }
  if (!await params.isCurrent()) throw new H3RequestError("The saved project changed while enrolling native-source evidence. No generation was submitted.", 409);
  return { artifact, sourceReceipt: receipt };
}
