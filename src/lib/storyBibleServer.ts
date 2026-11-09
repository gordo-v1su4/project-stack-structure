import { buildStoryBibleBinding } from "@/components/studio/storyBibleBinding";
import { identityPolicySha256 } from "@/components/studio/issuedIdentityPolicy";
import { normalizeStoryBible, projectStoryBible } from "@/components/studio/storyBible";
import { storyBibleTreatmentSignature, type StoryTreatmentRequest } from "@/components/studio/storyTreatments";
import { readStudioProject } from "./studioProjectStore";
import { mediaUploadBelongsToOwner } from "./essentiaUpload";
import { getMediaGatewayConfig } from "./mediaGateway";

export class StoryCanonError extends Error {
  constructor(message: string, readonly status = 409) { super(message); this.name = "StoryCanonError"; }
}
export type VerifiedStoryCanon = ReturnType<typeof projectStoryBible>;

/** Authored canon is distinct from image observations. This performs no media writes or pinning. */
export async function resolveStoryCanon(ownerId: string, request: StoryTreatmentRequest, dependencies: {
  read?: typeof readStudioProject; bucket?: string;
} = {}): Promise<VerifiedStoryCanon | undefined> {
  const context = request.canonContext;
  if (!context) {
    if (request.revision?.treatment.storyBible) throw new StoryCanonError("Save and bind this story bible before requesting a revision.");
    return undefined;
  }
  const saved = await (dependencies.read ?? readStudioProject)(ownerId, context.projectId, { fresh: true });
  if (!saved || saved.project.ownerId !== ownerId || saved.project.id !== context.projectId) throw new StoryCanonError("Project not found.", 404);
  if (saved.revision !== context.expectedRevision) throw new StoryCanonError("The saved story revision changed. Save or reopen the current project first.");
  const bible = normalizeStoryBible(context.bible), state = saved.draft.storyState;
  const candidates = state.treatments ?? [];
  const sourceId = request.revision?.treatment.id;
  // Prefer the saved authored candidate over its older confirmed snapshot. A
  // stale confirmed copy must never mask newer edited facts with the same ID.
  const authored = sourceId ? candidates.filter(item => item.id === sourceId)
    : candidates.filter(item => storyBibleTreatmentSignature(item) === bible.binding.storySignature);
  let source = authored.length === 1 ? authored[0] : undefined;
  if (authored.length > 1) throw new StoryCanonError("The saved story canon source is ambiguous.");
  if (!source) {
    const confirmed = state.confirmedTreatmentSnapshot;
    if (confirmed && (!sourceId || confirmed.id === sourceId)
      && !candidates.some(item => item.id === confirmed.id)
      && storyBibleTreatmentSignature(confirmed) === bible.binding.storySignature) source = confirmed;
  }
  if (!source || storyBibleTreatmentSignature(source) !== bible.binding.storySignature || !source.storyBible
    || identityPolicySha256(normalizeStoryBible(source.storyBible)) !== identityPolicySha256(bible)) {
    throw new StoryCanonError("Save the exact current story bible on its authored source before requesting generation.");
  }
  const references = saved.draft.referenceAssets ?? [], bucket = dependencies.bucket ?? getMediaGatewayConfig()?.bucket;
  if (references.some(ref => !bucket || ref.storageBucket !== bucket || !ref.storagePath
    || !mediaUploadBelongsToOwner(ref.storagePath, ownerId))) throw new StoryCanonError("Story canon references must belong to the saved project owner.");
  let current;
  try { current = buildStoryBibleBinding({ projectId: saved.project.id, treatment: source, referenceAssets: references }); }
  catch { throw new StoryCanonError("The saved named references are not ready for story canon."); }
  const refs = new Map(references.map(ref => [ref.id, ref]));
  if (bible.characters.some(character => character.referenceAssetIds.some(id => refs.get(id)?.displayName !== character.canonicalName)
    || !character.referenceAssetIds.some(id => refs.get(id)?.kind === "character"))) {
    throw new StoryCanonError("Canonical character names must match their saved named references.");
  }
  if (bible.facts.some(fact => fact.referenceAssetIds.some(id => !refs.has(id)))) throw new StoryCanonError("A story canon reference is unavailable.");
  try { return projectStoryBible(bible, { binding: current, characterIds: bible.characters.map(character => character.id), referenceAssetIds: references.map(ref => ref.id) }); }
  catch { throw new StoryCanonError("The story bible belongs to stale story or reference bindings. Review its binding explicitly."); }
}

/** Keep author data positive and bounded; reviewer receives matching positive,
 * exclusion and review facts. Leave >1KiB for the worker's evidence-format repair. */
export function storyCanonPromptData(canon: VerifiedStoryCanon | undefined, brief: string, constraints: string[]) {
  const positive = canon ? canon.generationContext.map(fact => `[${fact.kind}] ${fact.characterNames.join(", ")}: ${fact.text}`) : [];
  const review = canon ? [...canon.generationContext, ...canon.reviewConstraints].map(fact => `[Canon ${fact.id}/${fact.kind}] ${fact.characterNames.join(", ")}: ${fact.text}`) : [];
  if (positive.join("\n").length > 6_000 || brief.length + [...constraints, ...review].reduce((sum, item) => sum + item.length, 0) > 10_900) {
    throw new StoryCanonError("Story canon exceeds the author/reviewer context budget. Shorten its facts before requesting generation.", 400);
  }
  return { positive, review, ...(canon ? { source: { binding: canon.binding, bibleSha256: canon.bibleSha256, projectionSha256: canon.projectionSha256 } } : {}) };
}
