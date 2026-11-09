import type { SavedStudioProject } from "./studioProjectStore";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import { effectiveGenerationScope, generationScopeSha256, generationSemanticSha256, sourceReferenceManifest, type GenerationScopeReceipt } from "@/components/studio/generationScope";
import { buildStoryContentSignature } from "@/components/studio/storyTreatments";
import { assertStoryBibleConfirmation } from "@/components/studio/storyAuthoring";
import { buildStoryBibleBinding } from "@/components/studio/storyBibleBinding";
import { reuseOriginAssetSha256, type ReuseOrigin } from "@/components/studio/reusedTakePlacements";
import { withCurrentReferenceIdentity } from "@/components/studio/currentReferenceIdentity";
import { currentIdentityEvidenceSha256 } from "@/components/studio/issuedIdentityPolicy";
import { readGenerationScopeBaseline, readGenerationScopeReceipt, storeGenerationScopeBaseline, storeGenerationScopeReceipt } from "./generationScopeStore";
import { verifyGenerationScopeRawReferences } from "./generationScopeRawReferences";
import { verifyGenerationScopeMedia } from "./generationScopeMedia";
import { resolveCanonicalSelectedFootageEvidence } from "./selectedFootageEvidenceServer";
import { SourceConfirmationError, sourceSha, storySha, validateSavedGenerationScope } from "./generationScopeServer";

/** Explicitly enroll revised creative inputs; never reinterpret the old additive-equivalence receipt. */
export async function prepareCreativeRebaseline(params: { ownerId: string; saved: SavedStudioProject; expectedRevision: string; jobs: H3GenerationJob[] }) {
  const { ownerId, saved, jobs } = params, draft = saved.draft, project = draft.musicVideoProject, story = draft.storyState;
  if (!saved.revision || saved.revision !== params.expectedRevision || saved.project.ownerId !== ownerId) throw new SourceConfirmationError("The saved project changed. Reload before confirming its revised story.");
  if (!project?.placementPlan || project.generationScope || project.generationScopeVersion !== 2
    || !story.storyGenerated || !story.confirmedTreatmentSnapshot || story.confirmedTreatmentId !== story.confirmedTreatmentSnapshot.id
    || story.confirmedTreatmentSnapshot.reconciliation?.status === "pending"
    || story.storyContentSignature !== buildStoryContentSignature(story.confirmedTreatmentSnapshot, story.storyBeats)
    || project.generationSourceContextSha256 !== sourceSha(draft) || project.generationStorySha256 !== storySha(draft)
    || story.confirmedSourceContextSignature !== project.sourceContextSignature) throw new SourceConfirmationError("Confirm and save the current story, Bible and source context before creative rebaseline.");
  try {
    if (story.confirmedTreatmentSnapshot.storyBible) assertStoryBibleConfirmation(story.confirmedTreatmentSnapshot,
      buildStoryBibleBinding({ projectId: saved.project.id, treatment: story.confirmedTreatmentSnapshot, referenceAssets: draft.referenceAssets ?? [] }));
  } catch { throw new SourceConfirmationError("Review the story bible against this story and its current references before creative rebaseline."); }
  const scope = effectiveGenerationScope(project), coordinates = project.reuseSourceBaselines;
  if (!scope || !coordinates?.length || coordinates.length > 32 || jobs.length > 128
    || jobs.some(job => job.ownerId !== ownerId || job.projectId !== saved.project.id)) throw new SourceConfirmationError("Bounded canonical same-project origins are required.");
  const baselines: GenerationScopeReceipt[] = [];
  for (const coordinate of coordinates) {
    if (!coordinate || !/^[a-f0-9]{64}$/.test(coordinate.semanticSha256)
      || !/^(?:placements-v1-[a-f0-9]+|generation-v2-[a-f0-9]{64})$/.test(coordinate.scopeSignature)) throw new SourceConfirmationError("The historical source baseline coordinate is invalid.");
    const baseline = coordinate.receiptId
      ? await readGenerationScopeReceipt(ownerId, saved.project.id, coordinate.receiptId)
      : await readGenerationScopeBaseline(ownerId, saved.project.id, coordinate.scopeSignature, coordinate.semanticSha256);
    // Repeated Story confirmations can leave an unissued coordinate with no completed footage.
    // It grants nothing. A missing baseline for an actual ready origin remains an error.
    if (!baseline && !coordinate.receiptId && !jobs.some(job => job.state === "ready" && job.result && job.target.planSignature === coordinate.scopeSignature)) continue;
    if (!baseline || baseline.body.ownerId !== ownerId || baseline.body.projectId !== saved.project.id
      || baseline.body.scopeSignature !== coordinate.scopeSignature || baseline.body.semanticSha256 !== coordinate.semanticSha256
      || baseline.body.sourceInventorySha256 !== sourceSha(draft)
      || generationScopeSha256(baseline.body.references) !== generationScopeSha256(sourceReferenceManifest(draft.referenceAssets ?? []))) throw new SourceConfirmationError("An origin baseline or current source inventory differs. Revalidate changed references before reusing footage.");
    await verifyGenerationScopeRawReferences(ownerId, baseline.body.references, baseline.body.rawReferences);
    await verifyGenerationScopeMedia(ownerId, draft, baseline.body.sourceMediaVersions);
    const migration = baseline.body.referenceMigration ? baseline.sha256 : baseline.body.currentIdentityMigrationSha256;
    if (migration && project.currentIdentity?.migrationSha256 !== migration) throw new SourceConfirmationError("The historical current-reference migration must remain attached to this revised story.");
    baselines.push(baseline);
  }
  if (!baselines.length) throw new SourceConfirmationError("No canonical historical source baseline is available.");
  const reuseOrigins: ReuseOrigin[] = [];
  for (const asset of withCurrentReferenceIdentity(draft.generatedAssets ?? [], project.currentIdentity)) {
    const job = jobs.find(job => job.id === asset.jobId);
    if (!job || !asset.target?.planSignature || !baselines.some(baseline => baseline.body.scopeSignature === asset.target!.planSignature)
      || asset.reviewStatus === "rejected") continue;
    const selected = await resolveCanonicalSelectedFootageEvidence({ selected: true, ownerId, projectId: saved.project.id,
      generationScope: asset.target.planSignature, asset: { ...asset, reviewStatus: "pending" }, currentIdentity: project.currentIdentity,
      window: { songStart: asset.target.songStart, songEnd: asset.target.songEnd, sourceStart: asset.trimStart ?? 0,
        sourceEnd: (asset.trimStart ?? 0) + asset.target.songEnd - asset.target.songStart } });
    if (selected && selected.canonicalBinding.identityEvidenceSha256 === currentIdentityEvidenceSha256(asset)) reuseOrigins.push({ assetId: asset.id, jobId: job.id, scopeSignature: asset.target.planSignature, assetSha256: reuseOriginAssetSha256(asset) });
  }
  if (!reuseOrigins.length) throw new SourceConfirmationError("No eligible canonical origin footage is available for this revised story.");
  const origin = baselines[0], context = project.sourceContextSignature!;
  const body: GenerationScopeReceipt["body"] = { version: 1, kind: "baseline", ownerId, projectId: saved.project.id,
    baselineRevision: saved.revision, fromSourceContext: context, toSourceContext: context,
    fromInputSignature: project.placementPlan.inputSignature, toInputSignature: project.placementPlan.inputSignature,
    scopeSignature: scope, semanticSha256: generationSemanticSha256(project), references: sourceReferenceManifest(draft.referenceAssets ?? []),
    rawReferences: origin.body.rawReferences, sourceMediaVersions: origin.body.sourceMediaVersions, appendedReferenceIds: [],
    sourceInventorySha256: sourceSha(draft), storySha256: storySha(draft), reuseOrigins,
    ...(origin.body.reprise?.placementsSha256 === generationScopeSha256(project.placementPlan.placements) ? { reprise: origin.body.reprise } : {}),
    ...(project.currentIdentity ? { currentIdentityMigrationSha256: project.currentIdentity.migrationSha256 } : {}) };
  const sha256 = generationScopeSha256(body), receipt: GenerationScopeReceipt = { version: 1, id: `generation-scope-${sha256}`, sha256, body };
  const candidate = { ...draft, musicVideoProject: { ...project, generationScope: receipt },
    generatedDraft: { planSignature: scope, revision: (draft.generatedDraft?.revision ?? 0) + 1, assetIds: [],
      sourceConfirmationSha256: sha256, sourceReviewRequired: true, reusedTakePlacements: [] },
    workflowUiSettings: { ...draft.workflowUiSettings, committedSplit: undefined, finalExport: undefined, finalExportIntent: undefined } };
  await storeGenerationScopeBaseline(receipt);
  await storeGenerationScopeReceipt(receipt);
  await validateSavedGenerationScope(ownerId, { ...saved, draft: candidate });
  return { draft: candidate, receipt, expectedRevision: saved.revision };
}
