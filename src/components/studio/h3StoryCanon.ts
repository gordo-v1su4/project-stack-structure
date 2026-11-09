import { generationScopeSha256 } from "./generationScope";
import { selectH3ReferenceAssetIds } from "./h3DraftPlan";
import type { ReferenceAsset } from "./referenceAssets";
import { normalizeStoryBible, projectStoryBible, type CanonFact } from "./storyBible";
import { buildStoryBibleBinding } from "./storyBibleBinding";
import type { StoryTreatment } from "./storyTreatments";
import type { ShotRequirementConstraints } from "./storyMatchAssessment";

export type H3ShotCanonScope = {
  version: 1; bibleSha256: string; projectionSha256: string; scopeSha256: string;
  subjectNames: string[]; referenceAssetIds: string[];
  positiveFacts: { id: string; text: string }[];
  reviewConstraints: { id: string; text: string }[];
};
export type H3StoryCanonSource = { treatment: StoryTreatment; references: ReferenceAsset[] };

const mentions = (text: string, name: string) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}])`, "iu").test(text);

/** This is scoped authoring data, never appearance evidence or a native H3 prompt. */
export function buildH3StoryCanonScope(projectId: string, source: H3StoryCanonSource, group: {
  narrativeMomentId?: string; requirementId?: string; approvedDirection: string; constraints: ShotRequirementConstraints;
}): H3ShotCanonScope | undefined {
  if (!source.treatment.storyBible) return undefined;
  const bible = normalizeStoryBible(source.treatment.storyBible);
  const binding = buildStoryBibleBinding({ projectId, treatment: source.treatment, referenceAssets: source.references });
  const current = new Map(source.references.map(ref => [ref.id, ref]));
  if (bible.characters.some(character => character.referenceAssetIds.some(id => current.get(id)?.kind !== "character"
    || current.get(id)?.displayName !== character.canonicalName))) throw new Error("Restore the current named character references before shot planning.");
  const referenceAssetIds = selectH3ReferenceAssetIds(source.references, group.approvedDirection);
  const selectedReferences = new Set(referenceAssetIds);
  const principalReferences = source.references.filter(reference => reference.kind === "character" || reference.role.startsWith("character-"));
  const knownNames = principalReferences.map(reference => reference.displayName);
  const characters = bible.characters.filter(character => character.referenceAssetIds.some(id => selectedReferences.has(id)));
  // A valid partial Bible cannot erase a named lead from the actual reference packet.
  const subjectNames = principalReferences.filter(reference => selectedReferences.has(reference.id)).map(reference => reference.displayName);
  // Explicit required leads may not disappear from the shot's visible direction.
  if (group.constraints.subjects && (group.constraints.subjects.some(name => knownNames.includes(name) && !subjectNames.includes(name))
    || subjectNames.some(name => !group.constraints.subjects!.includes(name)))) {
    throw new Error("The shot direction and its required canonical subjects disagree.");
  }
  const anchorIds = new Set(source.treatment.anchors.map(anchor => anchor.id));
  const lastAnchor = source.treatment.anchors.at(-1)?.id;
  const relevant = (fact: CanonFact) => {
    // Narrative synopsis/biography is not a command to replay the whole film.
    if (["premise", "thesis", "backstory", "psychology", "voice"].includes(fact.kind)) return false;
    if (!subjectNames.length && ["movement", "stillness", "function"].includes(fact.kind)) return false;
    if (knownNames.some(name => !subjectNames.includes(name) && mentions(fact.value ?? "", name))) return false;
    if (fact.provenance.kind === "approved-story") {
      const origins = fact.provenance.sourceIds.filter(id => anchorIds.has(id));
      if (origins.length && !origins.includes(group.narrativeMomentId ?? "")) return false;
      if (fact.provenance.sourceIds.includes(`${source.treatment.id}:endingHook`) && group.narrativeMomentId !== lastAnchor) return false;
      if (fact.provenance.sourceIds.some(id => id === `${source.treatment.id}:logline` || id === `${source.treatment.id}:synopsis`)) return false;
    }
    return true;
  };
  // Validate the complete source binding before projecting a detached scoped view.
  projectStoryBible(bible, { binding, characterIds: [], referenceAssetIds: [] });
  const scoped = normalizeStoryBible({ ...bible, facts: bible.facts.filter(relevant),
    relationships: bible.relationships.filter(relation => !knownNames.some(name => !subjectNames.includes(name)
      && mentions(relation.value ?? "", name))) });
  const projection = projectStoryBible(scoped, { binding, characterIds: characters.map(character => character.id), referenceAssetIds });
  const body = { version: 1 as const, bibleSha256: generationScopeSha256(bible), projectionSha256: projection.projectionSha256,
    subjectNames, referenceAssetIds, positiveFacts: projection.generationContext.map(fact => ({ id: fact.id, text: fact.text })),
    reviewConstraints: projection.reviewConstraints.map(fact => ({ id: fact.id, text: fact.text })) };
  if (new TextEncoder().encode(JSON.stringify(body)).length > 64 * 1024) throw new Error("Scoped story canon exceeds the shot planning context bound.");
  return { ...body, scopeSha256: generationScopeSha256(body) };
}
