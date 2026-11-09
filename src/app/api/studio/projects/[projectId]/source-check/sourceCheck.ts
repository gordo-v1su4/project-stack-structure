import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { readStudioProject } from "@/lib/studioProjectStore";
import { readGenerationScopeReceipt } from "@/lib/generationScopeStore";
import { sourceSha, storySha } from "@/lib/generationScopeServer";
import { effectiveGenerationScope, generationScopeSha256, normalizeGenerationScopeReceipt, sourceReferenceManifest } from "@/components/studio/generationScope";
import { verifyGenerationScopeRawReferences } from "@/lib/generationScopeRawReferences";
import { verifyGenerationScopeMedia } from "@/lib/generationScopeMedia";
import { safeStorageDiagnostic } from "./safeStorageDiagnostic";

const CANONICAL_ERROR = "The canonical source confirmation is unavailable or changed.";
const STORAGE_ERROR = "Source verification could not complete.";
const reply = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Manual diagnostic reads only. This never authorizes generation or changes a saved record. */
export async function handleSourceStorageCheck(projectId: string) {
  const user = await getSessionUser();
  if (!user) { const response = unauthorizedResponse(); response.headers.set("Cache-Control", "no-store"); return response; }
  let saved: Awaited<ReturnType<typeof readStudioProject>>;
  try { saved = await readStudioProject(user.id, projectId, { fresh: true }); }
  catch (error) { return reply({ success: false, error: "Project storage could not be checked.", stage: "project-read", diagnostic: safeStorageDiagnostic(error) }, 503); }
  if (!saved || saved.project.ownerId !== user.id || saved.project.id !== projectId) return reply({ success: false, error: "Project not found." }, 404);
  const project = saved.draft.musicVideoProject;
  let receipt: ReturnType<typeof normalizeGenerationScopeReceipt>;
  try {
    receipt = project ? normalizeGenerationScopeReceipt(project.generationScope) : undefined;
    if (!project || !receipt || !effectiveGenerationScope(project) || receipt.body.ownerId !== user.id || receipt.body.projectId !== projectId
      || receipt.body.sourceInventorySha256 !== sourceSha(saved.draft) || receipt.body.storySha256 !== storySha(saved.draft)
      || generationScopeSha256(receipt.body.references) !== generationScopeSha256(sourceReferenceManifest(saved.draft.referenceAssets ?? []))) {
      return reply({ success: false, error: CANONICAL_ERROR, stage: "canonical" }, 409);
    }
    const canonical = await readGenerationScopeReceipt(user.id, projectId, receipt.id);
    if (!canonical || generationScopeSha256(canonical) !== generationScopeSha256(receipt)) return reply({ success: false, error: CANONICAL_ERROR, stage: "canonical" }, 409);
    if (receipt.body.referenceMigration || receipt.body.currentIdentityMigrationSha256 || project.currentIdentity) {
      const context = project.currentIdentity;
      if (!context || context.migrationSha256 !== (receipt.body.referenceMigration ? receipt.sha256 : receipt.body.currentIdentityMigrationSha256)) {
        return reply({ success: false, error: CANONICAL_ERROR, stage: "canonical" }, 409);
      }
      const migration = receipt.body.referenceMigration ? canonical : await readGenerationScopeReceipt(user.id, projectId, `generation-scope-${context.migrationSha256}`);
      if (!migration?.body.referenceMigration || migration.body.referenceMigration.contextSha256 !== context.contextSha256
        || generationScopeSha256(migration.body.referenceMigration.replacements) !== generationScopeSha256(context.replacements)) {
        return reply({ success: false, error: CANONICAL_ERROR, stage: "canonical" }, 409);
      }
    }
  } catch (error) {
    return reply({ success: false, error: CANONICAL_ERROR, stage: "canonical", diagnostic: safeStorageDiagnostic(error) }, 409);
  }
  try { await verifyGenerationScopeRawReferences(user.id, receipt.body.references, receipt.body.rawReferences); }
  catch (error) { return reply({ success: false, error: STORAGE_ERROR, stage: "raw-references", diagnostic: safeStorageDiagnostic(error) }, 503); }
  try { await verifyGenerationScopeMedia(user.id, saved.draft, receipt.body.sourceMediaVersions); }
  catch (error) { return reply({ success: false, error: STORAGE_ERROR, stage: "source-media", diagnostic: safeStorageDiagnostic(error) }, 503); }
  return reply({ success: true, checks: [{ stage: "raw-references", status: "passed" }, { stage: "source-media", status: "passed" }] }, 200);
}
