import { describe, expect, test } from "bun:test";
import { buildStoryBibleBinding } from "@/components/studio/storyBibleBinding";
import { canRebindStoryBible, confirmStoryBibleFact, confirmStoryBibleRelationship, editStoryBibleFact, editStoryBibleRelationship,
  importApprovedStoryBible, importStoryBibleJson, rebindStoryBible, removeStoryBibleRelationship, startStoryBibleWithCurrentReferences,
  storyBibleTextPatch, validateStoryBibleForAuthoring, type StoryBibleAuthoringContext } from "@/components/studio/storyBibleAuthoring";
import type { ReferenceAsset } from "@/components/studio/referenceAssets";
import { projectStoryBible, type StoryBible } from "@/components/studio/storyBible";
import type { StoryTreatment } from "@/components/studio/storyTreatments";

function context(): StoryBibleAuthoringContext {
  const treatment: StoryTreatment = { id: "story-one", kind: "faithful", title: "Club", logline: "Diego crosses the club.",
    synopsis: "Diego follows a warm route. Valentina follows a cool route.", visualThesis: "Unreviewed visual thesis", endingHook: "Diego and Valentina leave together.",
    expectedGenerationPercent: 100, expectedReusePercent: 0,
    anchors: [{ id: "crossing", title: "Crossing", description: "Diego and Valentina recognize each other across a passing crowd.",
      purpose: "Recognition", generationPrompt: "Unreviewed model prompt", candidates: [], selectedCandidateId: null, resolution: null, coverage: "missing" }] };
  const referenceAssets: ReferenceAsset[] = ["Diego", "Valentina"].map(name => ({ id: name.toLowerCase(), displayName: name, kind: "character",
    role: name === "Diego" ? "character-1" : "character-2", fileName: `${name}-sheet.png`, previewUrl: "", promptHint: "",
    storageStatus: "uploaded", storageBucket: "media", storagePath: `refs/${name}.png`, createdAt: "2026-11-09T00:00:00Z" }));
  return { treatment, confirmedTreatment: structuredClone(treatment), referenceAssets,
    binding: buildStoryBibleBinding({ projectId: "project-one", treatment, referenceAssets }) };
}
function proposal(bible: StoryBible): StoryBible {
  return { ...bible, facts: [...bible.facts, { id: "user-move", kind: "movement", value: "Diego takes quick grounded steps.", state: "confirmed",
    visibility: "private", channel: "review", characterIds: ["diego"], referenceAssetIds: ["diego"], provenance: { kind: "user", sourceIds: ["user-move"] } }] };
}

describe("story bible local authoring", () => {
  test("imports only exact confirmed source prose and explicit reference labels", () => {
    const current = context(), bible = importApprovedStoryBible(current);
    expect(bible.characters.map(character => character.canonicalName)).toEqual(["Diego", "Valentina"]);
    expect(bible.facts.map(fact => fact.value)).toEqual([current.treatment.logline, current.treatment.synopsis, current.treatment.endingHook, current.treatment.anchors[0].description]);
    expect(bible.facts.every(fact => fact.state === "confirmed" && fact.provenance.kind === "approved-story")).toBe(true);
    expect(bible.facts.some(fact => ["backstory", "psychology", "thesis", "voice"].includes(fact.kind))).toBe(false);
    expect(JSON.stringify(bible)).not.toContain("Unreviewed");
    expect(() => importApprovedStoryBible({ ...current, confirmedTreatment: null })).toThrow("Confirm");
    expect(() => importApprovedStoryBible({ ...current, confirmedTreatment: { ...current.treatment, logline: "A different story." } })).toThrow("Confirm");
  });
  test("rejects stale source, stale reference bytes metadata and wrong project imports", () => {
    const current = context(), bible = importApprovedStoryBible(current);
    expect(() => validateStoryBibleForAuthoring(bible, { ...current, treatment: { ...current.treatment, synopsis: "Revised." } })).toThrow("story changed");
    expect(() => validateStoryBibleForAuthoring(bible, { ...current, referenceAssets: current.referenceAssets.map(ref => ({ ...ref, storagePath: `other/${ref.id}` })) })).toThrow("reference set changed");
    expect(() => importStoryBibleJson(JSON.stringify({ ...bible, binding: { ...bible.binding, projectId: "elsewhere" } }), current)).toThrow("different project");
  });
  test("refuses missing and unuploaded character refs and undeclared imported names", () => {
    const current = context(), bible = importApprovedStoryBible(current);
    expect(() => validateStoryBibleForAuthoring({ ...bible, characters: [{ ...bible.characters[0], referenceAssetIds: ["missing"] }] }, current)).toThrow("uploaded character");
    expect(() => importApprovedStoryBible({ ...current, referenceAssets: current.referenceAssets.map(ref => ({ ...ref, storageStatus: "local" })) })).toThrow("uploaded");
    expect(() => importStoryBibleJson(JSON.stringify({ ...bible, characters: [{ ...bible.characters[0], canonicalName: "Somebody else" }] }), current)).toThrow("Declared character names");
    expect(() => validateStoryBibleForAuthoring({ ...bible, facts: [{ ...bible.facts[0], referenceAssetIds: ["missing"] }] }, current)).toThrow("missing or unuploaded");
  });
  test("import cannot manufacture approval and preserves private, review and proposed states", () => {
    const current = context(), bible = importApprovedStoryBible(current), incoming = proposal(bible);
    const imported = importStoryBibleJson(JSON.stringify(incoming), current);
    expect(imported.facts.at(-1)).toMatchObject({ state: "proposed", visibility: "private", channel: "review" });
    expect(imported.facts[0].state).toBe("confirmed");
    const proposedSource = { ...bible, facts: [{ ...bible.facts[0], state: "proposed" as const }] };
    expect(importStoryBibleJson(JSON.stringify(proposedSource), current).facts[0].state).toBe("proposed");
    expect(importStoryBibleJson(JSON.stringify(incoming), current, incoming).facts.at(-1)?.state).toBe("confirmed");
    const changed = { ...incoming, facts: incoming.facts.map(fact => fact.id === "user-move" ? { ...fact, value: "Changed movement." } : fact) };
    expect(importStoryBibleJson(JSON.stringify(changed), current, incoming).facts.at(-1)?.state).toBe("proposed");
  });
  test("character mapping changes cannot inherit existing scoped confirmation", () => {
    const current = context(), bible = proposal(importApprovedStoryBible(current));
    const renamed = { ...bible, characters: bible.characters.map(character => ({ ...character, canonicalName: character.canonicalName === "Diego" ? "Diego declared" : character.canonicalName })) };
    const incoming = { ...renamed, facts: bible.facts };
    expect(() => importStoryBibleJson(JSON.stringify(incoming), current, bible)).toThrow("Declare");
    expect(() => importStoryBibleJson(JSON.stringify(incoming), current, renamed)).toThrow("Declare");
  });
  test("fact edits lose confirmation while explicit review preserves privacy and channel", () => {
    const bible = proposal(importApprovedStoryBible(context())), changed = editStoryBibleFact(bible, "user-move", { value: "Diego turns toward the rail." });
    expect(changed.facts.at(-1)).toMatchObject({ state: "proposed", visibility: "private", channel: "review", provenance: { kind: "user", sourceIds: ["user-move"] } });
    expect(confirmStoryBibleFact(changed, "user-move").facts.at(-1)).toMatchObject({ state: "confirmed", visibility: "private", channel: "review" });
    expect(bible.facts.at(-1)?.value).toBe("Diego takes quick grounded steps.");
    expect(() => confirmStoryBibleFact(editStoryBibleFact(bible, "user-move", { value: "TBD" }), "user-move")).toThrow("known fact");
    expect(() => editStoryBibleFact(bible, "missing", { value: "Bad" })).toThrow("existing");
  });
  test("only explicit same-project same-reference story rebind preserves fact decisions", () => {
    const current = context(), bible = proposal(importApprovedStoryBible(current)), revised = { ...current.treatment, synopsis: "A revised route." };
    const next = { ...current, treatment: revised, binding: buildStoryBibleBinding({ projectId: current.binding.projectId, treatment: revised, referenceAssets: current.referenceAssets }) };
    expect(canRebindStoryBible(bible, next)).toBe(true);
    const rebound = rebindStoryBible(bible, next);
    expect(rebound.binding).toEqual(next.binding); expect(rebound.facts).toEqual(bible.facts); expect(rebound.characters).toEqual(bible.characters);
    expect(() => validateStoryBibleForAuthoring(bible, next)).toThrow("different");
    expect(canRebindStoryBible(bible, current)).toBe(false);
    expect(canRebindStoryBible(bible, { ...next, binding: { ...next.binding, projectId: "copy" } })).toBe(false);
    const changedRefs = next.referenceAssets.map(ref => ({ ...ref, storagePath: `${ref.storagePath}-new` }));
    const changed = { ...next, referenceAssets: changedRefs, binding: buildStoryBibleBinding({ projectId: "project-one", treatment: revised, referenceAssets: changedRefs }) };
    expect(() => rebindStoryBible(bible, changed)).toThrow("Only a story revision");
  });
  test("bounds imports before parsing", () => {
    expect(() => importStoryBibleJson(" ".repeat(65537), context())).toThrow("64 KB");
    expect(() => importStoryBibleJson("{", context())).toThrow();
  });
  test("explicit recovery creates current empty canon without inheriting source or reference approval", () => {
    const original = context(), old = proposal(importApprovedStoryBible(original));
    const referenceAssets = original.referenceAssets.map(ref => ({ ...ref, id: `${ref.id}-new`, displayName: `${ref.displayName} current`, storagePath: `new/${ref.id}` }));
    const current = { ...original, confirmedTreatment: null, referenceAssets,
      binding: buildStoryBibleBinding({ projectId: "copied-project", treatment: original.treatment, referenceAssets }) };
    expect(canRebindStoryBible(old, current)).toBe(false);
    const next = startStoryBibleWithCurrentReferences(current);
    expect(next.binding).toEqual(current.binding);
    expect(next.characters.map(character => character.canonicalName)).toEqual(["Diego current", "Valentina current"]);
    expect(next.facts).toEqual([]); expect(next.relationships).toEqual([]);
    expect(JSON.stringify(old)).toContain("Diego takes quick grounded steps.");
    expect(() => importApprovedStoryBible(current)).toThrow("Confirm");
    const stale = { ...current, binding: original.binding };
    expect(() => startStoryBibleWithCurrentReferences(stale)).toThrow("reference set changed");
  });
  test("metadata changes commit the editor's pending text as a single unconfirmed proposal", () => {
    const bible = importApprovedStoryBible(context()), original = bible.facts[0];
    const visibility = editStoryBibleFact(bible, original.id, storyBibleTextPatch("  Newly typed direction.  ", { visibility: "private" }));
    expect(visibility.facts[0]).toMatchObject({ value: "Newly typed direction.", visibility: "private", state: "proposed" });
    const channel = editStoryBibleFact(visibility, original.id, storyBibleTextPatch("Another unsaved line.", { channel: "review" }));
    expect(channel.facts[0]).toMatchObject({ value: "Another unsaved line.", channel: "review", visibility: "private", state: "proposed" });
    expect(bible.facts[0]).toEqual(original);
  });
  test("imported relationship proposals have explicit review/edit/remove without changing privacy or channel", () => {
    const current = context(), source = importApprovedStoryBible(current);
    const incoming: StoryBible = { ...source, relationships: [{ id: "connection", fromCharacterId: "diego", toCharacterId: "valentina",
      value: "Diego and Valentina exchange a questioning look.", state: "confirmed", visibility: "private", channel: "review",
      provenance: { kind: "user", sourceIds: ["relationship-note"] } }] };
    const imported = importStoryBibleJson(JSON.stringify(incoming), current);
    expect(imported.relationships[0].state).toBe("proposed");
    const reviewed = confirmStoryBibleRelationship(imported, "connection");
    expect(reviewed.relationships[0]).toMatchObject({ state: "confirmed", visibility: "private", channel: "review", provenance: { sourceIds: ["relationship-note"] } });
    const selection = { binding: current.binding, characterIds: ["diego", "valentina"], referenceAssetIds: ["diego", "valentina"] };
    expect(projectStoryBible(reviewed, selection).generationContext.some(item => item.kind === "relationship")).toBe(false);
    const publicProposal = editStoryBibleRelationship(reviewed, "connection", { visibility: "public", channel: "positive" });
    expect(projectStoryBible(publicProposal, selection).generationContext.some(item => item.kind === "relationship")).toBe(false);
    const publicConfirmed = confirmStoryBibleRelationship(publicProposal, "connection");
    expect(projectStoryBible(publicConfirmed, selection).generationContext.find(item => item.kind === "relationship")?.text).toBe(incoming.relationships[0].value);
    const edited = editStoryBibleRelationship(reviewed, "connection", storyBibleTextPatch("A new shared action.", { channel: "exclusion" }));
    expect(edited.relationships[0]).toMatchObject({ state: "proposed", value: "A new shared action.", visibility: "private", channel: "exclusion",
      fromCharacterId: "diego", toCharacterId: "valentina", provenance: { kind: "user", sourceIds: ["connection"] } });
    expect(removeStoryBibleRelationship(edited, "connection").relationships).toEqual([]);
    expect(imported.relationships).toHaveLength(1);
    expect(() => editStoryBibleRelationship(imported, "missing", {})).toThrow("existing");
    expect(() => removeStoryBibleRelationship(imported, "missing")).toThrow("existing");
    for (const value of [undefined, "", "TBD", "unknown", "[unspecified]", "N/A", "?"]) {
      const unknown = { ...imported, relationships: imported.relationships.map(relation => ({ ...relation, value })) };
      expect(() => confirmStoryBibleRelationship(unknown, "connection")).toThrow("known fact");
    }
    expect(() => editStoryBibleRelationship(imported, "connection", { value: "x".repeat(1601) })).toThrow();
  });
});
