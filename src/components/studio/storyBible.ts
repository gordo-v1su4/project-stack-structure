import { canonicalIdentityPolicyJson, identityPolicySha256 } from "./issuedIdentityPolicy";

const adapterBody = { id: "story-bible-product-adapter-v1", contractVersion: 1,
  sourceSkillSha256: "c3f44e2d8e890da070fb1b41bd498cd9bfb71d3550048f1c74d4bea5e00f8145",
  policy: "exact-names-reference-visual-authority-positive-prose-v1" } as const;
export const STORY_BIBLE_ADAPTER = Object.freeze({ ...adapterBody, sha256: identityPolicySha256(adapterBody) });
export type StoryBibleBinding = { projectId: string; storySignature: string; referenceSignature: string };
export type CanonProvenance = { kind: "approved-story" | "user" | "reference"; sourceIds: string[] };
export type CanonFact = { id: string; kind: "premise" | "thesis" | "function" | "backstory" | "psychology" | "movement" | "stillness" | "voice" | "production";
  value?: string; state: "proposed" | "confirmed"; visibility: "public" | "private";
  channel: "positive" | "exclusion" | "review"; characterIds: string[]; referenceAssetIds: string[]; provenance: CanonProvenance };
export type CanonRelationship = Omit<CanonFact, "kind" | "characterIds" | "referenceAssetIds"> & { fromCharacterId: string; toCharacterId: string };
export type StoryBible = { version: 1; adapter: typeof STORY_BIBLE_ADAPTER; binding: StoryBibleBinding;
  characters: { id: string; canonicalName: string; referenceAssetIds: string[] }[]; facts: CanonFact[]; relationships: CanonRelationship[] };

const fail = () => { throw new Error("Invalid or unsupported story bible contract."); };
function object(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail();
  const v = value as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(v, key)) || Object.keys(v).some(key => !required.includes(key) && !optional.includes(key))) return fail();
  return v;
}
function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== "string" || value.length > max || value !== value.trim() || !empty && !value
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(value)) return fail();
  return value;
}
function list(value: unknown, max: number): string[] {
  if (!Array.isArray(value) || value.length > max) return fail();
  const result = value.map(item => text(item, 200));
  if (new Set(result).size !== result.length) return fail();
  return result;
}
function binding(value: unknown): StoryBibleBinding {
  const v = object(value, ["projectId", "storySignature", "referenceSignature"]);
  const projectId = text(v.projectId, 96);
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) return fail();
  return { projectId, storySignature: text(v.storySignature, 512), referenceSignature: text(v.referenceSignature, 512) };
}
function core(value: Record<string, unknown>) {
  if (typeof value.state !== "string" || !["proposed", "confirmed"].includes(value.state) || typeof value.visibility !== "string" || !["public", "private"].includes(value.visibility)
    || typeof value.channel !== "string" || !["positive", "exclusion", "review"].includes(value.channel)) return fail();
  const p = object(value.provenance, ["kind", "sourceIds"]);
  if (typeof p.kind !== "string" || !["approved-story", "user", "reference"].includes(p.kind)) return fail();
  const sourceIds = list(p.sourceIds, 16);
  if (!sourceIds.length) return fail();
  return { id: text(value.id, 200), ...(value.value === undefined ? {} : { value: text(value.value, 1600, true) }),
    state: value.state as CanonFact["state"], visibility: value.visibility as CanonFact["visibility"], channel: value.channel as CanonFact["channel"],
    provenance: { kind: p.kind as CanonProvenance["kind"], sourceIds } };
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(child => freeze(child)); Object.freeze(value); }
  return value;
}

/** Strict detached JSON; no image-derived appearance, example canon or missing-value defaults. */
export function normalizeStoryBible(value: unknown): StoryBible {
  let encoded: string;
  try { encoded = canonicalIdentityPolicyJson(value); } catch { return fail(); }
  if (new TextEncoder().encode(encoded).length > 64 * 1024) return fail();
  const v = object(value, ["version", "adapter", "binding", "characters", "facts", "relationships"]);
  if (v.version !== 1 || canonicalIdentityPolicyJson(v.adapter) !== canonicalIdentityPolicyJson(STORY_BIBLE_ADAPTER)
    || !Array.isArray(v.characters) || v.characters.length > 16 || !Array.isArray(v.facts) || v.facts.length > 64
    || !Array.isArray(v.relationships) || v.relationships.length > 32) return fail();
  const characters = v.characters.map(item => {
    const c = object(item, ["id", "canonicalName", "referenceAssetIds"]);
    const canonicalName = text(c.canonicalName, 120), referenceAssetIds = list(c.referenceAssetIds, 9);
    if (!referenceAssetIds.length || /[<>\r\n]/.test(canonicalName)) return fail();
    return { id: text(c.id, 200), canonicalName, referenceAssetIds };
  });
  if (new Set(characters.map(c => c.id)).size !== characters.length
    || new Set(characters.map(c => c.canonicalName.toLocaleLowerCase())).size !== characters.length) return fail();
  const ids = new Set(characters.map(c => c.id));
  const required = ["id", "kind", "state", "visibility", "channel", "characterIds", "referenceAssetIds", "provenance"];
  const facts: CanonFact[] = v.facts.map(item => {
    const f = object(item, required, ["value"]);
    if (typeof f.kind !== "string" || !["premise", "thesis", "function", "backstory", "psychology", "movement", "stillness", "voice", "production"].includes(f.kind)) return fail();
    const characterIds = list(f.characterIds, 16);
    if (characterIds.some(id => !ids.has(id))) return fail();
    return { ...core(f), kind: f.kind as CanonFact["kind"], characterIds, referenceAssetIds: list(f.referenceAssetIds, 32) };
  });
  const relationships: CanonRelationship[] = v.relationships.map(item => {
    const r = object(item, ["id", "state", "visibility", "channel", "provenance", "fromCharacterId", "toCharacterId"], ["value"]);
    const fromCharacterId = text(r.fromCharacterId, 200), toCharacterId = text(r.toCharacterId, 200);
    if (!ids.has(fromCharacterId) || !ids.has(toCharacterId) || fromCharacterId === toCharacterId) return fail();
    return { ...core(r), fromCharacterId, toCharacterId };
  });
  const factIds = [...facts, ...relationships].map(fact => fact.id);
  if (new Set(factIds).size !== factIds.length) return fail();
  return freeze({ version: 1, adapter: { ...STORY_BIBLE_ADAPTER }, binding: binding(v.binding), characters, facts, relationships });
}

/** Exact current bindings are mandatory. This projection is data for existing
 * prompt compilers, not independently valid model prose or observed shot evidence.
 */
export function projectStoryBible(value: unknown, current: { binding: StoryBibleBinding; characterIds: string[]; referenceAssetIds: string[] }) {
  const bible = normalizeStoryBible(value), active = binding(current.binding);
  if (identityPolicySha256(active) !== identityPolicySha256(bible.binding)) throw new Error("The story bible belongs to stale story or reference bindings.");
  const requestedIds = list(current.characterIds, 16), refs = new Set(list(current.referenceAssetIds, 32));
  if (requestedIds.some(id => !bible.characters.some(character => character.id === id))) throw new Error("Select canonical story bible characters.");
  const selected = new Set(bible.characters.filter(character => requestedIds.includes(character.id) || character.referenceAssetIds.some(id => refs.has(id))).map(character => character.id));
  type Projected = { id: string; kind: CanonFact["kind"] | "relationship"; text: string; characterNames: string[]; provenance: CanonProvenance };
  const generationContext: Projected[] = [], reviewConstraints: Projected[] = [];
  const unknown = /^(?:\[?(?:tbd|unknown|unspecified|not known|not specified)\]?|n\/a|\?)$/i;
  const negative = /\b(?:no|not|never|without|avoid|don't|doesn't|do not|stops)\b/i;
  const emit = (fact: ReturnType<typeof core>, kind: Projected["kind"], characterIds: string[]) => {
    if (fact.state !== "confirmed" || fact.visibility !== "public" || !fact.value || unknown.test(fact.value)) return;
    const item = { id: fact.id, kind, text: fact.value, characterNames: characterIds.map(id => bible.characters.find(c => c.id === id)!.canonicalName), provenance: fact.provenance };
    (fact.channel === "positive" && !negative.test(fact.value) ? generationContext : reviewConstraints).push(item);
  };
  for (const fact of bible.facts) if (fact.characterIds.every(id => selected.has(id)) && fact.referenceAssetIds.every(id => refs.has(id))) emit(fact, fact.kind, fact.characterIds);
  for (const relation of bible.relationships) if (selected.has(relation.fromCharacterId) && selected.has(relation.toCharacterId)) emit(relation, "relationship", [relation.fromCharacterId, relation.toCharacterId]);
  const body = { version: 1 as const, adapter: STORY_BIBLE_ADAPTER, binding: active, bibleSha256: identityPolicySha256(bible), generationContext, reviewConstraints };
  return freeze({ ...body, projectionSha256: identityPolicySha256(body) });
}
