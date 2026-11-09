import type { ReferenceAsset } from "./referenceAssets";
import { identityPolicySha256 } from "./issuedIdentityPolicy";
import { normalizeStoryBible, STORY_BIBLE_ADAPTER, type CanonFact, type CanonRelationship, type StoryBible, type StoryBibleBinding } from "./storyBible";
import { buildStoryBibleBinding } from "./storyBibleBinding";
import { storyBibleTreatmentSignature, type StoryTreatment } from "./storyTreatments";

export type StoryBibleAuthoringContext = {
  binding: StoryBibleBinding;
  treatment: StoryTreatment;
  confirmedTreatment: StoryTreatment | null;
  referenceAssets: ReferenceAsset[];
};

function assertContext(context: StoryBibleAuthoringContext) {
  if (context.binding.storySignature !== storyBibleTreatmentSignature(context.treatment)) {
    throw new Error("The story changed. Refresh the story binding before editing canon.");
  }
  const actual = buildStoryBibleBinding({ projectId: context.binding.projectId, treatment: context.treatment, referenceAssets: context.referenceAssets });
  if (identityPolicySha256(actual) !== identityPolicySha256(context.binding)) {
    throw new Error("The reference set changed. Refresh its binding before editing canon.");
  }
}

function assertReferences(bible: StoryBible, references: ReferenceAsset[]) {
  const current = new Map(references.filter(ref => ref.storageStatus === "uploaded").map(ref => [ref.id, ref]));
  if (new Set(references.map(ref => ref.id)).size !== references.length) throw new Error("Reference identities must be unique.");
  for (const character of bible.characters) {
    if (character.referenceAssetIds.some(id => current.get(id)?.kind !== "character")) {
      throw new Error("Each named character needs a current uploaded character reference.");
    }
    if (character.referenceAssetIds.some(id => current.get(id)?.displayName !== character.canonicalName)) {
      throw new Error("Declared character names must match their named references in Setup.");
    }
  }
  if (bible.facts.some(fact => fact.referenceAssetIds.some(id => !current.has(id)))) {
    throw new Error("A canon fact uses a missing or unuploaded reference.");
  }
}

/** The parent supplies a binding built from the same source objects as dispatch. */
export function validateStoryBibleForAuthoring(value: unknown, context: StoryBibleAuthoringContext): StoryBible {
  assertContext(context);
  const bible = normalizeStoryBible(value);
  if (identityPolicySha256(bible.binding) !== identityPolicySha256(context.binding)) {
    throw new Error("This canon belongs to a different project, story, or reference set.");
  }
  assertReferences(bible, context.referenceAssets);
  return bible;
}

function approvedSourceFacts(context: StoryBibleAuthoringContext): CanonFact[] {
  const source = context.confirmedTreatment;
  if (!source || storyBibleTreatmentSignature(source) !== context.binding.storySignature) {
    throw new Error("Confirm this exact story before importing its facts.");
  }
  const texts = [
    { id: "story-logline", value: source.logline, sourceId: `${source.id}:logline`, kind: "premise" as const },
    { id: "story-synopsis", value: source.synopsis, sourceId: `${source.id}:synopsis`, kind: "premise" as const },
    { id: "story-ending", value: source.endingHook, sourceId: `${source.id}:endingHook`, kind: "production" as const },
    ...source.anchors.map((anchor, index) => ({ id: `story-anchor-${index}`, value: anchor.description,
      sourceId: anchor.id, kind: "production" as const })),
  ];
  // Oversized passages stay in the story; never truncate them into altered canon.
  return texts.filter(item => item.value.trim() && item.value === item.value.trim() && item.value.length <= 1600)
    .map(item => ({ id: item.id, kind: item.kind, value: item.value, state: "confirmed", visibility: "public", channel: "positive",
      characterIds: [], referenceAssetIds: [], provenance: { kind: "approved-story", sourceIds: [item.sourceId] } }));
}

/** Exact approved prose only. Named references remain the declared-name authority. */
export function importApprovedStoryBible(context: StoryBibleAuthoringContext): StoryBible {
  const empty = startStoryBibleWithCurrentReferences(context);
  return validateStoryBibleForAuthoring({ ...empty, facts: approvedSourceFacts(context) }, context);
}

/** Explicit replacement only: no facts, relationships, decisions or old identities are copied. */
export function startStoryBibleWithCurrentReferences(context: StoryBibleAuthoringContext): StoryBible {
  assertContext(context);
  return validateStoryBibleForAuthoring({ version: 1, adapter: STORY_BIBLE_ADAPTER, binding: context.binding,
    characters: context.referenceAssets.filter(ref => ref.storageStatus === "uploaded" && ref.kind === "character")
      .map(ref => ({ id: ref.id, canonicalName: ref.displayName, referenceAssetIds: [ref.id] })),
    facts: [], relationships: [] }, context);
}

/** JSON is a proposal transport, never evidence of a user's approval. */
export function importStoryBibleJson(json: string, context: StoryBibleAuthoringContext, existing?: StoryBible): StoryBible {
  if (new TextEncoder().encode(json).length > 64 * 1024) throw new Error("Canon import must be 64 KB or smaller.");
  const incoming = validateStoryBibleForAuthoring(JSON.parse(json), context);
  const current = existing ? validateStoryBibleForAuthoring(existing, context) : undefined;
  const approved = context.confirmedTreatment && storyBibleTreatmentSignature(context.confirmedTreatment) === context.binding.storySignature
    ? approvedSourceFacts(context) : [];
  const preserve = <T extends CanonFact | StoryBible["relationships"][number]>(item: T, evidence: typeof item[]): T =>
    item.state === "confirmed" && !evidence.some(known => identityPolicySha256(known) === identityPolicySha256(item))
      ? { ...item, state: "proposed" } : item;
  // Existing approval is reusable only with the same exact declared characters.
  const sameCharacters = current && identityPolicySha256(current.characters) === identityPolicySha256(incoming.characters);
  return validateStoryBibleForAuthoring({ ...incoming,
    facts: incoming.facts.map(fact => preserve(fact, [...(sameCharacters ? current.facts : []), ...approved])),
    relationships: incoming.relationships.map(relation => preserve(relation, sameCharacters ? current.relationships : [])),
  }, context);
}

export function canRebindStoryBible(value: unknown, context: StoryBibleAuthoringContext): boolean {
  try {
    assertContext(context);
    const bible = normalizeStoryBible(value);
    assertReferences(bible, context.referenceAssets);
    return bible.binding.projectId === context.binding.projectId
      && bible.binding.referenceSignature === context.binding.referenceSignature
      && bible.binding.storySignature !== context.binding.storySignature;
  } catch { return false; }
}

/** Explicit review action; never promotes facts or rewrites their provenance. */
export function rebindStoryBible(value: unknown, context: StoryBibleAuthoringContext): StoryBible {
  if (!canRebindStoryBible(value, context)) throw new Error("Only a story revision can be reviewed here. Restore the original project and references first.");
  return validateStoryBibleForAuthoring({ ...normalizeStoryBible(value), binding: context.binding }, context);
}

export function editStoryBibleFact(bible: StoryBible, id: string, patch: Partial<Pick<CanonFact, "value" | "visibility" | "channel" | "kind">>): StoryBible {
  if (!bible.facts.some(fact => fact.id === id)) throw new Error("Choose an existing canon fact.");
  return normalizeStoryBible({ ...bible, facts: bible.facts.map(fact => fact.id === id
    ? { ...fact, ...patch, ...(patch.value !== undefined ? { value: patch.value.trim() } : {}), state: "proposed",
      provenance: { kind: "user", sourceIds: [id] } } : fact) });
}

export function confirmStoryBibleFact(bible: StoryBible, id: string): StoryBible {
  const fact = bible.facts.find(item => item.id === id);
  assertKnownCanonText(fact?.value);
  return normalizeStoryBible({ ...bible, facts: bible.facts.map(item => item.id === id ? { ...item, state: "confirmed" } : item) });
}

function assertKnownCanonText(value?: string) {
  if (!value?.trim() || /^(?:\[?(?:tbd|unknown|unspecified|not known|not specified)\]?|n\/a|\?)$/i.test(value)) {
    throw new Error("Write a known fact before confirming it.");
  }
}

/** Metadata and pending editor text travel together through a single proposal mutation. */
export function storyBibleTextPatch(text: string, metadata: Partial<Pick<CanonFact, "visibility" | "channel">> = {}) {
  return { ...metadata, value: text.trim() };
}

export function editStoryBibleRelationship(bible: StoryBible, id: string,
  patch: Partial<Pick<CanonRelationship, "value" | "visibility" | "channel">>): StoryBible {
  if (!bible.relationships.some(relation => relation.id === id)) throw new Error("Choose an existing canon relationship.");
  return normalizeStoryBible({ ...bible, relationships: bible.relationships.map(relation => relation.id === id
    ? { ...relation, ...patch, ...(patch.value !== undefined ? { value: patch.value.trim() } : {}), state: "proposed",
      provenance: { kind: "user", sourceIds: [id] } } : relation) });
}

export function confirmStoryBibleRelationship(bible: StoryBible, id: string): StoryBible {
  const relation = bible.relationships.find(item => item.id === id);
  assertKnownCanonText(relation?.value);
  return normalizeStoryBible({ ...bible, relationships: bible.relationships.map(item => item.id === id ? { ...item, state: "confirmed" } : item) });
}

export function removeStoryBibleRelationship(bible: StoryBible, id: string): StoryBible {
  if (!bible.relationships.some(relation => relation.id === id)) throw new Error("Choose an existing canon relationship.");
  return normalizeStoryBible({ ...bible, relationships: bible.relationships.filter(relation => relation.id !== id) });
}
