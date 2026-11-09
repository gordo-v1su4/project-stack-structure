import { describe, expect, test } from "bun:test";
import { normalizeStoryBible, projectStoryBible, STORY_BIBLE_ADAPTER, type CanonFact, type StoryBible } from "@/components/studio/storyBible";

function fixture(): StoryBible {
  const fact = (id: string, value?: string, overrides: Partial<CanonFact> = {}): CanonFact => ({
    id, kind: "movement", state: "confirmed", visibility: "public", channel: "positive", value,
    characterIds: ["diego"], referenceAssetIds: [], provenance: { kind: "user", sourceIds: ["approved-edit-1"] }, ...overrides });
  return { version: 1, adapter: { ...STORY_BIBLE_ADAPTER }, binding: { projectId: "project-1", storySignature: "approved-story", referenceSignature: "reference-v1" },
    characters: [{ id: "diego", canonicalName: "Diego", referenceAssetIds: ["diego-sheet"] }, { id: "valentina", canonicalName: "Valentina", referenceAssetIds: ["valentina-sheet"] }],
    facts: [fact("move", "Measured forward steps with grounded weight."), fact("stillness", "Hands rest on the rail.", { kind: "stillness" }),
      fact("unknown"), fact("tbd", "[TBD]"), fact("empty", ""), fact("proposal", "A proposed backstory.", { state: "proposed" }),
      fact("private", "A private unknown history.", { visibility: "private" }), fact("other", "Valentina pivots toward the doorway.", { characterIds: ["valentina"] }),
      fact("exclude", "Never repeat a completed doorway entry.", { kind: "production", channel: "exclusion" }),
      fact("negative", "Diego never releases the rail.", { channel: "positive" }),
      fact("reference-scope", "One narrow amber pool of light.", { kind: "production", characterIds: [], referenceAssetIds: ["club-sheet"] })],
    relationships: [{ id: "pair", fromCharacterId: "diego", toCharacterId: "valentina", value: "Diego and Valentina watch for each other's approach.",
      state: "confirmed", visibility: "public", channel: "positive", provenance: { kind: "approved-story", sourceIds: ["beat-1"] } }] };
}
const selection = (bible: StoryBible) => ({ binding: bible.binding, characterIds: ["diego"], referenceAssetIds: ["diego-sheet"] });

describe("versioned product story bible", () => {
  test("projects only confirmed known selected canon and keeps negatives in review constraints", () => {
    const bible = fixture(), result = projectStoryBible(bible, selection(bible));
    expect(result.generationContext.map(fact => fact.id)).toEqual(["move", "stillness"]);
    expect(result.generationContext[0].characterNames).toEqual(["Diego"]);
    expect(result.generationContext[0].text).toBe("Measured forward steps with grounded weight.");
    expect(result.reviewConstraints.map(fact => fact.id)).toEqual(["exclude", "negative"]);
    const output = JSON.stringify(result);
    for (const excluded of ["[TBD]", "A proposed backstory", "A private unknown history", "Valentina pivots", "narrow amber"]) expect(output).not.toContain(excluded);
  });
  test("selects by canonical reference IDs and admits relationships only when both named participants are selected", () => {
    const bible = fixture();
    const one = projectStoryBible(bible, { binding: bible.binding, characterIds: [], referenceAssetIds: ["diego-sheet", "club-sheet"] });
    expect(one.generationContext.map(fact => fact.id)).toContain("reference-scope");
    expect(one.generationContext.some(fact => fact.kind === "relationship")).toBe(false);
    const both = projectStoryBible(bible, { binding: bible.binding, characterIds: ["diego", "valentina"], referenceAssetIds: [] });
    expect(both.generationContext.find(fact => fact.kind === "relationship")?.characterNames).toEqual(["Diego", "Valentina"]);
  });
  test("requires exact current project/story/reference bindings and supported adapter provenance", () => {
    const bible = fixture();
    for (const key of ["projectId", "storySignature", "referenceSignature"] as const) {
      expect(() => projectStoryBible(bible, { ...selection(bible), binding: { ...bible.binding, [key]: "changed" } })).toThrow("stale");
    }
    for (const mutate of [(v: StoryBible) => { (v as { version: number }).version = 2; },
      (v: StoryBible) => { v.adapter = { ...v.adapter, sha256: "a".repeat(64) }; },
      (v: StoryBible) => { v.adapter = { ...v.adapter, sourceSkillSha256: "b".repeat(64) } as typeof STORY_BIBLE_ADAPTER; }]) {
      const changed = structuredClone(bible); mutate(changed); expect(() => projectStoryBible(changed, selection(bible))).toThrow();
    }
  });
  test("normalizes detached immutable JSON, preserves exact names, and changes digest when confirmed canon changes", () => {
    const bible = fixture(), normalized = normalizeStoryBible(bible), before = projectStoryBible(bible, selection(bible));
    expect(Object.isFrozen(normalized)).toBe(true); expect(Object.isFrozen(normalized.facts[0].provenance.sourceIds)).toBe(true);
    bible.characters[0].canonicalName = "Diego changed";
    expect(normalized.characters[0].canonicalName).toBe("Diego");
    expect(projectStoryBible(JSON.parse(JSON.stringify(normalized)), selection(normalized))).toEqual(before);
    const changed = structuredClone(normalized); changed.facts[0].value = "Small quick forward steps.";
    expect(projectStoryBible(changed, selection(changed)).projectionSha256).not.toBe(before.projectionSha256);
  });
  test("rejects malformed/unknown fields, appearance synthesis kinds, ambiguous IDs and bounded overflows", () => {
    const changes = [(v: StoryBible) => { v.characters = Array(17).fill(v.characters[0]); },
      (v: StoryBible) => { v.facts = Array(65).fill(v.facts[0]); }, (v: StoryBible) => { v.relationships = Array(33).fill(v.relationships[0]); },
      (v: StoryBible) => { v.characters[1].canonicalName = "diego"; }, (v: StoryBible) => { v.facts[0].characterIds = ["missing"]; },
      (v: StoryBible) => { v.facts[0].id = v.facts[1].id; }, (v: StoryBible) => { v.facts[0].value = "x".repeat(1601); },
      (v: StoryBible) => { v.facts[0].provenance.sourceIds = []; }, (v: StoryBible) => { v.facts[0].kind = "appearance" as "movement"; },
      (v: StoryBible) => { v.facts[0].state = ["confirmed"] as unknown as "confirmed"; },
      (v: StoryBible) => { Object.assign(v.facts[0], { prompt: "injected" }); }];
    for (const change of changes) { const bible = fixture(); change(bible); expect(() => normalizeStoryBible(bible)).toThrow(); }
    const oversized = fixture(); oversized.facts = Array.from({ length: 64 }, (_, index) => ({ ...oversized.facts[0], id: `f${index}`, value: "界".repeat(1500) }));
    expect(() => normalizeStoryBible(oversized)).toThrow();
    expect(() => normalizeStoryBible({ ...fixture(), binding: new Date() })).toThrow();
    expect(() => projectStoryBible(fixture(), { ...selection(fixture()), characterIds: ["invented"] })).toThrow("canonical");
  });
});
