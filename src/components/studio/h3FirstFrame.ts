import { sha256 } from "@noble/hashes/sha2.js";
import type { H3ReferenceSnapshot } from "./h3Generation";

export const H3_FIRST_FRAME_PROFILE = "h3-i2va-fl2va-int8-v1" as const;
export const H3_FIRST_FRAME_PREPARATION = "first-frame-native-v1" as const;
export type H3FirstFrameChoice = { kind: "first-frame"; artifactId: string; expectedSha256: string };
export type H3FirstFrameBinding = { artifactId: string; descriptorSha256: string; pngSha256: string; preparationVersion: typeof H3_FIRST_FRAME_PREPARATION };
export type H3FirstFrameBody = {
  version: 1; ownerId: string; projectId: string; planSignature: string;
  target: { timelineItemId: string; requirementId?: string; sectionId: string; songStart: number; songEnd: number };
  references: H3ReferenceSnapshot[];
  pngSha256: string; byteCount: number; width: 1344; height: 768; preparationVersion: typeof H3_FIRST_FRAME_PREPARATION;
};
export type H3FirstFrameArtifact = { version: 1; id: string; sha256: string; body: H3FirstFrameBody };
/** One still, with no invented temporal coverage or identity certificate. */
export type H3FirstFrameAssessment = {
  version: 1; kind: "single-image"; status: "eligible" | "ineligible" | "unverifiable";
  artifactId: string; descriptorSha256: string; pngSha256: string; decodedPixelSha256: string;
  policyId: string; policySha256: string; galleryProfileSha256: string;
  modelSha256: string; verifierVersion: "sface-yunet-cpu-v1"; threshold: 0.8;
  familyId: "sface-yunet-foreground-frontal-v2" | "sface-yunet-joint-frontal-v2";
  spatialEvidence: { status: string; detectedFaceCount: number; reasons: string[];
    assignments: { referenceHash: string; detectionIndex: number; score: number; minimumAssignmentMargin: number; reasons: string[] }[];
    candidateScores: { referenceHash: string; detectionIndex: number; score: number }[] };
  warnings: string[];
};
export type H3FirstFrameReceipt = { artifact: H3FirstFrameArtifact; assessment: H3FirstFrameAssessment };
export const isH3FirstFrameId = (value: unknown): value is string => typeof value === "string" && /^h3-frame-[a-f0-9]{64}$/.test(value);
export const firstFrameHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => [k,canonical(v)]));
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error("First-frame metadata must be finite JSON.");
}
export const h3FirstFrameDigest = (value: unknown) => Array.from(sha256(new TextEncoder().encode(JSON.stringify(canonical(value)))), byte => byte.toString(16).padStart(2,"0")).join("");
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 2048 && !/[\x00-\x1f]/.test(v);
const segment = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
export function normalizeH3FirstFrameBinding(v: unknown): H3FirstFrameBinding | undefined {
  if (!object(v) || !isH3FirstFrameId(v.artifactId) || !firstFrameHash(v.descriptorSha256) || v.artifactId !== `h3-frame-${v.descriptorSha256}`
    || !firstFrameHash(v.pngSha256) || v.preparationVersion !== H3_FIRST_FRAME_PREPARATION) return undefined;
  return { artifactId: v.artifactId, descriptorSha256: v.descriptorSha256, pngSha256: v.pngSha256, preparationVersion: H3_FIRST_FRAME_PREPARATION };
}
export function normalizeH3FirstFrameArtifact(v: unknown): H3FirstFrameArtifact | undefined {
  if (!object(v) || v.version !== 1 || !isH3FirstFrameId(v.id) || !firstFrameHash(v.sha256) || v.id !== `h3-frame-${v.sha256}` || !object(v.body)) return undefined;
  const b = v.body, t = b.target;
  if (b.version !== 1 || !segment(b.ownerId) || !segment(b.projectId) || !text(b.planSignature) || !firstFrameHash(b.pngSha256)
    || !Number.isSafeInteger(b.byteCount) || (b.byteCount as number) < 1 || (b.byteCount as number) > 32*1024*1024
    || b.width !== 1344 || b.height !== 768 || b.preparationVersion !== H3_FIRST_FRAME_PREPARATION
    || !object(t) || !text(t.timelineItemId) || !text(t.sectionId) || t.requirementId !== undefined && !text(t.requirementId)
    || typeof t.songStart !== "number" || !Number.isFinite(t.songStart) || t.songStart < 0 || typeof t.songEnd !== "number" || !Number.isFinite(t.songEnd) || t.songEnd <= t.songStart || t.songEnd-t.songStart > 12.001
    || !Array.isArray(b.references) || b.references.length < 1 || b.references.length > 9) return undefined;
  const references: H3ReferenceSnapshot[] = [];
  for (const ref of b.references) {
    if (!object(ref) || ![ref.assetId,ref.canonicalName,ref.bucket,ref.objectKey,ref.version,ref.etag].every(text)
      || !["identity","environment","composition","style","crowd","prop","vehicle","wardrobe"].includes(String(ref.role))
      || (ref.objectKey as string).includes("\\") || (ref.objectKey as string).split("/").some(p => !p || p === "." || p === "..")) return undefined;
    references.push({ assetId: ref.assetId as string, canonicalName: ref.canonicalName as string, role: ref.role as H3ReferenceSnapshot["role"],
      bucket: ref.bucket as string, objectKey: ref.objectKey as string, version: ref.version as string, etag: ref.etag as string });
  }
  if (new Set(references.map(r => r.assetId)).size !== references.length) return undefined;
  const body: H3FirstFrameBody = { version: 1, ownerId: b.ownerId, projectId: b.projectId, planSignature: b.planSignature,
    target: { timelineItemId:t.timelineItemId, ...(t.requirementId ? {requirementId:t.requirementId as string}:{}), sectionId:t.sectionId,songStart:t.songStart,songEnd:t.songEnd },
    references, pngSha256:b.pngSha256,byteCount:b.byteCount as number,width:1344,height:768,preparationVersion:H3_FIRST_FRAME_PREPARATION };
  if (h3FirstFrameDigest(body) !== v.sha256) return undefined;
  return { version:1,id:v.id,sha256:v.sha256,body };
}
export function h3FirstFrameBinding(a: H3FirstFrameArtifact): H3FirstFrameBinding {
  return { artifactId:a.id,descriptorSha256:a.sha256,pngSha256:a.body.pngSha256,preparationVersion:a.body.preparationVersion };
}
export function normalizeH3FirstFrameAssessment(v: unknown): H3FirstFrameAssessment | undefined {
  if (!object(v) || v.version !== 1 || v.kind !== "single-image" || !["eligible","ineligible","unverifiable"].includes(String(v.status))
    || !normalizeH3FirstFrameBinding({...v,preparationVersion:H3_FIRST_FRAME_PREPARATION})
    || ![v.decodedPixelSha256,v.policySha256,v.galleryProfileSha256,v.modelSha256].every(firstFrameHash)
    || v.policyId !== `h3-policy-${v.policySha256}` || v.verifierVersion !== "sface-yunet-cpu-v1" || v.threshold !== .8
    || !["sface-yunet-foreground-frontal-v2","sface-yunet-joint-frontal-v2"].includes(String(v.familyId))
    || !object(v.spatialEvidence) || !Array.isArray(v.warnings) || v.warnings.length > 32 || !v.warnings.every(text)) return undefined;
  const s=v.spatialEvidence;
  if (!Number.isSafeInteger(s.detectedFaceCount) || (s.detectedFaceCount as number)<0 || (s.detectedFaceCount as number)>32
    || !Array.isArray(s.reasons) || s.reasons.length>32 || !s.reasons.every(text)
    || !Array.isArray(s.assignments) || s.assignments.length>2 || !Array.isArray(s.candidateScores) || s.candidateScores.length>32
    || ![...s.assignments,...s.candidateScores].every(x => object(x) && firstFrameHash(x.referenceHash) && typeof x.detectionIndex==="number" && Number.isSafeInteger(x.detectionIndex) && x.detectionIndex>=0 && x.detectionIndex<32 && typeof x.score==="number" && Number.isFinite(x.score) && x.score>=-1 && x.score<=1)
    || !s.assignments.every(x => Number.isFinite(x.minimumAssignmentMargin) && Array.isArray(x.reasons) && x.reasons.length<=32 && x.reasons.every(text))) return undefined;
  const identities=v.familyId==="sface-yunet-joint-frontal-v2"?2:1,margin=identities===2?.08:.15;
  if (v.status === "eligible" && (s.status!=="eligible" || (identities===2?s.detectedFaceCount!==2:(s.detectedFaceCount as number)<1) || s.reasons.length || s.assignments.length!==identities || s.candidateScores.length!==(s.detectedFaceCount as number)*identities
    || new Set(s.assignments.map(x=>x.referenceHash)).size!==identities || new Set(s.assignments.map(x=>x.detectionIndex)).size!==identities
    || s.assignments.some(x=>x.score<.8 || x.minimumAssignmentMargin<margin || x.reasons.length))) return undefined;
  if(v.status==="eligible")for(const assigned of s.assignments){
    const own=s.candidateScores.filter(c=>c.referenceHash===assigned.referenceHash&&c.detectionIndex===assigned.detectionIndex);
    const alternatives=s.candidateScores.filter(c=>(c.referenceHash===assigned.referenceHash)!==(c.detectionIndex===assigned.detectionIndex));
    if(own.length!==1||own[0].score!==assigned.score||alternatives.some(c=>assigned.score-c.score<margin)
      ||new Set(s.candidateScores.map(c=>`${c.referenceHash}:${c.detectionIndex}`)).size!==s.candidateScores.length)return undefined;
  }
  // Canonical storage and Python supply authority. Copy bounded JSON so untrusted extras never enter approval hashes.
  return {version:1,kind:"single-image",status:v.status as H3FirstFrameAssessment["status"],artifactId:v.artifactId as string,descriptorSha256:v.descriptorSha256 as string,pngSha256:v.pngSha256 as string,
    decodedPixelSha256:v.decodedPixelSha256 as string,policyId:v.policyId as string,policySha256:v.policySha256 as string,galleryProfileSha256:v.galleryProfileSha256 as string,modelSha256:v.modelSha256 as string,
    verifierVersion:"sface-yunet-cpu-v1",familyId:v.familyId as H3FirstFrameAssessment["familyId"],threshold:.8,spatialEvidence:{status:String(s.status),detectedFaceCount:s.detectedFaceCount as number,reasons:[...s.reasons],
      assignments:s.assignments.map(x=>({referenceHash:x.referenceHash,detectionIndex:x.detectionIndex,score:x.score,minimumAssignmentMargin:x.minimumAssignmentMargin,reasons:[...x.reasons]})),
      candidateScores:s.candidateScores.map(x=>({referenceHash:x.referenceHash,detectionIndex:x.detectionIndex,score:x.score}))},warnings:[...v.warnings] as string[]};
}
export function normalizeH3FirstFrameReceipt(v: unknown): H3FirstFrameReceipt | undefined {
  if(!object(v))return undefined; const artifact=normalizeH3FirstFrameArtifact(v.artifact),assessment=normalizeH3FirstFrameAssessment(v.assessment);
  if(!artifact||!assessment||assessment.artifactId!==artifact.id||assessment.descriptorSha256!==artifact.sha256||assessment.pngSha256!==artifact.body.pngSha256)return undefined;
  return {artifact,assessment};
}
