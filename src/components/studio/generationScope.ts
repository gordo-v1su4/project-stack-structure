import { sha256 } from "@noble/hashes/sha2.js";
import { canonicalIdentityPolicyJson } from "./issuedIdentityPolicy";
import { placementInputSignature, type ApprovedPlacement, type MusicVideoProject } from "./musicVideoProject";
import type { ReferenceAsset } from "./referenceAssets";

export const generationScopeSha256 = (value: unknown): string => Array.from(sha256(new TextEncoder().encode(canonicalIdentityPolicyJson(value))), byte => byte.toString(16).padStart(2, "0")).join("");
export type SourceReferenceManifest = ReturnType<typeof sourceReferenceManifest>;
export function sourceReferenceManifest(references: ReferenceAsset[]) {
  return [...references].sort((a, b) => a.id.localeCompare(b.id)).map(reference => ({ id: reference.id, role: reference.role, kind: reference.kind,
    displayName: reference.displayName, fileName: reference.fileName, promptHint: reference.promptHint, createdAt: reference.createdAt,
    storageBucket: reference.storageBucket, storagePath: reference.storagePath, storageUrl: reference.storageUrl, storageStatus: reference.storageStatus }));
}

/** Runtime URLs and review state are excluded; all editorial and media identity inputs remain bound. */
export function generationSemanticSha256(project: MusicVideoProject): string {
  const song = project.song;
  return generationScopeSha256({ id: project.id, duration: project.duration, lyricChunks: project.lyricChunks,
    generationStorySha256: project.generationStorySha256,
    song: song && { sourceLabel: song.sourceLabel, duration: song.duration, storageBucket: song.storageBucket, storagePath: song.storagePath,
      storageUrl: song.storagePath ? undefined : song.storageUrl, sections: song.sections, beats: song.beats, onsets: song.onsets, energy: song.energy },
    sections: project.storySections, items: project.editPlan.timelineItems, storyMusicPlacements: project.storyMusicPlacements,
    moments: project.videoMoments.map(({ id, sourceClipId, start, end, caption, captionMeta, mediaEvidence, contentHash, visualAnalysis }) =>
      ({ id, sourceClipId, start, end, caption, captionMeta, mediaEvidence, contentHash, visualAnalysis })),
    policy: project.placementPlan?.policy, settings: project.placementPlan?.settings, placements: project.placementPlan?.placements });
}

export type ExistingSourceReprise = { version: 1; status: "pending-review"; placementIds: [string, string]; sourceClipId: 6;
  mediaContentSha256: string; placementsSha256: string; overlapSeconds: 2.026 };
export type ScopeRawReference = { assetId: string; bucket: string; objectKey: string; etag: string; sha256: string; byteLength: number };
export type ScopeSourceMediaVersion = { id: string; bucket: string; objectKey: string; etag: string; byteLength: number; sha256?: string };
export type ReferenceVersionMigration = { version: 1; authority: "r31-approved-diego-e71-v1"; contextSha256: string; baselineSha256:string; adoptionSha256:string;
  replacements: { assetId: string; fromSha256: string; toSha256: string }[];
  historicalReferences: { assetId: string; bucket: string; objectKey: string; etag: string; sha256: string }[];
  historicalBackups?: ScopeRawReference[];
  requeuedApprovedAssetIds?:string[];
  origins: { jobId: string; originalJobSha256: string; originalTargetSha256: string; originalProofSha256: string }[] };
export type GenerationScopeReceiptBody = { version: 1; kind: "baseline" | "additive-reference" | "reference-version-migration"; ownerId: string; projectId: string; baselineRevision: string;
  reuseOrigins?: import("./reusedTakePlacements").ReuseOrigin[];
  fromSourceContext: string; toSourceContext: string; fromInputSignature: string; toInputSignature: string; scopeSignature: string;
  semanticSha256: string; references: SourceReferenceManifest; rawReferences: ScopeRawReference[]; sourceMediaVersions: ScopeSourceMediaVersion[];
  appendedReferenceIds: string[]; previousReceiptSha256?: string;
  storySha256: string; sourceInventorySha256: string; reprise?: ExistingSourceReprise;
  referenceMigration?: ReferenceVersionMigration; currentIdentityMigrationSha256?: string };
export type GenerationScopeReceipt = { version: 1; id: string; sha256: string; body: GenerationScopeReceiptBody };

export function normalizeGenerationScopeReceipt(value: unknown): GenerationScopeReceipt | undefined {
  if (!value || typeof value !== "object") return undefined;
  const receipt = value as GenerationScopeReceipt, body = receipt.body;
  let bodySha256: string;
  try { bodySha256 = generationScopeSha256(body); } catch { return undefined; }
  if (receipt.version !== 1 || !body || body.version !== 1 || !/^[a-f0-9]{64}$/.test(receipt.sha256)
    || receipt.id !== `generation-scope-${receipt.sha256}` || bodySha256 !== receipt.sha256
    || !body.ownerId || !body.projectId || !body.baselineRevision || !/^(?:placements-v1-[a-f0-9]+|generation-v2-[a-f0-9]{64})$/.test(body.scopeSignature)
    || !/^placements-v1-[a-f0-9]+$/.test(body.toInputSignature) || !Array.isArray(body.references)
    || !Array.isArray(body.rawReferences) || body.rawReferences.length !== body.references.length
    || new Set(body.rawReferences.map(reference => reference?.assetId)).size !== body.references.length
    || body.rawReferences.some(reference => !body.references.some(asset => asset.id === reference.assetId && asset.storageBucket === reference.bucket && asset.storagePath === reference.objectKey))
    || body.rawReferences.some(reference => !reference || !reference.assetId || !reference.bucket || !reference.objectKey || !reference.etag
      || !/^[a-f0-9]{64}$/.test(reference.sha256) || !Number.isSafeInteger(reference.byteLength) || reference.byteLength < 1 || reference.byteLength > 32 * 1024 * 1024)
    || !Array.isArray(body.sourceMediaVersions) || body.sourceMediaVersions.some(media => !media || !media.id || !media.bucket || !media.objectKey || !media.etag
      || !Number.isSafeInteger(media.byteLength) || media.byteLength < 1 || media.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(media.sha256))
    || !["baseline", "additive-reference", "reference-version-migration"].includes(body.kind) || !Array.isArray(body.appendedReferenceIds)
    || (body.kind === "additive-reference" ? !body.appendedReferenceIds.length : body.kind === "baseline" && (body.appendedReferenceIds.length !== 0
      || body.fromSourceContext !== body.toSourceContext || body.fromInputSignature !== body.toInputSignature))
    || (body.kind === "reference-version-migration" && (!body.referenceMigration || body.referenceMigration.version !== 1
      || body.referenceMigration.authority !== "r31-approved-diego-e71-v1" || !/^[a-f0-9]{64}$/.test(body.referenceMigration.contextSha256)
      || ![body.referenceMigration.baselineSha256,body.referenceMigration.adoptionSha256].every(hash=>/^[a-f0-9]{64}$/.test(hash))
      || !Array.isArray(body.referenceMigration.replacements) || body.referenceMigration.replacements.length !== 1
      || body.referenceMigration.replacements.some(reference=>!reference?.assetId||![reference.fromSha256,reference.toSha256].every(hash=>/^[a-f0-9]{64}$/.test(hash))||reference.fromSha256===reference.toSha256)
      || !Array.isArray(body.referenceMigration.historicalReferences)||body.referenceMigration.historicalReferences.length>32
      || !Array.isArray(body.referenceMigration.origins) || !body.referenceMigration.origins.length || body.referenceMigration.origins.length > 128
      || new Set(body.referenceMigration.origins.map(origin=>origin.jobId)).size!==body.referenceMigration.origins.length
      || body.referenceMigration.origins.some(origin=>!/^h3-[a-f0-9]{64}$/.test(origin.jobId)||![origin.originalJobSha256,origin.originalProofSha256,origin.originalTargetSha256].every(hash=>/^[a-f0-9]{64}$/.test(hash)))))
    || (body.reuseOrigins !== undefined && (!Array.isArray(body.reuseOrigins) || body.reuseOrigins.length > 128
      || new Set(body.reuseOrigins.map(origin => origin?.assetId)).size !== body.reuseOrigins.length
      || body.reuseOrigins.some(origin => !origin || !origin.assetId || !/^h3-[a-f0-9]{64}$/.test(origin.jobId)
        || !/^(?:placements-v1-[a-f0-9]+|generation-v2-[a-f0-9]{64})$/.test(origin.scopeSignature) || !/^[a-f0-9]{64}$/.test(origin.assetSha256))))
    || ![body.semanticSha256, body.storySha256, body.sourceInventorySha256].every(hash => /^[a-f0-9]{64}$/.test(hash))) return undefined;
  return receipt;
}

/** Local integrity is useful for preview; server boundaries additionally retrieve the immutable receipt. */
export function effectiveGenerationScope(project: MusicVideoProject): string | undefined {
  if (!project.placementPlan || project.placementPlan.inputSignature !== placementInputSignature(project, project.placementPlan.settings)) return undefined;
  if (!project.generationScope) return project.generationScopeVersion === 2
    ? [project.generationSourceContextSha256, project.generationStorySha256].every(hash => /^[a-f0-9]{64}$/.test(hash ?? ""))
      ? `generation-v2-${generationScopeSha256({ semanticSha256: generationSemanticSha256(project), sourceInventorySha256: project.generationSourceContextSha256 })}` : undefined
    : project.placementPlan.inputSignature;
  const receipt = normalizeGenerationScopeReceipt(project.generationScope);
  return receipt && receipt.body.toInputSignature === project.placementPlan.inputSignature
    && receipt.body.toSourceContext === project.sourceContextSignature && receipt.body.semanticSha256 === generationSemanticSha256(project)
    ? receipt.body.scopeSignature : undefined;
}

/** Only the previously reviewed, exact opening-landscape reprise is eligible for explicit re-review. */
export function exactExistingSourceReprise(projectId: string, project: MusicVideoProject): ExistingSourceReprise | undefined {
  if (projectId !== "75101b25-fea6-42b1-b2c6-85a9d1deb8eb" || project.placementPlan?.policy !== "faithful") return undefined;
  const ids: [string, string] = ["story-item:intro-2:shot-1:0.210:cut:0.210", "v2-h3-237.2-246.69995464852607:bound:0:reviewed-landscape-reprise:241.824"];
  const placements = ids.map(id => project.placementPlan!.placements.find(placement => placement.id === id));
  const expected = [[.21, 3.065, .21, 3.065], [241.824, 243.85, 1, 3.026]];
  if (placements.some((placement, index) => !placement || placement.kind !== "source"
    || generationScopeSha256([placement.songStart, placement.songEnd, placement.sourceStart, placement.sourceEnd]) !== generationScopeSha256(expected[index]))) return undefined;
  const moments = placements.map(placement => project.videoMoments.find(moment => moment.id === placement!.momentId));
  const hash = "750a8bdc0be798649befd346f1d60a65778544b23aab3b1d173c3274cbb436a5";
  if (moments.some(moment => moment?.sourceClipId !== 6 || (moment.contentHash || moment.visualAnalysis?.contentHash) !== hash)) return undefined;
  if (generationScopeSha256(project.placementPlan.placements) !== "e7cf0c16681c7e9f1a31cba9ed06ad28f57142b433f7a3e5391f3c6f62897294") return undefined;
  return { version: 1, status: "pending-review", placementIds: ids, sourceClipId: 6, mediaContentSha256: hash,
    placementsSha256: generationScopeSha256(project.placementPlan.placements), overlapSeconds: 2.026 };
}

export function repriseCoversOverlap(reprise: ExistingSourceReprise | undefined, left: ApprovedPlacement, right: ApprovedPlacement): boolean {
  return Boolean(reprise && new Set([left.id, right.id]).size === 2 && reprise.placementIds.includes(left.id) && reprise.placementIds.includes(right.id));
}
