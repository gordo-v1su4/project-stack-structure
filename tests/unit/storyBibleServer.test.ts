import { expect, test } from "bun:test";
import { buildStoryBibleBinding } from "@/components/studio/storyBibleBinding";
import { STORY_BIBLE_ADAPTER, type CanonFact, type StoryBible } from "@/components/studio/storyBible";
import { hydrateTreatmentCoverage, parseGeneratedTreatment, parseStoryTreatmentRequest, type StoryTreatmentRequest } from "@/components/studio/storyTreatments";
import type { ReferenceAsset } from "@/components/studio/referenceAssets";
import type { SavedStudioProject } from "@/lib/studioProjectStore";
import { resolveStoryCanon, storyCanonPromptData } from "@/lib/storyBibleServer";
import { buildStoryInput, queueStoryTreatmentGeneration } from "@/lib/storyTreatmentServer";
import { handleStoryTreatmentsPost } from "@/lib/storyTreatmentsRoute";

function fixture() {
  const treatment = hydrateTreatmentCoverage([parseGeneratedTreatment({ id: "story", kind: "faithful", title: "Arrival", logline: "Diego reaches the club.",
    synopsis: "Diego arrives. Diego dances. Diego leaves.", visualThesis: "Warm concrete.", endingHook: "Diego leaves.", structure: "visual-arc",
    anchors: ["arrive", "leave"].map(id => ({ id, title: id, description: `Diego performs ${id}.`, purpose: "Show the journey.", generationPrompt: `Diego performs ${id}.`,
      requirements: [{ id: `${id}-shot`, momentId: id, description: `Diego performs ${id}.`, constraints: { subjects: ["Diego"] } }] })) })], [])[0];
  const refs: ReferenceAsset[] = [{ id: "diego-ref", role: "character-1", kind: "character", displayName: "Diego", fileName: "diego.png", promptHint: "RAW identity authority.",
    previewUrl: "", createdAt: "2026-11-09", storageStatus: "uploaded", storageBucket: "bucket", storagePath: "media-uploads/github-test/references/diego.png" }];
  const fact = (id: string, value?: string, patch: Partial<CanonFact> = {}): CanonFact => ({ id, kind: "movement", value, state: "confirmed", visibility: "public", channel: "positive",
    characterIds: ["diego"], referenceAssetIds: ["diego-ref"], provenance: { kind: "user", sourceIds: ["brief"] }, ...patch });
  const bible: StoryBible = { version: 1, adapter: STORY_BIBLE_ADAPTER,
    binding: buildStoryBibleBinding({ projectId: "film", treatment, referenceAssets: refs }),
    characters: [{ id: "diego", canonicalName: "Diego", referenceAssetIds: ["diego-ref"] }],
    facts: [fact("positive", "Measured forward steps."), fact("negative", "Never repeat an entrance.", { channel: "exclusion" }),
      fact("review", "Wardrobe follows the named sheet.", { channel: "review" }), fact("private", "PRIVATE_SECRET", { visibility: "private" }),
      fact("proposed", "PROPOSED_BACKSTORY", { state: "proposed" }), fact("missing"), fact("unknown", "TBD")], relationships: [] };
  treatment.storyBible = bible;
  treatment.reconciliation = { status: "pending" };
  const saved = { version: 1, revision: '"v1"', project: { id: "film", ownerId: "github-test" },
    draft: { storyState: { treatments: [treatment], confirmedTreatmentSnapshot: null }, referenceAssets: refs } } as unknown as SavedStudioProject;
  const request: StoryTreatmentRequest = { brief: "Travel through the club.", song: { sections: [] }, footage: { captionClusters: [], sourceCount: 0, momentCount: 0 },
    canonContext: { projectId: "film", expectedRevision: '"v1"', bible }, revision: { treatment: structuredClone(treatment), instruction: "Develop the route." } };
  const read = async (owner: string, id: string, options?: { fresh?: boolean }) => {
    expect(owner).toBe("github-test"); expect(id).toBe("film"); expect(options?.fresh).toBe(true); return saved;
  };
  return { treatment, refs, bible, saved, request, read };
}

test("server binds exact persisted pending canon and separates positive author facts from full review facts", async () => {
  const f = fixture(), canon = await resolveStoryCanon("github-test", f.request, { read: f.read, bucket: "bucket" });
  const input = buildStoryInput(f.request, 0, canon);
  expect(input).toContain("Measured forward steps.");
  for (const forbidden of ["PRIVATE_SECRET", "PROPOSED_BACKSTORY", "TBD", "Never repeat an entrance.", "Wardrobe follows the named sheet."]) expect(input).not.toContain(forbidden);
  let dispatched = false;
  await queueStoryTreatmentGeneration(f.request, { canon, trigger: async payload => {
    dispatched = true;
    expect(payload.reviewContext.constraints.join("\n")).toContain("Measured forward steps.");
    expect(payload.reviewContext.constraints.join("\n")).toContain("Never repeat an entrance.");
    expect(payload.reviewContext.constraints.join("\n")).toContain("Wardrobe follows the named sheet.");
    expect(JSON.stringify(payload)).not.toContain("PRIVATE_SECRET");
    expect(JSON.stringify(payload)).not.toContain("PROPOSED_BACKSTORY");
    expect(payload.input).toContain(canon!.projectionSha256);
    return { id: "run-test" };
  } });
  expect(dispatched).toBe(true);
});

test("explicit revision changes authoring text without silently rebinding its source Bible", async () => {
  const f = fixture(); f.request.revision!.treatment.logline = "Diego chooses a new path.";
  const before = structuredClone(f.bible), canon = await resolveStoryCanon("github-test", f.request, { read: f.read, bucket: "bucket" });
  expect(canon!.binding).toEqual(before.binding);
  expect(buildStoryInput(f.request, 0, canon)).toContain("Diego chooses a new path.");
  expect(f.bible).toEqual(before);
});

test("authenticated route passes only a server-resolved projection into dispatch", async () => {
  const f = fixture(); let dispatched = false;
  const response = await handleStoryTreatmentsPost(new Request("https://app.test/api/story/treatments", { method: "POST", body: JSON.stringify(f.request) }), {
    getUser: async () => ({ id: "github-test" }), isConfigured: true, readProject: f.read, referenceBucket: "bucket",
    queue: async (input, options) => {
      dispatched = true; expect(options.canon!.binding).toEqual(f.bible.binding);
      expect(options.canon!.generationContext.map(fact => fact.id)).toEqual(["positive"]);
      expect(input.revision!.treatment.reconciliation!.status).toBe("pending");
      return { runId: "run-test", model: "qwen" };
    },
  });
  expect(response.status).toBe(202); expect(dispatched).toBe(true);
});

for (const problem of ["foreign", "revision", "changed canon", "historical references", "changed references", "renamed character", "foreign sheet", "missing reference", "wrong target", "ambiguous", "stale confirmed"] as const) {
  test(`${problem} canon cannot dispatch`, async () => {
    const f = fixture();
    if (problem === "foreign") f.saved.project.ownerId = "github-other";
    if (problem === "revision") f.saved.revision = '"v2"';
    if (problem === "changed canon") { f.request.canonContext!.bible = structuredClone(f.bible); f.request.canonContext!.bible.facts[0].value = "Unpersisted canon"; }
    if (problem === "historical references") f.bible.binding.referenceSignature = "custom-old-canon-format";
    if (problem === "changed references") f.refs[0].promptHint = "Changed reference metadata";
    if (problem === "renamed character") f.bible.characters[0].canonicalName = "Other";
    if (problem === "foreign sheet") f.refs[0].storagePath = "media-uploads/github-other/sheet.png";
    if (problem === "missing reference") f.bible.characters[0].referenceAssetIds = ["missing"];
    if (problem === "wrong target") f.request.revision!.treatment.id = "other";
    if (problem === "ambiguous") f.saved.draft.storyState.treatments!.push(structuredClone(f.treatment));
    if (problem === "stale confirmed") { f.saved.draft.storyState.confirmedTreatmentSnapshot = structuredClone(f.treatment); f.treatment.logline = "Changed persisted story."; }
    let dispatched = false;
    const response = await handleStoryTreatmentsPost(new Request("https://app.test/api/story/treatments", { method: "POST", body: JSON.stringify(f.request) }), {
      getUser: async () => ({ id: "github-test" }), isConfigured: true, readProject: f.read, referenceBucket: "bucket",
      queue: async () => { dispatched = true; return { runId: "unexpected", model: "qwen" }; },
    });
    expect([400, 404, 409].includes(response.status)).toBe(true);
    expect(dispatched).toBe(false);
  });
}

test("positive canon cannot exceed the prompt budget and review context leaves evidence-repair capacity", async () => {
  const f = fixture();
  for (let i = 0; i < 8; i++) f.bible.facts.push({ ...f.bible.facts[0], id: `long-${i}`, value: "a".repeat(1000) });
  const canon = await resolveStoryCanon("github-test", f.request, { read: f.read, bucket: "bucket" });
  let dispatched = false;
  await expect(queueStoryTreatmentGeneration(f.request, { canon, trigger: async () => { dispatched = true; return { id: "unexpected" }; } })).rejects.toThrow("context budget");
  expect(dispatched).toBe(false);
  expect(() => storyCanonPromptData(undefined, "a".repeat(10901), [])).toThrow("context budget");
});

test("missing canon context cannot bypass verification through a revision Bible", async () => {
  const f = fixture(); delete f.request.canonContext;
  await expect(resolveStoryCanon("github-test", f.request)).rejects.toThrow("Save and bind");
  await expect(queueStoryTreatmentGeneration(f.request, { trigger: async () => ({ id: "unexpected" }) })).rejects.toThrow("Resolve saved story canon");
});

test("canon parser rejects malformed context and never accepts a client projection field", () => {
  const f = fixture();
  // HTTP JSON omits the fixture's undefined optional fact value.
  const wireBible = JSON.parse(JSON.stringify(f.bible));
  expect(parseStoryTreatmentRequest(f.request).canonContext!.bible).toEqual(wireBible);
  for (const context of [{ ...f.request.canonContext, expectedRevision: "*" }, { ...f.request.canonContext, projectId: "../other" }, { ...f.request.canonContext, projection: {} }, { ...f.request.canonContext, bible: { version: 99 } }]) {
    expect(() => parseStoryTreatmentRequest({ ...f.request, canonContext: context })).toThrow();
  }
});

test("metadata binding is order-stable, excludes Bible recursion, and requires named uploaded references", () => {
  const f = fixture();
  f.refs.push({ ...f.refs[0], id: "club", displayName: "Club", kind: "environment", role: "environment", storagePath: "media-uploads/github-test/references/club.png" });
  const binding = buildStoryBibleBinding({ projectId: "film", treatment: f.treatment, referenceAssets: f.refs });
  expect(buildStoryBibleBinding({ projectId: "film", treatment: f.treatment, referenceAssets: [...f.refs].reverse() })).toEqual(binding);
  f.bible.facts[0].value = "Different authored canon.";
  expect(buildStoryBibleBinding({ projectId: "film", treatment: f.treatment, referenceAssets: f.refs })).toEqual(binding);
  for (const patch of [{ storageStatus: "local" }, { displayName: "" }, { storagePath: undefined }]) {
    expect(() => buildStoryBibleBinding({ projectId: "film", treatment: f.treatment, referenceAssets: [{ ...f.refs[0], ...patch } as ReferenceAsset] })).toThrow();
  }
});
