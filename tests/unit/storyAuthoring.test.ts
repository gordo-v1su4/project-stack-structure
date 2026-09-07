import { createPersistableStudioProjectDraft, hydrateStudioProjectDraft } from "@/components/studio/projectPersistence";
import { describe, expect, test } from "bun:test";
import { beginStoryInspection, buildStoryDraftCommit, createStoryRequestGuard, describeStoryRevision, getStoryTimingError, markStoryEdited, mergeStoryRevision, validateStoryAuthoring } from "@/components/studio/storyAuthoring";
import { hydrateTreatmentCoverage, isStoryPlanConfirmable, parseGeneratedTreatment, parseStoryTreatmentRequest, type StoryTreatment } from "@/components/studio/storyTreatments";

function fixture(): StoryTreatment {
  return hydrateTreatmentCoverage([parseGeneratedTreatment({
    id: "story-one", kind: "faithful", title: "The encounter", logline: "When a storm traps Diego, Diego must find shelter despite a locked entrance, or remain outside.",
    loglineElements: { incident: "A storm traps Diego", protagonist: "Diego", goal: "Find shelter", opposition: "A locked entrance", stakes: "Remain outside" },
    synopsis: "Diego reaches a cave during a storm. A locked door stops Diego from entering. Diego must find another way before the storm worsens.",
    visualThesis: "Use a clear exterior to interior visual journey.", endingHook: "Diego reaches the light inside.", structure: "visual-arc", expectedReusePercent: 0, expectedGenerationPercent: 0,
    anchors: Array.from({ length: 7 }, (_, index) => ({ id: `moment-${index}`, title: `Moment ${index}`, description: `Diego walks along the cave passage in shot ${index}.`, purpose: "Establish movement through the space.", role: index === 0 ? "opening image" : "development", generationPrompt: "Diego walks through a cave passage.", causalDependencies: [], optional: false,
      requirements: [{ id: `req-${index}`, momentId: `moment-${index}`, description: "Diego walks through the cave.", constraints: { subjects: ["Diego"], actions: ["walking"], setting: "cave" } }],
    })),
  })], [])[0];
}

describe("story authoring revisions", () => {
  test("retains more than four moments with stable requirement IDs", () => {
    const story = fixture();
    expect(story.anchors).toHaveLength(7);
    expect(story.anchors[6].requirements?.[0].momentId).toBe("moment-6");
    expect(validateStoryAuthoring(story)).toEqual(story);
  });
  test("prose edits become pending and cannot confirm against old moments", () => {
    const original = fixture();
    const draft = markStoryEdited(original, { ...original, synopsis: "Start at the jungle entrance instead." });
    expect(draft.reconciliation?.status).toBe("pending");
    expect(isStoryPlanConfirmable(draft)).toBe(false);
    expect(original.reconciliation?.status).toBe("current");
    expect(original.synopsis.includes("cave")).toBe(true);
    expect(markStoryEdited(original, { ...original, loglineElements: { ...original.loglineElements!, stakes: "Lose the trail" } }).reconciliation?.status).toBe("pending");
  });
  test("decisions alone do not make coherent prose pending", () => {
    const original = fixture();
    const draft = markStoryEdited(original, { ...original, anchors: original.anchors.map(anchor => ({ ...anchor, resolution: "generate" })) });
    expect(draft.reconciliation?.status).toBe("current");
    expect(isStoryPlanConfirmable(draft)).toBe(true);
  });
  test("targeted revision preserves unaffected decisions and resets changed requirements", () => {
    const original = fixture();
    original.anchors[1].resolution = "omit";
    original.anchors[2].resolution = "source";
    original.anchors[2].selectedCandidateId = "source-two";
    original.anchors[2].songWindow = { start: 10, end: 20 };
    original.sectionAnchorIds = { intro: "moment-0", verse: "moment-2" };
    const next = structuredClone(original);
    next.anchors[0].description = "A wide shot establishes a jungle entrance before Diego appears.";
    next.anchors[0].requirements = [{ id: "new-opening", momentId: "moment-0", description: next.anchors[0].description, constraints: { setting: "jungle" } }];
    const merged = mergeStoryRevision(original, { treatment: next }, []);
    expect(merged.id).toBe(original.id);
    expect(merged.anchors[0].resolution).toBe(null);
    expect(merged.anchors[1].resolution).toBe("omit");
    expect(merged.anchors[2].selectedCandidateId).toBe("source-two");
    expect(merged.anchors[2].songWindow).toEqual({ start: 10, end: 20 });
    expect(describeStoryRevision(original, merged)).toContain("Revised Moment 0");
  });
  test("new output cannot hide missing logline elements or a one-sentence hook", () => {
    const story = fixture();
    expect(() => validateStoryAuthoring({ ...story, loglineElements: undefined })).toThrow(/five logline/i);
    expect(() => validateStoryAuthoring({ ...story, synopsis: "A vague mood description." })).toThrow(/three short sentences/i);
  });
  test("revision requests retain edited prose but strip client coverage assertions", () => {
    const story = fixture(); story.anchors[0].resolution = "source"; story.anchors[0].selectedCandidateId = "fake-coverage";
    const parsed = parseStoryTreatmentRequest({ brief: "", song: { sections: [] }, footage: { captionClusters: [], sourceCount: 0, momentCount: 0 }, revision: { treatment: story, instruction: "Open outside instead." } });
    expect(parsed.revision?.instruction).toBe("Open outside instead.");
    expect(parsed.revision?.treatment.anchors[0].selectedCandidateId).toBe(null);
    expect(parsed.revision?.treatment.anchors).toHaveLength(7);
  });
  test("a directly added visual can be reconciled before generation fields exist", () => {
    const story = fixture();
    story.anchors.push({ id: "added", title: "Establishing shot", description: "A wide shot of a cave entrance deep in the jungle.", purpose: "", generationPrompt: "", coverage: "missing", candidates: [], selectedCandidateId: null, resolution: null });
    const parsed = parseStoryTreatmentRequest({ brief: "", song: { sections: [] }, footage: {}, revision: { treatment: story, instruction: "Reconcile this new opening." } });
    expect(parsed.revision?.treatment.anchors).toHaveLength(8);
    expect(parsed.revision?.treatment.anchors[7].description).toContain("jungle");
  });
  test("outdated async replies cannot apply after inputs or draft edits change", () => {
    const guard = createStoryRequestGuard();
    const initial = guard.begin();
    expect(guard.isCurrent(initial)).toBe(true);
    guard.invalidate(); // edited prose, new references or recaptioned evidence
    expect(guard.isCurrent(initial)).toBe(false);
    const next = guard.begin();
    const newer = guard.begin();
    expect(guard.isCurrent(next)).toBe(false);
    expect(guard.isCurrent(newer)).toBe(true);
  });
  test("invalid timing and overlaps are actionable before Save or Use", () => {
    const story = fixture();
    const sections = [{ id: "whole-song", label: "Song", prompt: "", start: 0, end: 60 }];
    story.anchors[0].songWindow = { start: 0, end: 70 };
    expect(getStoryTimingError(story, sections, 60)).toContain("within the song");
    story.anchors[0].songWindow = { start: 0, end: 15 };
    story.anchors[1].songWindow = { start: 10, end: 20 };
    expect(getStoryTimingError(story, sections, 60)).toContain("overlap");
  });
  test("unknown causal references fail validation instead of dropping a story moment", () => {
    const story = fixture(); story.anchors[0].causalDependencies = ["does-not-exist"];
    expect(() => parseGeneratedTreatment(story)).toThrow(/dependencies/i);
  });
});

describe("story dialog draft transaction integration", () => {
  test("reading, editing, then cancelling leaves the serialized project identical", () => {
    const treatment = fixture();
    const state = transactionState(treatment);
    const before = JSON.stringify(state);
    const inspected = beginStoryInspection(treatment);
    inspected.synopsis = "A discarded beginning.";
    inspected.anchors.reverse();
    // Cancel closes the local draft and deliberately performs no commit.
    expect(JSON.stringify(state)).toBe(before);
    expect(state.confirmedTreatmentId).toBe(treatment.id);
  });

  test("saving a changed selected story invalidates confirmation and persistence cannot revive it", () => {
    const treatment = fixture();
    const state = transactionState(treatment);
    const inspected = beginStoryInspection(treatment);
    const edited = markStoryEdited(treatment, { ...inspected, synopsis: "A revised opening. Its moments still need updating. The draft must be reviewed." });
    const commit = buildStoryDraftCommit(state, edited);
    expect(commit.invalidatesConfirmed).toBe(true);
    const saved = createPersistableStudioProjectDraft({ analysis: null, videoSources: [], musicVideoProject: null, storyState: { ...state, ...commit.patch, vocalStemName: "", transcriptSummary: null, storyBeats: [], activeBeatId: "intro", storyGenerated: true } });
    const restored = hydrateStudioProjectDraft({ draft: saved });
    expect(restored.storyState.storyGenerated).toBe(false);
    expect(restored.storyState.selectedTreatmentId).toBe(treatment.id);
    expect(restored.storyState.treatments?.[0].reconciliation?.status).toBe("pending");
  });

  test("saving another option does not invalidate the current story", () => {
    const selected = fixture();
    const other = { ...fixture(), id: "another-option" };
    const state = { ...transactionState(selected), treatments: [selected, other] };
    const commit = buildStoryDraftCommit(state, { ...other, title: "A different choice" });
    expect(commit.invalidatesConfirmed).toBe(false);
    expect({ ...state, ...commit.patch }.confirmedTreatmentId).toBe(selected.id);
  });
});

function transactionState(treatment: StoryTreatment): import("@/components/studio/storyTreatments").StoryTreatmentState {
  return { brief: { text: "" }, treatments: [treatment], selectedTreatmentId: treatment.id, confirmedTreatmentId: treatment.id, confirmedTreatmentSnapshot: treatment, generationMeta: null, storyContentSignature: "confirmed-story" };
}

describe("independent shot decisions", () => {
  test("one moment can select different sources for different actions without changing prose", () => {
    const original = fixture();
    const anchor = original.anchors[0];
    anchor.requirements = [
      { id: "walk", momentId: anchor.id, description: "Diego walks through the cave.", constraints: { subjects: ["Diego"], actions: ["walking"], setting: "cave" } },
      { id: "dance", momentId: anchor.id, description: "Diego dances inside the cave.", constraints: { subjects: ["Diego"], actions: ["dancing"], setting: "cave" } },
    ];
    const moments = [
      { id: "walk-clip", sourceClipId: 0, label: "Walking", start: 0, end: 4, duration: 4, caption: "Diego walks through the cave." },
      { id: "dance-clip", sourceClipId: 1, label: "Dancing", start: 0, end: 4, duration: 4, caption: "Diego dances inside the cave." },
    ];
    const ranked = hydrateTreatmentCoverage([original], moments)[0];
    expect(ranked.anchors[0].requirements?.map(requirement => requirement.selectedCandidateId)).toEqual(["walk-clip", "dance-clip"]);
    const edited = structuredClone(ranked);
    edited.anchors[0].requirements![1].resolution = null;
    edited.anchors[0].requirements![1].selectedCandidateId = null;
    const saved = markStoryEdited(ranked, edited);
    expect(saved.reconciliation?.status).toBe("current");
    const reassessed = hydrateTreatmentCoverage([saved], moments)[0];
    expect(reassessed.anchors[0].requirements?.[0].selectedCandidateId).toBe("walk-clip");
    expect(reassessed.anchors[0].requirements?.[1].resolution).toBeNull();
    expect(reassessed.anchors[0].requirements?.[1].selectedCandidateId).toBeNull();
    const revised = structuredClone(saved);
    revised.anchors[0].requirements![1].description = "Diego rests against the cave wall.";
    revised.anchors[0].requirements![1].constraints.actions = ["resting"];
    const merged = mergeStoryRevision(saved, { treatment: revised }, moments);
    expect(merged.anchors[0].requirements?.[0].selectedCandidateId).toBe("walk-clip");
    expect(merged.anchors[0].requirements?.[1].selectedCandidateId).toBeNull();
  });

  test("an invalidated explicit source choice cannot silently switch to another clip", () => {
    const story = fixture();
    story.anchors[0].requirements![0].resolution = "source";
    story.anchors[0].requirements![0].selectedCandidateId = "deleted-clip";
    const ranked = hydrateTreatmentCoverage([story], [{ id: "replacement", sourceClipId: 1, label: "Walking", start: 0, end: 3, duration: 3, caption: "Diego walks through the cave." }])[0];
    expect(ranked.anchors[0].requirements?.[0].selectedCandidateId).toBe("deleted-clip");
    expect(isStoryPlanConfirmable(ranked)).toBe(false);
  });
});
