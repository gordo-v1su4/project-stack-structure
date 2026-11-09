import { describe, expect, test } from "bun:test";
import { STORY_BIBLE_ADAPTER, type StoryBible } from "@/components/studio/storyBible";
import { buildStoryContentSignature, parseGeneratedTreatment, storyBibleTreatmentSignature, type StoryTreatment, type StoryTreatmentState } from "@/components/studio/storyTreatments";
import { buildStoryDraftCommit, markStoryEdited } from "@/components/studio/storyAuthoring";
import { normalizePersistedStoryState, type PersistedStoryState } from "@/components/studio/projectPersistence";

function treatment(): StoryTreatment {
  return parseGeneratedTreatment({ id: "one", kind: "faithful", title: "Arrival", logline: "Diego enters the club.", synopsis: "Diego arrives. Diego dances. Diego leaves.",
    visualThesis: "Warm stone and moving light.", endingHook: "Diego leaves.", structure: "visual-arc", anchors: ["arrival", "departure"].map(id => ({
      id, title: id, description: `Diego performs ${id}.`, purpose: "Show the journey.", generationPrompt: `Diego performs ${id}.`,
      requirements: [{ id: `${id}-shot`, momentId: id, description: `Diego performs ${id}.`, constraints: { subjects: ["Diego"] } }],
    })) }) as StoryTreatment;
}
function bible(story: StoryTreatment): StoryBible {
  return { version: 1, adapter: STORY_BIBLE_ADAPTER, binding: { projectId: "project-one", storySignature: storyBibleTreatmentSignature(story), referenceSignature: "refs-one" },
    characters: [], facts: [{ id: "premise", kind: "premise", value: "A journey through the club.", state: "confirmed", visibility: "public", channel: "positive", characterIds: [], referenceAssetIds: [], provenance: { kind: "user", sourceIds: ["brief"] } }], relationships: [] };
}
function persisted(story: StoryTreatment): PersistedStoryState {
  return { vocalStemName: "", transcriptSummary: null, storyBeats: [], activeBeatId: "", storyGenerated: true, treatments: [story],
    confirmedTreatmentId: story.id, confirmedTreatmentSnapshot: story, storyContentSignature: buildStoryContentSignature(story, []) };
}
function legacySignature(story: StoryTreatment) {
  const payload = JSON.stringify({ treatment: { id: story.id, title: story.title, logline: story.logline, synopsis: story.synopsis, revision: story.revision,
    loglineElements: story.loglineElements, reconciliation: story.reconciliation, sectionAnchorIds: story.sectionAnchorIds,
    anchors: story.anchors.map(a => ({ id: a.id, title: a.title, description: a.description, requirements: a.requirements, songWindow: a.songWindow,
      role: a.role, causalDependencies: a.causalDependencies, optional: a.optional, resolution: a.resolution, selectedCandidateId: a.selectedCandidateId })) }, timing: [] });
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) hash = Math.imul(hash ^ payload.charCodeAt(i), 0x01000193);
  return `story-v2-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

describe("story bible treatment foundation", () => {
  test("absent bible preserves historical signature bytes and never invents canon", () => {
    const story = treatment();
    expect(buildStoryContentSignature(story, [])).toBe(legacySignature(story));
    expect(normalizePersistedStoryState(persisted(story), false).confirmedTreatmentSnapshot?.storyBible).toBe(undefined);
  });
  test("generated parser and persisted reload retain detached normalized canon", () => {
    const story = treatment(); story.storyBible = bible(story);
    const parsed = parseGeneratedTreatment(JSON.parse(JSON.stringify(story)));
    expect(parsed.storyBible).toEqual(story.storyBible);
    const reloaded = normalizePersistedStoryState(JSON.parse(JSON.stringify(persisted(story))), false);
    expect(reloaded.confirmedTreatmentSnapshot?.storyBible).toEqual(story.storyBible);
    expect(reloaded.confirmedTreatmentSnapshot?.storyBible).not.toBe(story.storyBible);
    expect(reloaded.storyContentSignature).toBe(buildStoryContentSignature(story, []));
    expect(() => parseGeneratedTreatment({ ...story, storyBible: { ...story.storyBible, version: 99 } })).toThrow();
    expect(() => normalizePersistedStoryState(persisted({ ...story, storyBible: { ...story.storyBible!, facts: "invalid" } as unknown as StoryBible }), false)).toThrow();
    const malformedSnapshot = { ...persisted(story), treatments: [], confirmedTreatmentSnapshot: { ...story, storyBible: null } as unknown as StoryTreatment };
    expect(() => normalizePersistedStoryState(malformedSnapshot, false)).toThrow();
  });
  test("canon edits mark pending and invalidate the confirmed treatment", () => {
    const original = treatment(); original.storyBible = bible(original);
    const next = markStoryEdited(original, { ...original, storyBible: { ...original.storyBible, facts: [] } });
    expect(next.reconciliation?.status).toBe("pending");
    expect(next.revision).toBe((original.revision ?? 0) + 1);
    const state = { ...persisted(original), brief: { text: "" }, selectedTreatmentId: original.id, generationMeta: null } as StoryTreatmentState;
    const commit = buildStoryDraftCommit(state, next);
    expect(commit.invalidatesConfirmed).toBe(true);
    expect(commit.patch.confirmedTreatmentSnapshot).toBeNull();
    expect(commit.patch.storyContentSignature).toBeNull();
  });
  test("all previously omitted authored direction fields enter strong canon signature", () => {
    const original = treatment(); original.storyBible = bible(original);
    const baseline = buildStoryContentSignature(original, []);
    expect(baseline).toMatch(/^story-v3-[a-f0-9]{64}$/);
    for (const mutate of [
      (t: StoryTreatment) => { t.visualThesis += " Edited."; }, (t: StoryTreatment) => { t.endingHook += " Edited."; },
      (t: StoryTreatment) => { t.anchors[0].purpose += " Edited."; }, (t: StoryTreatment) => { t.anchors[0].generationPrompt += " Edited."; },
    ]) {
      const next = structuredClone(original); mutate(next);
      expect(buildStoryContentSignature(next, [])).not.toBe(baseline);
      expect(markStoryEdited(original, next).reconciliation?.status).toBe("pending");
    }
  });
  test("baseline binding has no bible cycle or matching/revision dependence", () => {
    const story = treatment(), baseline = storyBibleTreatmentSignature(story);
    story.storyBible = bible(story);
    expect(storyBibleTreatmentSignature(story)).toBe(baseline);
    story.storyBible.binding.storySignature = "stale-binding";
    story.revision = 100; story.reconciliation = { status: "pending", note: "Changed." };
    story.anchors[0].selectedCandidateId = "candidate"; story.anchors[0].resolution = "generate";
    if (story.anchors[0].requirements?.[0]) story.anchors[0].requirements[0].resolution = "omit";
    expect(storyBibleTreatmentSignature(story)).toBe(baseline);
  });
});
