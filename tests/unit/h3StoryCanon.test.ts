import { describe, expect, test } from "bun:test";
import { buildH3StoryCanonScope, type H3StoryCanonSource } from "@/components/studio/h3StoryCanon";
import { buildH3ShotPlanningInput } from "@/components/studio/h3ShotPlanning";
import { buildH3DraftPlanningInput } from "@/components/studio/h3PlannedDraftRequests";
import { buildStoryBibleBinding } from "@/components/studio/storyBibleBinding";
import { STORY_BIBLE_ADAPTER, type CanonFact, type StoryBible } from "@/components/studio/storyBible";
import { createMusicVideoProject, prepareApprovedPlacements, buildEditPlanPreviewSegments } from "@/components/studio/musicVideoProject";
import type { StoryTreatment } from "@/components/studio/storyTreatments";
import type { ReferenceAsset } from "@/components/studio/referenceAssets";

const projectId = "canon-project";
const scenes = [
  { id: "approach", direction: "Diego advances through the amber side of CLUB_MAIN.", subjects: ["Diego"] },
  { id: "recognition", direction: "Diego and Valentina exchange a look across CLUB_MAIN.", subjects: ["Diego", "Valentina"] },
  { id: "transition", direction: "Haze curls beneath the lamps in CLUB_MAIN.", subjects: [] },
];

function fixture() {
  const references: ReferenceAsset[] = [
    { id: "diego-ref", displayName: "Diego", kind: "character", role: "character-1" },
    { id: "valentina-ref", displayName: "Valentina", kind: "character", role: "character-2" },
    { id: "club-ref", displayName: "CLUB_MAIN", kind: "environment", role: "environment" },
  ].map(ref => ({ ...ref, fileName: `${ref.id}.png`, previewUrl: "", promptHint: "", storageStatus: "uploaded",
    storageBucket: "media", storagePath: `references/${ref.id}.png`, createdAt: "2026-11-09T00:00:00.000Z" } as ReferenceAsset));
  const treatment: StoryTreatment = { id: "approved-story", kind: "faithful", title: "Routes through the club",
    logline: "Diego and Valentina follow separate routes toward a shared connection.",
    synopsis: "Separate routes lead to recognition, a dance, fracture, escape, and a shared exit.",
    visualThesis: "Contrasting routes converge.", endingHook: "Haze thins along CLUB_MAIN's back corridor.",
    expectedGenerationPercent: 100, expectedReusePercent: 0,
    anchors: scenes.map(scene => ({ id: scene.id, title: scene.id, description: scene.direction, purpose: "Continue the approved route.",
      generationPrompt: scene.direction, coverage: "missing", candidates: [], selectedCandidateId: null, resolution: null })) };
  const fact = (id: string, value: string | undefined, patch: Partial<CanonFact> = {}): CanonFact => ({ id, kind: "production", value,
    state: "confirmed", visibility: "public", channel: "positive", characterIds: [], referenceAssetIds: [],
    provenance: { kind: "user", sourceIds: [id] }, ...patch });
  const bible: StoryBible = { version: 1, adapter: STORY_BIBLE_ADAPTER,
    binding: buildStoryBibleBinding({ projectId, treatment, referenceAssets: references }),
    characters: [ { id: "diego", canonicalName: "Diego", referenceAssetIds: ["diego-ref"] },
      { id: "valentina", canonicalName: "Valentina", referenceAssetIds: ["valentina-ref"] } ],
    facts: [
      fact("diego-movement", "Diego takes quick grounded steps.", { kind: "movement", characterIds: ["diego"], referenceAssetIds: ["diego-ref"] }),
      fact("valentina-movement", "Valentina pauses with a hand against the cool rail.", { kind: "stillness", characterIds: ["valentina"], referenceAssetIds: ["valentina-ref"] }),
      fact("private", "Diego keeps a private family history.", { visibility: "private", characterIds: ["diego"] }),
      fact("proposal", "Diego circles the bar.", { state: "proposed", characterIds: ["diego"] }),
      fact("unknown", undefined, { characterIds: ["diego"] }), fact("tbd", "[TBD]", { characterIds: ["diego"] }),
      fact("environment", "Amber pools and muted teal haze divide CLUB_MAIN's connected routes.", { referenceAssetIds: ["club-ref"] }),
      fact("continuity", "Never repeat a completed entrance.", { channel: "exclusion" }),
      fact("review", "Check route continuity between adjacent cuts.", { channel: "review" }),
      fact("negative-positive", "Diego never repeats a completed turn.", { characterIds: ["diego"] }),
      fact("unscoped-other-lead", "Valentina studies the distant doorway."),
      fact("whole-film-premise", "A contest becomes connection, panic and escape.", { kind: "premise" }),
      fact("biography", "Diego grew up near the sea.", { kind: "backstory", characterIds: ["diego"] }),
      fact("story-logline", treatment.logline, { provenance: { kind: "approved-story", sourceIds: [`${treatment.id}:logline`] } }),
      fact("story-synopsis", treatment.synopsis, { provenance: { kind: "approved-story", sourceIds: [`${treatment.id}:synopsis`] } }),
      fact("story-ending", treatment.endingHook, { provenance: { kind: "approved-story", sourceIds: [`${treatment.id}:endingHook`] } }),
      ...scenes.map(scene => fact(`anchor-${scene.id}`, scene.direction, { provenance: { kind: "approved-story", sourceIds: [scene.id] } })),
    ],
    relationships: [{ id: "connection", fromCharacterId: "diego", toCharacterId: "valentina", value: "Diego and Valentina watch for each other's approach.",
      state: "confirmed", visibility: "public", channel: "positive", provenance: { kind: "user", sourceIds: ["pair-direction"] } }],
  };
  treatment.storyBible = bible;
  const draft = createMusicVideoProject({ id: projectId, analysis: null, duration: 15, videoSources: [], createdAt: "2026-11-09T00:00:00.000Z",
    storyDrafts: scenes.map((scene, index) => ({ id: scene.id, label: scene.id, start: index * 5, end: (index + 1) * 5, prompt: scene.direction })) });
  for (const [index, item] of draft.editPlan.timelineItems.entries()) {
    item.narrativeMomentId = scenes[index].id; item.requirementId = `${scenes[index].id}-shot`;
    item.requirements = { subjects: scenes[index].subjects, setting: "CLUB_MAIN" };
  }
  const project = prepareApprovedPlacements({ project: draft, videoSources: [], editSettings: { cutDensity: 1, preferOnsets: true } });
  const segments = buildEditPlanPreviewSegments({ project, videoSources: [] });
  const source: H3StoryCanonSource = { treatment, references };
  const scope = (index: number) => buildH3StoryCanonScope(projectId, source, {
    narrativeMomentId: scenes[index].id, requirementId: `${scenes[index].id}-shot`, approvedDirection: scenes[index].direction,
    constraints: { subjects: scenes[index].subjects, setting: "CLUB_MAIN" },
  })!;
  const input = (canonSource = source) => buildH3ShotPlanningInput({ projectId, project, segments, subjectNames: ["Diego", "Valentina"], storyCanonSource: canonSource });
  return { source, bible, treatment, references, project, segments, scope, input };
}

describe("scoped story canon in H3 shot planning", () => {
  test("solo Diego gets exact declared name/ref scope without another lead, private, proposed or unknown canon", () => {
    const { scope } = fixture(), solo = scope(0);
    expect(solo.subjectNames).toEqual(["Diego"]);
    expect(solo.referenceAssetIds).toEqual(["diego-ref", "club-ref"]);
    expect(solo.positiveFacts.map(fact => fact.id)).toEqual(["diego-movement", "environment", "anchor-approach"]);
    const serialized = JSON.stringify(solo);
    for (const forbidden of ["Valentina", "private family", "circles the bar", "[TBD]", "connection", "grew up"]) expect(serialized).not.toContain(forbidden);
    expect(solo.reviewConstraints.map(fact => fact.id)).toEqual(["continuity", "review", "negative-positive"]);
    expect(solo.positiveFacts.some(fact => fact.text.includes("never"))).toBe(false);
  });

  test("duo admits the relationship while environment-only shots exclude all named lead context", () => {
    const { scope } = fixture(), duo = scope(1), environment = scope(2);
    expect(duo.subjectNames).toEqual(["Diego", "Valentina"]);
    expect(duo.referenceAssetIds).toEqual(["diego-ref", "valentina-ref", "club-ref"]);
    expect(duo.positiveFacts.find(fact => fact.id === "connection")?.text).toBe("Diego and Valentina watch for each other's approach.");
    expect(environment.subjectNames).toEqual([]); expect(environment.referenceAssetIds).toEqual(["club-ref"]);
    expect(environment.positiveFacts.map(fact => fact.id)).toEqual(["environment", "story-ending", "anchor-transition"]);
    expect(JSON.stringify(environment)).not.toMatch(/Diego|Valentina/);
    expect(environment.reviewConstraints.map(fact => fact.id)).toEqual(["continuity", "review"]);
  });

  for (const inventory of ["partial", "empty"] as const) test(`${inventory} Bible inventory preserves visible named-reference subjects and excludes unselected lead prose`, () => {
    const f = fixture();
    const characters = inventory === "partial" ? f.bible.characters.filter(character => character.id === "valentina") : [];
    const ids = new Set(characters.map(character => character.id));
    // Both forms are valid canon contracts: facts do not refer to omitted character IDs.
    const bible: StoryBible = { ...f.bible, characters,
      facts: f.bible.facts.filter(fact => fact.characterIds.every(id => ids.has(id))), relationships: [] };
    const source = { treatment: { ...f.treatment, storyBible: bible }, references: f.references };
    const input = f.input(source), solo = input.groups[0].storyCanon!, duo = input.groups[1].storyCanon!, environment = input.groups[2].storyCanon!;
    expect(solo.subjectNames).toEqual(["Diego"]);
    expect(solo.referenceAssetIds).toEqual(["diego-ref", "club-ref"]);
    expect(solo.positiveFacts.some(fact => fact.id === "anchor-approach")).toBe(true);
    expect(JSON.stringify(solo)).not.toContain("Valentina");
    expect(duo.subjectNames).toEqual(["Diego", "Valentina"]);
    expect(duo.referenceAssetIds).toEqual(["diego-ref", "valentina-ref", "club-ref"]);
    expect(environment.subjectNames).toEqual([]);
    expect(environment.referenceAssetIds).toEqual(["club-ref"]);
    expect(JSON.stringify(environment)).not.toMatch(/Diego|Valentina/);
    const group = { narrativeMomentId: "approach", approvedDirection: scenes[0].direction, constraints: { subjects: ["Diego", "Valentina"] } };
    expect(() => buildH3StoryCanonScope(projectId, source, group)).toThrow("disagree");
    expect(() => buildH3StoryCanonScope(projectId, source, { ...group, constraints: { subjects: [] } })).toThrow("disagree");
  });

  test("each group receives its approved anchor only and never replays premise/synopsis or an early ending", () => {
    const { input, treatment } = fixture(), actual = input();
    expect(actual.groups.map(group => group.storyCanon?.positiveFacts.filter(fact => fact.id.startsWith("anchor-")).map(fact => fact.id)))
      .toEqual([["anchor-approach"], ["anchor-recognition"], ["anchor-transition"]]);
    for (const group of actual.groups) {
      expect(Boolean(group.storyCanon)).toBe(true);
      const ids = group.storyCanon!.positiveFacts.map(fact => fact.id);
      for (const id of ["whole-film-premise", "story-logline", "story-synopsis", "biography"]) expect(ids).not.toContain(id);
      if (group.narrativeMomentId !== treatment.anchors.at(-1)?.id) expect(ids).not.toContain("story-ending");
    }
  });

  test("rejects stale project/story/reference bindings, renamed leads and direction/required-subject disagreement", () => {
    const { source, input } = fixture();
    const group = { narrativeMomentId: "approach", approvedDirection: scenes[0].direction, constraints: { subjects: ["Diego"] } };
    expect(() => buildH3StoryCanonScope("different-project", source, group)).toThrow("stale");
    expect(() => input({ ...source, treatment: { ...source.treatment, synopsis: "Changed route." } })).toThrow("stale");
    expect(() => input({ ...source, references: source.references.map(ref => ({ ...ref, storagePath: `new/${ref.id}.png` })) })).toThrow("stale");
    expect(() => input({ ...source, references: source.references.map(ref => ref.id === "diego-ref" ? { ...ref, displayName: "Different declared name" } : ref) })).toThrow("named character references");
    expect(() => buildH3StoryCanonScope(projectId, source, { ...group, constraints: { subjects: ["Diego", "Valentina"] } })).toThrow("disagree");
  });

  test("fresh reference metadata changes scoped and full input hashes while retaining semantic facts", () => {
    const f = fixture(), before = f.input(), references = f.references.map(ref => ref.id === "club-ref" ? { ...ref, storagePath: "references/club-v2.png" } : ref);
    const treatment = { ...f.treatment, storyBible: { ...f.bible,
      binding: buildStoryBibleBinding({ projectId, treatment: f.treatment, referenceAssets: references }) } };
    const after = f.input({ treatment, references });
    expect(after.bindingSha256).not.toBe(before.bindingSha256);
    expect(after.groups[0].storyCanon?.scopeSha256).not.toBe(before.groups[0].storyCanon?.scopeSha256);
    expect(after.groups[0].storyCanon?.projectionSha256).not.toBe(before.groups[0].storyCanon?.projectionSha256);
    expect(after.groups[0].storyCanon?.positiveFacts).toEqual(before.groups[0].storyCanon?.positiveFacts);
    expect(after.groups[0].storyCanon?.referenceAssetIds).toEqual(before.groups[0].storyCanon?.referenceAssetIds);
    expect(before.groups[0].storyCanon?.subjectNames).toEqual(["Diego"]);
  });

  test("draft wrapper carries confirmed Bible scope but no-Bible optional source preserves legacy bytes and hash", () => {
    const { treatment, project, references, segments } = fixture();
    const withoutBible = { ...treatment }; delete withoutBible.storyBible;
    const legacy = buildH3ShotPlanningInput({ projectId, project, segments, subjectNames: ["Diego", "Valentina"] });
    const noBible = buildH3ShotPlanningInput({ projectId, project, segments, subjectNames: ["Diego", "Valentina"], storyCanonSource: { treatment: withoutBible, references } });
    expect(JSON.stringify(noBible)).toBe(JSON.stringify(legacy));
    expect(noBible.groups.every(group => !Object.hasOwn(group, "storyCanon"))).toBe(true);
    const wrapperLegacy = buildH3DraftPlanningInput(projectId, project, references);
    const wrapperNoBible = buildH3DraftPlanningInput(projectId, project, references, { confirmedTreatment: withoutBible });
    expect(JSON.stringify(wrapperNoBible)).toBe(JSON.stringify(wrapperLegacy));
    const scoped = buildH3DraftPlanningInput(projectId, project, references, { confirmedTreatment: treatment });
    expect(scoped.groups[0].storyCanon?.subjectNames).toEqual(["Diego"]);
    expect(scoped.bindingSha256).not.toBe(wrapperLegacy.bindingSha256);
    expect(buildH3StoryCanonScope(projectId, { treatment: withoutBible, references: [] }, { approvedDirection: "Legacy input", constraints: {} })).toBe(undefined);
    // Fixed legacy-body compatibility vector: the HEAD diff adds only an optional canon branch.
    expect(legacy.bindingSha256).toBe("0f6250f071515ecd3fbb10e3cab962765c2317d1341b00264342457fa89c7645");
  });
});
