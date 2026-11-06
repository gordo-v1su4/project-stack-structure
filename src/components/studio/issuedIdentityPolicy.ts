// Shared fixed numerical policy families and issued evidence. Not an identity certificate.

import type { H3ReferenceSnapshot } from "./h3Generation";
import type { H3IdentityFaceRegion } from "../../lib/h3IdentityGallery";
import { sha256 } from "@noble/hashes/sha2.js";
import foregroundFamily from "../../../scripts/identity/families/sface-yunet-foreground-frontal-v1.json";
import jointFamily from "../../../scripts/identity/families/sface-yunet-joint-frontal-v1.json";
import foregroundFamilyV2 from "../../../scripts/identity/families/sface-yunet-foreground-frontal-v2.json";
import jointFamilyV2 from "../../../scripts/identity/families/sface-yunet-joint-frontal-v2.json";
import type { GeneratedStudioAsset } from "./generatedAssets";
import type { ReferenceAsset } from "./referenceAssets";
import { H3_FIRST_FRAME_PROFILE, normalizeH3FirstFrameBinding, type H3FirstFrameBinding } from "./h3FirstFrame";

export type H3IdentityPolicyFamilyId = "sface-yunet-foreground-frontal-v1" | "sface-yunet-joint-frontal-v1"
  | "sface-yunet-foreground-frontal-v2" | "sface-yunet-joint-frontal-v2";
export type Sha256 = string; // Normalize exactly64 lowercase hex at every untrusted boundary.
export type H3IdentityPolicyChoice = { identityPolicyFamily?: H3IdentityPolicyFamilyId };
// Add optional identityPolicyFamily to H3GenerationRequest only when explicitly supplied.
// Existing missing-field request JSON/job IDs remain byte-for-byte unchanged.

export type H3PolicyModelPins = {
  method: "face-embedding-cosine";
  model: "opencv-sface-2021dec-yunet-2023mar";
  recognitionSha256: "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79";
  detectionSha256: "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4";
  verifierVersion: "sface-yunet-cpu-v1";
  preprocessBaseVersion: "opencv412-aligncrop112-rgb-f32-nchw-unit-centroid-v1";
};
export type H3PolicyFrontalGeometry = {
  minimumFaceWidthPixels: 128; minimumFaceHeightPixels: 160; minimumDetectionScore: 0.94 | 0.9;
  maximumAbsoluteRollDegrees: 8; maximumAbsoluteNoseEyeMidpointOffsetOverEyeDistance: 0.1;
  maximumAbsoluteMouthEyeMidpointOffsetOverEyeDistance: 0.12; minimumEyeDistancePixels: 48;
  minimumNoseDepthOverEyeDistance: 0.15; maximumNoseDepthOverEyeDistance: 1.5;
  maximumMouthDepthOverEyeDistance: 2.5; requireWholeFaceBoxInsideImage: true;
  minimumConsecutiveFaceBoxIoU: 0.15; minimumIntendedFrameCount: 3; requireEveryIntendedFrame: true;
};
export type H3PolicyFamily = {
  version: 1; id: H3IdentityPolicyFamilyId; sha256: Sha256; model: H3PolicyModelPins;
  threshold: 0.8; frontalGeometry: H3PolicyFrontalGeometry;
  acquisitionWarningsOnly: { nativeBoxBlurVarianceBelow: 100; nativeBoxLuminanceBelow: 60; nativeBoxLuminanceAbove: 190 };
  referencePreparation: { method: "yunet-frontal-coherent-gallery-v1"; maximumDetectedFaceCount: 32;
    maximumGalleryRegionCount: 9; minimumGalleryRegionCount: 1; minimumPairwiseCosine: 0.8 };
  scope: { kind: "dominant-foreground"; requiredIdentityCount: 1;
    maximumBackgroundWidthRatio: 0.6; maximumBackgroundHeightRatio: 0.6; maximumBackgroundAreaRatio: number; // exactly1/3
    minimumLeadCosineMargin: 0.15; maximumDetectedFaceCount: 32;
    requireUniqueLargestFaceBeforeSimilarity: true; requireNoBackgroundLeadBoxIntersection: true; forbidAdditionalForegroundQualifiedFace: true;
  } | { kind: "joint-frontal"; requiredIdentityCount: 2; requiredDetectedFaceCount: 2;
    minimumAssignmentCosineMargin: 0.08; requireDistinctContinuousTracks: true; requireOwnPreviousBoxIoUGreaterThanCrossTrack: true };
  preserveIdentityVerificationStatus: "unverifiable";
};
export type H3PolicyRawReference = H3ReferenceSnapshot & { rawSha256: Sha256 };
export type H3PolicyGallery = {
  referenceAssetId: string; canonicalName: string; rawSha256: Sha256;
  faceRegions: H3IdentityFaceRegion[]; // Ordered, normalized, finite, inside raw image;1..9.
  referenceValidation: { method: "yunet-frontal-coherent-gallery-v1";
    detectedFaceCount: number; frontalAnchorCount: number; selectedRegionCount: number;
    minimumPairwiseCosine?: number; evidenceSha256: Sha256 };
};
export type H3IdentityPolicyPreflightInput = {
  version: 1; bindingSha256: Sha256; family: H3PolicyFamily;
  references: (H3PolicyRawReference & { localPath: string })[]; // All ordered raw refs, including environment.
};
export type H3IdentityPolicyPreflightResult = {
  version: 1; bindingSha256: Sha256; familyId: H3IdentityPolicyFamilyId; familySha256: Sha256;
  status: "ready" | "unverifiable"; model: H3PolicyModelPins;
  galleries: H3PolicyGallery[]; // Exactly the job's ordered identities, no invented/missing identity.
  galleryProfileSha256?: Sha256; // Existing identity_gallery_profile algorithm across ordered identities.
  reason?: "no-frontal-anchor" | "ambiguous-gallery" | "incoherent-gallery" | "invalid-reference" | "model-unavailable";
};
export type H3IssuedDraftPolicyBody = {
  version: 1; ownerId: string; projectId: string; generationModel: "h3-ref2va-int8-v3" | typeof H3_FIRST_FRAME_PROFILE;
  familyId: H3IdentityPolicyFamilyId; familySha256: Sha256;
  references: H3PolicyRawReference[]; // Exact immutable refs/ETags/order/version; no temp paths.
  identityReferenceHashes: Sha256[]; galleries: H3PolicyGallery[];
  galleryProfileSha256: Sha256; preprocessVersion: string;
  firstFrame?: H3FirstFrameBinding;
};
export type H3IssuedDraftPolicyBinding = {
  version: 1; id: string; // h3-policy-<sha256> derived from canonical body bytes.
  sha256: Sha256; familyId: H3IdentityPolicyFamilyId; familySha256: Sha256;
};
export type H3IssuedDraftPolicy = H3IssuedDraftPolicyBinding & {
  body: H3IssuedDraftPolicyBody; issuedAt: string; // Timestamp excluded from policy digest/idempotency.
};
export type H3PublicIssuedDraftPolicy = Omit<H3IssuedDraftPolicy, "issuedAt">;
// New optional job field identityPolicy?: H3IssuedDraftPolicyBinding.
// New optional identityVerification field issuedPolicy?: H3PublicIssuedDraftPolicy.
// Existing filter.policyId/filter.policySha256 point to the issued policy binding.
// New optional approvedIdentityEvidenceSha256 on a generated asset is owner consent
// to exactly {id,jobId,model,mediaSha256,target,trimStart,identityVerification}.

const families = [
  { ...foregroundFamily, sha256: "15c8acceeb809a13c4d322b03fd4967c3013ab78610774df1f3b3b28f3ad391b" },
  { ...jointFamily, sha256: "b6f5526099fc483a1fa0573f79636b40304e00e37c0074b1014cba15d6424b95" },
  { ...foregroundFamilyV2, sha256: "45bd64dac164694b7715c7afd65debdea3a9b5db24725016f30fd05cea6ec6f4" },
  { ...jointFamilyV2, sha256: "6abae4d91e76d21864c88d2e3fcbb03b4a7052f5a2bd7b47bbc7a56bb50c2a44" },
] as H3PolicyFamily[];
function freeze(value: object) { Object.values(value).forEach(item => { if (item && typeof item === "object") freeze(item); }); return Object.freeze(value); }
families.forEach(freeze);
export function getH3PolicyFamily(id: string): H3PolicyFamily | undefined { return families.find(family => family.id === id); }
/** For a genuinely new intent only. Never inject a family into persisted requests or retries. */
export function identityPolicyChoiceForReferences(assets: ReferenceAsset[], referenceAssetIds: readonly string[]): H3IdentityPolicyChoice {
  const count = assets.filter(asset => referenceAssetIds.includes(asset.id) && (asset.kind === "character" || asset.role.startsWith("character"))).length;
  if (count > 2) throw new Error("Create shots with at most two named characters so both can be screened.");
  return count === 1 ? { identityPolicyFamily: "sface-yunet-foreground-frontal-v2" }
    : count === 2 ? { identityPolicyFamily: "sface-yunet-joint-frontal-v2" } : {};
}
export function canonicalIdentityPolicyJson(value: unknown): string {
  const sort = (item: unknown): unknown => {
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === "object" && (Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null)) {
      return Object.fromEntries(Object.keys(item).sort().filter(key => (item as Record<string, unknown>)[key] !== undefined)
        .map(key => [key, sort((item as Record<string, unknown>)[key])]));
    }
    throw new Error("Policy evidence must contain finite JSON data.");
  };
  return JSON.stringify(sort(value));
}
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
export const identityPolicySha256 = (value: unknown) => hex(sha256(new TextEncoder().encode(canonicalIdentityPolicyJson(value))));
/** Existing Python gallery encoding is deliberately separate from issued-body JSON. */
export function issuedGalleryProfileSha256(galleries: readonly H3PolicyGallery[]): string {
  const ascii = (value: string) => JSON.stringify(value).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
  const float = (value: number) => {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("Invalid normalized gallery coordinate.");
    if (Number.isInteger(value)) return `${value}.0`;
    if (value < 1e-4) {
      const [coefficient, exponent] = value.toExponential().split("e");
      const power = Number(exponent);
      return `${coefficient}e${power < 0 ? "-" : "+"}${Math.abs(power).toString().padStart(2, "0")}`;
    }
    return String(value);
  };
  const references = galleries.map(gallery => `{"canonicalName":${ascii(gallery.canonicalName)},"faceRegions":[${gallery.faceRegions.map(region =>
    `{"name":${ascii(region.name)},"rect":[${region.rect.map(float).join(",")}]}`).join(",")}],"rawSha256":${ascii(gallery.rawSha256)}}`);
  return hex(sha256(new TextEncoder().encode(`{"references":[${references.join(",")}],"version":"ordered-raw-identity-normalized-rois-half-even-v1"}`)));
}
export const isIdentityPolicySha256 = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 512): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const segment = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const count = (value: unknown, max: number) => Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= max;

export function normalizeH3IssuedDraftPolicyBinding(value: unknown): H3IssuedDraftPolicyBinding | undefined {
  if (!object(value) || value.version !== 1 || !isIdentityPolicySha256(value.sha256) || value.id !== `h3-policy-${value.sha256}`
    || !text(value.familyId)) return undefined;
  const family = getH3PolicyFamily(value.familyId);
  if (!family || value.familySha256 !== family.sha256) return undefined;
  return { version: 1, id: value.id, sha256: value.sha256, familyId: family.id, familySha256: family.sha256 };
}
function normalizeRawReference(value: unknown): H3PolicyRawReference | undefined {
  if (!object(value) || !text(value.assetId) || !text(value.canonicalName) || !text(value.bucket) || !text(value.objectKey, 2048)
    || value.objectKey.split("/").some(part => part === "." || part === "..") || !text(value.version)
    || !["identity", "environment", "composition", "style", "crowd", "prop", "vehicle", "wardrobe"].includes(String(value.role))
    || !isIdentityPolicySha256(value.rawSha256) || (value.etag !== undefined && !text(value.etag))) return undefined;
  return { assetId: value.assetId, canonicalName: value.canonicalName, role: value.role as H3ReferenceSnapshot["role"],
    bucket: value.bucket, objectKey: value.objectKey, version: value.version, rawSha256: value.rawSha256,
    ...(value.etag === undefined ? {} : { etag: value.etag as string }) };
}
function normalizeGallery(value: unknown, reference: H3PolicyRawReference, family: H3PolicyFamily): H3PolicyGallery | undefined {
  if (!object(value) || value.referenceAssetId !== reference.assetId || value.canonicalName !== reference.canonicalName
    || value.rawSha256 !== reference.rawSha256 || !Array.isArray(value.faceRegions) || !count(value.faceRegions.length, 9)) return undefined;
  const regions: H3IdentityFaceRegion[] = [];
  for (const region of value.faceRegions) {
    if (!object(region) || !text(region.name) || !Array.isArray(region.rect) || region.rect.length !== 4
      || !region.rect.every(number => typeof number === "number" && Number.isFinite(number) && number >= 0)
      || region.rect[2] <= 0 || region.rect[3] <= 0 || region.rect[0] + region.rect[2] > 1 || region.rect[1] + region.rect[3] > 1) return undefined;
    regions.push({ name: region.name, rect: [...region.rect] as H3IdentityFaceRegion["rect"] });
  }
  if (new Set(regions.map(region => region.name)).size !== regions.length) return undefined;
  const validation = value.referenceValidation;
  if (!object(validation) || validation.method !== family.referencePreparation.method || !count(validation.detectedFaceCount, 32)
    || !count(validation.frontalAnchorCount, validation.detectedFaceCount as number) || validation.selectedRegionCount !== regions.length
    || validation.frontalAnchorCount !== regions.length || !isIdentityPolicySha256(validation.evidenceSha256)
    || (regions.length > 1 && (typeof validation.minimumPairwiseCosine !== "number" || !Number.isFinite(validation.minimumPairwiseCosine)
      || validation.minimumPairwiseCosine < family.referencePreparation.minimumPairwiseCosine || validation.minimumPairwiseCosine > 1))
    || (validation.minimumPairwiseCosine !== undefined && (typeof validation.minimumPairwiseCosine !== "number"
      || !Number.isFinite(validation.minimumPairwiseCosine) || validation.minimumPairwiseCosine < .8 || validation.minimumPairwiseCosine > 1))) return undefined;
  return { referenceAssetId: reference.assetId, canonicalName: reference.canonicalName, rawSha256: reference.rawSha256, faceRegions: regions,
    referenceValidation: { method: family.referencePreparation.method, detectedFaceCount: validation.detectedFaceCount as number,
      frontalAnchorCount: validation.frontalAnchorCount as number, selectedRegionCount: regions.length, evidenceSha256: validation.evidenceSha256,
      ...(validation.minimumPairwiseCosine === undefined ? {} : { minimumPairwiseCosine: validation.minimumPairwiseCosine as number }) } };
}

/** Structural and digest validation only; canonical server storage supplies authority. */
export function normalizeH3PublicIssuedDraftPolicy(value: unknown): H3PublicIssuedDraftPolicy | undefined {
  const binding = normalizeH3IssuedDraftPolicyBinding(value);
  if (!binding || !object(value) || !object(value.body)) return undefined;
  const raw = value.body, family = getH3PolicyFamily(binding.familyId)!;
  const firstFrame=raw.firstFrame===undefined?undefined:normalizeH3FirstFrameBinding(raw.firstFrame);
  if ((raw.generationModel===H3_FIRST_FRAME_PROFILE && (!firstFrame || !["sface-yunet-joint-frontal-v2","sface-yunet-foreground-frontal-v2"].includes(family.id))) || (raw.generationModel!==H3_FIRST_FRAME_PROFILE && raw.firstFrame!==undefined)) return undefined;
  if (raw.version !== 1 || !segment(raw.ownerId) || !segment(raw.projectId) || !["h3-ref2va-int8-v3",H3_FIRST_FRAME_PROFILE].includes(String(raw.generationModel))
    || raw.familyId !== family.id || raw.familySha256 !== family.sha256 || !Array.isArray(raw.references) || !count(raw.references.length, 9)
    || !Array.isArray(raw.identityReferenceHashes) || !Array.isArray(raw.galleries) || !isIdentityPolicySha256(raw.galleryProfileSha256)
    || raw.preprocessVersion !== `${family.model.preprocessBaseVersion}-gallery-v2-${raw.galleryProfileSha256}`) return undefined;
  const references = raw.references.map(normalizeRawReference);
  if (references.some(ref => !ref)) return undefined;
  const refs = references as H3PolicyRawReference[], identities = refs.filter(ref => ref.role === "identity");
  const identityHashes = raw.identityReferenceHashes;
  if (new Set(refs.map(ref => ref.assetId)).size !== refs.length || new Set(refs.map(ref => ref.rawSha256)).size !== refs.length
    || identities.length !== family.scope.requiredIdentityCount || raw.identityReferenceHashes.length !== identities.length
    || !identities.every((ref, index) => identityHashes[index] === ref.rawSha256) || raw.galleries.length !== identities.length) return undefined;
  const galleries = raw.galleries.map((gallery, index) => normalizeGallery(gallery, identities[index], family));
  if (galleries.some(gallery => !gallery)) return undefined;
  if (issuedGalleryProfileSha256(galleries as H3PolicyGallery[]) !== raw.galleryProfileSha256) return undefined;
  const body: H3IssuedDraftPolicyBody = { version: 1, ownerId: raw.ownerId, projectId: raw.projectId, generationModel: raw.generationModel as H3IssuedDraftPolicyBody["generationModel"],
    familyId: family.id, familySha256: family.sha256, references: refs, identityReferenceHashes: identities.map(ref => ref.rawSha256),
    galleries: galleries as H3PolicyGallery[], galleryProfileSha256: raw.galleryProfileSha256, preprocessVersion: raw.preprocessVersion as string,
    ...(firstFrame?{firstFrame}:{}) };
  if (identityPolicySha256(body) !== binding.sha256) return undefined;
  return { ...binding, body };
}
export function normalizeH3IssuedDraftPolicy(value: unknown): H3IssuedDraftPolicy | undefined {
  const policy = normalizeH3PublicIssuedDraftPolicy(value);
  if (!policy || !object(value) || !text(value.issuedAt) || !Number.isFinite(Date.parse(value.issuedAt))) return undefined;
  return { ...policy, issuedAt: value.issuedAt };
}

export function identityApprovalPayload(asset: Pick<GeneratedStudioAsset, "id" | "jobId" | "model" | "mediaSha256" | "target" | "trimStart" | "identityVerification" | "identityAssessmentId" | "identityAssessmentTrimStart" | "firstFrame">) {
  return { id: asset.id, jobId: asset.jobId, model: asset.model, mediaSha256: asset.mediaSha256,
    target: asset.target, trimStart: asset.trimStart ?? 0, identityVerification: asset.identityVerification,
    ...(asset.firstFrame?{firstFrame:asset.firstFrame}:{}),
    ...(asset.identityAssessmentId ? { identityAssessmentId: asset.identityAssessmentId, identityAssessmentTrimStart: asset.identityAssessmentTrimStart } : {}) };
}
export const currentIdentityEvidenceSha256 = (asset: Parameters<typeof identityApprovalPayload>[0]) => identityPolicySha256(identityApprovalPayload(asset));
/** Called only by explicit whole-draft acceptance, never by generation or selection. */
export async function approvedIdentityEvidenceSha256(asset: Parameters<typeof identityApprovalPayload>[0]): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalIdentityPolicyJson(identityApprovalPayload(asset))))));
}


