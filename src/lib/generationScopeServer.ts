import type { SavedStudioProject } from "./studioProjectStore";
import type { PersistedStudioProjectDraft } from "@/components/studio/projectPersistence";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import type { ReferenceAsset } from "@/components/studio/referenceAssets";
import { effectiveGenerationScope, exactExistingSourceReprise, generationScopeSha256, generationSemanticSha256,
  normalizeGenerationScopeReceipt, sourceReferenceManifest, type GenerationScopeReceipt, type ScopeRawReference, type ScopeSourceMediaVersion } from "@/components/studio/generationScope";
import { placementInputSignature } from "@/components/studio/musicVideoProject";
import { buildStudioSourceContextSignature, studioSourceContextInput } from "@/components/studio/studioSourceContext";
import { buildStoryContentSignature } from "@/components/studio/storyTreatments";
import { preserveReviewedStoryArrangement } from "@/components/studio/reconfirmStoryProject";
import { createGeneratedDraftSelection } from "@/components/studio/generatedDraft";
import { mediaUploadBelongsToOwner } from "./essentiaUpload";
import { readGenerationScopeBaseline, storeGenerationScopeBaseline, readGenerationScopeReceipt, storeGenerationScopeReceipt } from "./generationScopeStore";
import { pinGenerationScopeRawReferences, verifyGenerationScopeRawReferences, type ExpectedScopeRawReference } from "./generationScopeRawReferences";
import { bootstrapR31SourceMedia, pinGenerationScopeMedia, verifyGenerationScopeMedia } from "./generationScopeMedia";
import { assertCurrentReusedTakePlacements } from "@/components/studio/reusedTakePlacements";

export class SourceConfirmationError extends Error { constructor(message: string, readonly status = 409) { super(message); } }
function contextInput(draft: PersistedStudioProjectDraft, references = draft.referenceAssets ?? []) {
  return { analysis: draft.analysis ? { ...draft.analysis, audioUrl: draft.analysis.storageUrl ?? "" } : null,
    videoSources: draft.videoSources.map(source => ({ ...source, videoUrl: source.storageUrl ?? "" })), referenceAssets: references };
}
export const sourceSha = (draft: PersistedStudioProjectDraft) => generationScopeSha256(studioSourceContextInput(contextInput(draft)));
export const storySha = (draft: PersistedStudioProjectDraft) => generationScopeSha256({ storyBeats: draft.storyState.storyBeats,
  confirmedTreatmentSnapshot: draft.storyState.confirmedTreatmentSnapshot, storyContentSignature: draft.storyState.storyContentSignature,
  editSettings: draft.storyState.editSettings });
const authorized = new WeakMap<SavedStudioProject, string>();

/** Every server boundary retrieves the owner-scoped canonical record; an inline browser receipt never authorizes work. */
export async function validateSavedGenerationScope(ownerId: string, saved: SavedStudioProject, options: { allowUnissuedBaseline?: boolean } = {}): Promise<string | undefined> {
  const project = saved.draft.musicVideoProject;
  if (!project) return undefined;
  if (!project.generationScope && project.reuseSourceBaselines?.some(origin => saved.draft.generatedAssets?.some(asset =>
    asset.provider === "swarmui" && asset.status === "completed" && asset.jobId && asset.target?.planSignature === origin.scopeSignature))) {
    throw new SourceConfirmationError("Confirm the revised story's existing footage before planning or generating its missing shots.");
  }
  try { assertCurrentReusedTakePlacements(project, saved.draft.generatedDraft?.reusedTakePlacements); }
  catch { throw new SourceConfirmationError("A reused placement is stale or outside its canonical story/source scope."); }
  if(project.currentIdentity&&!project.generationScope)throw new SourceConfirmationError("The current-reference migration receipt is unavailable.");
  const scope = effectiveGenerationScope(project);
  if (!project.generationScope) {
    if (project.generationScopeVersion === 2 && (project.generationSourceContextSha256 !== sourceSha(saved.draft) || project.generationStorySha256 !== storySha(saved.draft))) throw new SourceConfirmationError("The strong source inventory or story changed after Story confirmation.");
    if (project.generationScopeVersion === 2) {
      const baseline = scope && await readGenerationScopeBaseline(ownerId, saved.project.id, scope, generationSemanticSha256(project));
      if (!baseline && !options.allowUnissuedBaseline) throw new SourceConfirmationError("The canonical generation baseline is unavailable.");
      if (baseline) {
        if (baseline.body.storySha256 !== storySha(saved.draft) || baseline.body.sourceInventorySha256 !== sourceSha(saved.draft)
          || generationScopeSha256(baseline.body.references) !== generationScopeSha256(sourceReferenceManifest(saved.draft.referenceAssets ?? []))) throw new SourceConfirmationError("The canonical generation baseline differs from the current story or sources.");
        try { await verifyGenerationScopeRawReferences(ownerId, baseline.body.references, baseline.body.rawReferences); await verifyGenerationScopeMedia(ownerId, saved.draft, baseline.body.sourceMediaVersions); }
        catch { throw new SourceConfirmationError("The current reference or source media versions differ from their canonical baseline."); }
      }
    }
    return scope;
  }
  const receipt = normalizeGenerationScopeReceipt(project.generationScope);
  if (!receipt || !scope || saved.project.ownerId !== ownerId || receipt.body.ownerId !== ownerId || receipt.body.projectId !== saved.project.id
    || receipt.body.sourceInventorySha256 !== sourceSha(saved.draft) || receipt.body.storySha256 !== storySha(saved.draft)
    || generationScopeSha256(receipt.body.references) !== generationScopeSha256(sourceReferenceManifest(saved.draft.referenceAssets ?? []))) {
    throw new SourceConfirmationError("The source confirmation no longer matches this project. Confirm the current story again.");
  }
  const canonical = await readGenerationScopeReceipt(ownerId, saved.project.id, receipt.id);
  if (!canonical || generationScopeSha256(canonical) !== generationScopeSha256(receipt)) throw new SourceConfirmationError("The canonical source confirmation is unavailable or changed.");
  if(receipt.body.referenceMigration||receipt.body.currentIdentityMigrationSha256||project.currentIdentity){
    const context=project.currentIdentity;
    if(!context||context.migrationSha256!==(receipt.body.referenceMigration?receipt.sha256:receipt.body.currentIdentityMigrationSha256))throw new SourceConfirmationError("The current-reference context or migration chain differs.");
    const migration=receipt.body.referenceMigration?canonical:await readGenerationScopeReceipt(ownerId,saved.project.id,`generation-scope-${context.migrationSha256}`);
    if(!migration?.body.referenceMigration||migration.body.referenceMigration.contextSha256!==context.contextSha256
      ||generationScopeSha256(migration.body.referenceMigration.replacements)!==generationScopeSha256(context.replacements))throw new SourceConfirmationError("The canonical current-reference context differs.");
  }
  try { await verifyGenerationScopeRawReferences(ownerId, receipt.body.references, receipt.body.rawReferences); await verifyGenerationScopeMedia(ownerId, saved.draft, receipt.body.sourceMediaVersions); }
  catch { throw new SourceConfirmationError("The current reference pixels or source media versions differ from their canonical source confirmation."); }
  authorized.set(saved, receipt.sha256);
  return scope;
}

export function assertMaterializationGenerationScope(saved: SavedStudioProject): string | undefined {
  const project = saved.draft.musicVideoProject;
  if (project?.generationScope && authorized.get(saved) !== project.generationScope.sha256) throw new SourceConfirmationError("Validate the canonical source confirmation before generation.");
  if (project?.generationScopeVersion === 2 && !project.generationScope && (project.generationSourceContextSha256 !== sourceSha(saved.draft) || project.generationStorySha256 !== storySha(saved.draft))) throw new SourceConfirmationError("The strong source inventory or story changed after Story confirmation.");
  return project ? effectiveGenerationScope(project) : undefined;
}

/** A short legacy hash cannot prove historical ranges. Only a strong issued baseline or the exact reviewed migration certificate can. */
export async function originalReferences(ownerId: string, projectId: string, draft: PersistedStudioProjectDraft, jobs: H3GenerationJob[], scope: string,
  approvedReplacement?: { assetId: string; fromSha256: string; toSha256: string }): Promise<{ references: ReferenceAsset[]; rawReferences: ScopeRawReference[]; sourceMediaVersions: ScopeSourceMediaVersion[]; historicalReferences: ExpectedScopeRawReference[] }> {
  const project = draft.musicVideoProject!, references = draft.referenceAssets ?? [];
  const baseline = await readGenerationScopeBaseline(ownerId, projectId, scope, generationSemanticSha256(project));
  let subset: ReferenceAsset[];
  if (baseline) {
    subset = references.filter(reference => baseline.body.references.some(entry => entry.id === reference.id));
    if (baseline.body.storySha256 !== storySha(draft) || baseline.body.sourceInventorySha256 !== sourceSha({ ...draft, referenceAssets: subset })
      || generationScopeSha256(baseline.body.references) !== generationScopeSha256(sourceReferenceManifest(subset))) throw new SourceConfirmationError("The strongly bound original story or source inventory changed.");
  } else {
    const originalIds = ["character-1-1788717231561-sy1hpa", "character-2-1788717240250-mxnuzg", "environment-1788717248072-guwisn"];
    subset = references.filter(reference => originalIds.includes(reference.id));
    if (ownerId !== "github-179914528" || projectId !== "75101b25-fea6-42b1-b2c6-85a9d1deb8eb"
      || generationSemanticSha256(project) !== "d8dbc41874d603a6b6e4052b7302f72a37cbad3c3fe7e1a802e9c7082f070f3e"
      || generationScopeSha256(sourceReferenceManifest(subset)) !== "0c0ed4b80709bb793dfbec41bdcbe91bfc9410c87e0ce4d96ad10ac693a76c93"
      || sourceSha({ ...draft, referenceAssets: subset }) !== "8a5c066a8b28e817222635b234c62ded94bb61473d9e195989d43f33f5a9656b"
      || storySha(draft) !== "bad46363a6b1dd2b66ee7e974e14037b79561ee741e82c7534aa46868144ea59"
      || !exactExistingSourceReprise(projectId, project)) throw new SourceConfirmationError("This legacy arrangement has no strong historical baseline. Its footage bank was preserved; confirm a new Story scope instead.");
  }
  if (buildStudioSourceContextSignature(contextInput(draft, subset)) !== project.sourceContextSignature) throw new SourceConfirmationError("An original source changed after story confirmation.");
  const canonical = jobs.filter(job => job.ownerId && job.projectId && job.target.planSignature === scope);
  if (!canonical.length && !baseline) throw new SourceConfirmationError("Canonical generation evidence is required to retain this legacy scope.");
  for (const reference of subset) {
    const role = reference.kind === "character" || reference.role.startsWith("character") ? "identity"
      : reference.kind === "environment" || reference.role === "environment" ? "environment"
      : reference.kind === "crowd" || reference.role === "crowd" ? "crowd"
      : ["prop", "vehicle", "wardrobe"].includes(reference.kind) ? reference.kind : "composition";
    // Match the exact pinned snapshot algorithm; policies and raw-reference hashes remain unchanged.
    const base = referenceVersionDigest([reference.id, reference.storageBucket, reference.storagePath, reference.createdAt, role, reference.displayName]);
    const snapshots = canonical.flatMap(job => job.references.filter(snapshot => snapshot.assetId === reference.id));
    if ((!snapshots.length && !baseline) || snapshots.some(snapshot => snapshot.canonicalName !== reference.displayName || snapshot.role !== role
      || snapshot.bucket !== reference.storageBucket || snapshot.objectKey !== reference.storagePath || !snapshot.etag
      || snapshot.version !== referenceVersionDigest([base, snapshot.etag]))) throw new SourceConfirmationError("An original generation reference changed. Its completed footage cannot be rebound.");
  }
  if (canonical.some(job => job.references.some(reference => !subset.some(asset => asset.id === reference.assetId)))) throw new SourceConfirmationError("Canonical reference inventories disagree.");
  const expected: ExpectedScopeRawReference[] = baseline ? baseline.body.rawReferences : subset.map(reference => {
    const records = canonical.flatMap(job => job.references.flatMap((snapshot, index) => snapshot.assetId === reference.id && /^[a-f0-9]{64}$/.test(job.referenceHashes?.[index] ?? "")
      ? [{ assetId: reference.id, bucket: snapshot.bucket, objectKey: snapshot.objectKey, etag: snapshot.etag!, sha256: job.referenceHashes![index] }] : []));
    if (!records.length || records.some(record => record.etag !== records[0].etag || record.sha256 !== records[0].sha256)) throw new SourceConfirmationError("Canonical original reference byte proofs disagree or are unavailable.");
    return records[0];
  });
  // Explicit migration only. The ordinary additive path never replaces an expected raw version.
  if(approvedReplacement&&(ownerId!=="github-179914528"||projectId!=="75101b25-fea6-42b1-b2c6-85a9d1deb8eb"
    ||approvedReplacement.assetId!=="character-1-1788717231561-sy1hpa"
    ||approvedReplacement.fromSha256!=="47d772694e0c14397707f31b7802fe91d434da1e4b54be7bac3eb00037364381"
    ||approvedReplacement.toSha256!=="e71f4d4325a61641d98de57604ff09e425aeefd07f994606f189c06f88c47c4a"))throw new SourceConfirmationError("Unsupported reference migration authority.");
  try {
    let rawReferences: ScopeRawReference[];
    if(approvedReplacement){
      const old=expected.find(reference=>reference.assetId===approvedReplacement.assetId);
      if(old?.sha256!==approvedReplacement.fromSha256)throw new Error("Historical reference authority differs.");
      const unchanged=subset.filter(reference=>reference.id!==approvedReplacement.assetId);
      const pinned=await pinGenerationScopeRawReferences(ownerId,sourceReferenceManifest(subset.filter(reference=>reference.id===approvedReplacement.assetId)));
      if(pinned.length!==1||pinned[0].sha256!==approvedReplacement.toSha256)throw new Error("Approved replacement bytes differ.");
      rawReferences=[...await verifyGenerationScopeRawReferences(ownerId,sourceReferenceManifest(unchanged),expected.filter(reference=>reference.assetId!==approvedReplacement.assetId)),...pinned];
    }else rawReferences=await verifyGenerationScopeRawReferences(ownerId,sourceReferenceManifest(subset),expected);
    return { references: subset, rawReferences, historicalReferences: expected,
      sourceMediaVersions: baseline ? await verifyGenerationScopeMedia(ownerId, draft, baseline.body.sourceMediaVersions) : await bootstrapR31SourceMedia(ownerId, projectId, draft) }; }
  catch { throw new SourceConfirmationError("An original reference's exact conditional bytes changed. Its footage bank was preserved."); }
}

// h3GenerationServer uses JSON.stringify rather than canonical key ordering for job reference versions.
import { createHash } from "node:crypto";
const referenceVersionDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function prepareAdditiveSourceConfirmation(params: { ownerId: string; saved: SavedStudioProject; expectedRevision: string;
  jobs: H3GenerationJob[]; bucket: string }): Promise<{ draft: PersistedStudioProjectDraft; receipt: GenerationScopeReceipt; expectedRevision: string }> {
  const { ownerId, saved, expectedRevision, jobs, bucket } = params, draft = saved.draft, previous = draft.musicVideoProject;
  const revision = (saved as SavedStudioProject & { revision?: string }).revision;
  if (!revision || revision !== expectedRevision || saved.project.ownerId !== ownerId) throw new SourceConfirmationError("The saved project changed. Reload before confirming its sources.");
  const story = draft.storyState;
  if (!previous?.placementPlan || !previous.sourceContextSignature || !story.storyGenerated || !story.confirmedTreatmentSnapshot
    || story.confirmedTreatmentId !== story.confirmedTreatmentSnapshot.id || story.confirmedTreatmentSnapshot.reconciliation?.status === "pending"
    || story.storyContentSignature !== buildStoryContentSignature(story.confirmedTreatmentSnapshot, story.storyBeats)
    || story.confirmedSourceContextSignature !== previous.sourceContextSignature) throw new SourceConfirmationError("Keep the confirmed story unchanged before reviewing appended sources.");
  if (jobs.some(job => job.ownerId !== ownerId || job.projectId !== saved.project.id)) throw new SourceConfirmationError("Canonical jobs belong to another project.", 403);
  const recoveredPrevious = { ...previous, placementPlan: { ...previous.placementPlan, inputSignature: placementInputSignature(previous, previous.placementPlan.settings) } };
  const oldScope = previous.generationScope?.body.scopeSignature ?? effectiveGenerationScope(recoveredPrevious);
  if (!oldScope) throw new SourceConfirmationError("The original generation scope is unavailable. Its footage bank was preserved.");
  let oldReferences: ReferenceAsset[];
  let oldRawReferences: ScopeRawReference[];
  let sourceMediaVersions: ScopeSourceMediaVersion[];
  if (previous.generationScope) {
    const prior = normalizeGenerationScopeReceipt(previous.generationScope);
    const canonical = prior && await readGenerationScopeReceipt(ownerId, saved.project.id, prior.id);
    if (!prior || !canonical || generationScopeSha256(prior) !== generationScopeSha256(canonical)
      || prior.body.ownerId !== ownerId || prior.body.projectId !== saved.project.id || prior.body.semanticSha256 !== generationSemanticSha256(previous)
      || prior.body.storySha256 !== storySha(draft)) throw new SourceConfirmationError("The prior canonical source confirmation differs.");
    oldReferences = (draft.referenceAssets ?? []).filter(reference => prior.body.references.some(entry => entry.id === reference.id));
    if (generationScopeSha256(sourceReferenceManifest(oldReferences)) !== generationScopeSha256(prior.body.references)
      || prior.body.sourceInventorySha256 !== sourceSha({ ...draft, referenceAssets: oldReferences })
      || buildStudioSourceContextSignature(contextInput(draft, oldReferences)) !== previous.sourceContextSignature) throw new SourceConfirmationError("An existing source changed after the previous confirmation.");
    try { oldRawReferences = await verifyGenerationScopeRawReferences(ownerId, prior.body.references, prior.body.rawReferences); }
    catch { throw new SourceConfirmationError("An existing reference's exact conditional bytes changed. Its footage bank was preserved."); }
    try { sourceMediaVersions = await verifyGenerationScopeMedia(ownerId, draft, prior.body.sourceMediaVersions); }
    catch { throw new SourceConfirmationError("An existing master or footage object changed. Its footage bank was preserved."); }
  } else {
    const original = await originalReferences(ownerId, saved.project.id, draft, jobs, oldScope);
    oldReferences = original.references; oldRawReferences = original.rawReferences; sourceMediaVersions = original.sourceMediaVersions;
  }
  const added = (draft.referenceAssets ?? []).filter(reference => !oldReferences.some(old => old.id === reference.id));
  const currentContext = buildStudioSourceContextSignature(contextInput(draft));
  if (!added.length || currentContext === previous.sourceContextSignature || new Set((draft.referenceAssets ?? []).map(reference => reference.id)).size !== (draft.referenceAssets ?? []).length) throw new SourceConfirmationError("No distinct appended reference inventory was found.");
  const storyText = JSON.stringify({ sections: previous.storySections, items: previous.editPlan.timelineItems, treatment: story.confirmedTreatmentSnapshot, beats: story.storyBeats }).toLowerCase();
  for (const reference of added) {
    if (reference.storageStatus !== "uploaded" || reference.storageBucket !== bucket || !reference.storagePath
      || !mediaUploadBelongsToOwner(reference.storagePath, ownerId) || /[\\\x00-\x1f]/.test(reference.storagePath)
      || reference.storagePath.split("/").some(part => !part || part === "." || part === "..")) throw new SourceConfirmationError("Every appended sheet must be a durable image owned by this account.", 403);
    if (!reference.displayName.trim() || storyText.includes(reference.displayName.trim().toLowerCase()) || jobs.some(job => job.references.some(snapshot => snapshot.assetId === reference.id))) {
      throw new SourceConfirmationError("An appended reference is already used by the story or generation history. Review a new generation scope instead.");
    }
  }
  const reprise = exactExistingSourceReprise(saved.project.id, previous);
  let appendedRawReferences: ScopeRawReference[];
  try { appendedRawReferences = await pinGenerationScopeRawReferences(ownerId, sourceReferenceManifest(added)); }
  catch { throw new SourceConfirmationError("The appended sheets could not establish immutable raw-image versions."); }
  const next = preserveReviewedStoryArrangement(previous, { ...previous, sourceContextSignature: currentContext,
    generationSourceContextSha256: previous.generationScopeVersion === 2 ? sourceSha(draft) : undefined,
    placementPlan: { ...previous.placementPlan, inputSignature: placementInputSignature({ ...previous, sourceContextSignature: currentContext }) } }, reprise);
  const body: GenerationScopeReceipt["body"] = { version: 1, kind: "additive-reference", ownerId, projectId: saved.project.id, baselineRevision: revision,
    fromSourceContext: previous.sourceContextSignature, toSourceContext: currentContext, fromInputSignature: placementInputSignature(previous),
    toInputSignature: next.placementPlan!.inputSignature, scopeSignature: oldScope, semanticSha256: generationSemanticSha256(next),
    references: sourceReferenceManifest(draft.referenceAssets ?? []), rawReferences: [...oldRawReferences, ...appendedRawReferences].sort((a, b) => a.assetId.localeCompare(b.assetId)), sourceMediaVersions,
    appendedReferenceIds: added.map(reference => reference.id).sort(),
    storySha256: storySha(draft), sourceInventorySha256: sourceSha(draft),
    ...(previous.generationScope ? { previousReceiptSha256: previous.generationScope.sha256 } : {}), ...(reprise ? { reprise } : {}) };
  if(previous.currentIdentity)body.currentIdentityMigrationSha256=previous.currentIdentity.migrationSha256;
  const sha256 = generationScopeSha256(body), receipt: GenerationScopeReceipt = { version: 1, id: `generation-scope-${sha256}`, sha256, body };
  const oldDraft = draft.generatedDraft ?? createGeneratedDraftSelection(oldScope);
  if (oldDraft.planSignature !== oldScope) throw new SourceConfirmationError("The selected draft belongs to another arrangement. Review it before confirming sources.");
  const selected = [...oldDraft.assetIds];
  const workflow = { ...draft.workflowUiSettings, committedSplit: undefined, finalExport: undefined, finalExportIntent: undefined };
  const candidate: PersistedStudioProjectDraft = { ...draft, musicVideoProject: { ...next, generationScope: receipt },
    storyState: { ...story, confirmedSourceContextSignature: currentContext }, workflowUiSettings: workflow,
    generatedDraft: { ...oldDraft, revision: oldDraft.revision + 1, assetIds: selected, sourceConfirmationSha256: sha256, sourceReviewRequired: true } };
  await storeGenerationScopeReceipt(receipt);
  return { draft: candidate, receipt, expectedRevision: revision };
}

/** Called only after normal authenticated materialization has validated all current story/target/reference gates. */
export async function recordGenerationScopeBaseline(ownerId: string, saved: SavedStudioProject): Promise<void> {
  const project = saved.draft.musicVideoProject, revision = (saved as SavedStudioProject & { revision?: string }).revision;
  if (project?.generationScope || project?.generationScopeVersion !== 2 || !revision) return;
  const scope = project && effectiveGenerationScope(project);
  const context = buildStudioSourceContextSignature(contextInput(saved.draft));
  if (!project || !scope || saved.project.ownerId !== ownerId || project.generationSourceContextSha256 !== sourceSha(saved.draft) || project.generationStorySha256 !== storySha(saved.draft) || project.sourceContextSignature !== context
    || saved.draft.storyState.confirmedSourceContextSignature !== context) throw new SourceConfirmationError("Save the current source context before creating generation evidence.");
  const prior = await readGenerationScopeBaseline(ownerId, saved.project.id, scope, generationSemanticSha256(project));
  if (prior) {
    if (prior.body.sourceInventorySha256 !== sourceSha(saved.draft) || prior.body.storySha256 !== storySha(saved.draft)
      || generationScopeSha256(prior.body.references) !== generationScopeSha256(sourceReferenceManifest(saved.draft.referenceAssets ?? []))) throw new SourceConfirmationError("The immutable generation baseline differs from the current sources.");
    try { await verifyGenerationScopeRawReferences(ownerId, prior.body.references, prior.body.rawReferences); await verifyGenerationScopeMedia(ownerId, saved.draft, prior.body.sourceMediaVersions); }
    catch { throw new SourceConfirmationError("The current reference pixels differ from their immutable generation baseline."); }
    return;
  }
  const body: GenerationScopeReceipt["body"] = { version: 1, kind: "baseline", ownerId, projectId: saved.project.id, baselineRevision: revision,
    fromSourceContext: context, toSourceContext: context, fromInputSignature: project.placementPlan!.inputSignature,
    toInputSignature: project.placementPlan!.inputSignature, scopeSignature: scope, semanticSha256: generationSemanticSha256(project),
    references: sourceReferenceManifest(saved.draft.referenceAssets ?? []), rawReferences: await pinGenerationScopeRawReferences(ownerId, sourceReferenceManifest(saved.draft.referenceAssets ?? [])),
    sourceMediaVersions: await pinGenerationScopeMedia(ownerId, saved.draft),
    appendedReferenceIds: [], storySha256: storySha(saved.draft), sourceInventorySha256: sourceSha(saved.draft) };
  const sha256 = generationScopeSha256(body);
  await storeGenerationScopeBaseline({ version: 1, id: `generation-scope-${sha256}`, sha256, body });
}
