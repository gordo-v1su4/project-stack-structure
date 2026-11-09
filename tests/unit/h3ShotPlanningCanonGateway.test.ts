import { expect, test } from "bun:test";
import { generateH3ShotPlan, H3_SHOT_GATEWAY_LIMITS, type H3ShotAuthorInput } from "@/lib/h3ShotPlanningGateway";
import { buildH3ShotPlanningInput, type H3ShotPlanningInput } from "@/components/studio/h3ShotPlanning";
import { createMusicVideoProject, prepareApprovedPlacements, buildEditPlanPreviewSegments } from "@/components/studio/musicVideoProject";
import { generationScopeSha256 } from "@/components/studio/generationScope";
import type { H3ShotCanonScope } from "@/components/studio/h3StoryCanon";
import { normalizeStoryBible, STORY_BIBLE_ADAPTER, type CanonFact } from "@/components/studio/storyBible";
import { buildStoryBibleBinding } from "@/components/studio/storyBibleBinding";
import type { StoryTreatment } from "@/components/studio/storyTreatments";
import type { ReferenceAsset } from "@/components/studio/referenceAssets";

const env = { SCENE_CAPTION_SMART_GATEWAY_URL: "http://gateway.test", SCENE_CAPTION_SMART_GATEWAY_TOKEN: "test-only" };
function fixture(count = 10, canon = true) {
  const draft = createMusicVideoProject({ analysis: null, duration: count, videoSources: [], storyDrafts: [
    { id: "travel", label: "Travel", start: 0, end: count, prompt: "Diego walks through CLUB_MAIN." },
  ] });
  const project = prepareApprovedPlacements({ project: draft, videoSources: [] });
  const segment = buildEditPlanPreviewSegments({ project, videoSources: [] })[0];
  const input = buildH3ShotPlanningInput({ project, subjectNames: ["Diego"], segments: Array.from({ length: count }, (_, index) => ({ ...segment, musicStart: index, musicEnd: index + 1 })) });
  if (canon) {
    const body = { version: 1 as const, bibleSha256: "a".repeat(64), projectionSha256: "b".repeat(64), subjectNames: ["Diego"], referenceAssetIds: ["diego"],
      positiveFacts: [{ id: "move", text: "Diego walks with grounded steps." }], reviewConstraints: [{ id: "hold", text: "Never repeat a completed entrance." }] };
    input.groups[0].storyCanon = { ...body, scopeSha256: generationScopeSha256(body) };
    rehash(input);
  }
  return input;
}
function rehash(input: H3ShotPlanningInput) { const { bindingSha256: _hash, ...body } = input; void _hash; input.bindingSha256 = generationScopeSha256(body); }
function rescope(scope: H3ShotCanonScope) { const { scopeSha256: _hash, ...body } = scope; void _hash; scope.scopeSha256 = generationScopeSha256(body); }
type WireReview = { input: H3ShotAuthorInput; candidate: unknown; candidateSha256: string; canonReview?: { version: 1; bibleSha256: string; projectionSha256: string; scopeSha256: string; reviewConstraints: { id: string; text: string }[] } };
function gateway(options: { authorMarker?: "missing" | "wrong"; reviewMarker?: "missing" | "wrong"; maximumText?: boolean } = {}) {
  const calls: { path: string; body: unknown; bytes: number }[] = [];
  const fetchImpl = (async (url, init) => {
    const path = new URL(String(url)).pathname, serialized = String(init?.body), body = JSON.parse(serialized);
    calls.push({ path, body, bytes: new TextEncoder().encode(serialized).length });
    if (path.endsWith("author")) {
      const input = body as H3ShotAuthorInput, scope = input.context.storyCanon?.scopeSha256;
      const state = (id: number) => options.maximumText ? `${"界".repeat(797)}${String(id).padStart(3, "0")}` : `state ${id}`;
      return Response.json({ version: 1, bindingSha256: input.bindingSha256,
        ...(scope && options.authorMarker !== "missing" ? { canonScopeSha256: options.authorMarker === "wrong" ? "c".repeat(64) : scope } : {}),
        directions: input.windows.map(window => ({ windowId: window.id, direction: options.maximumText ? `[Tracking] Medium shot. ${"界".repeat(1600 - "[Tracking] Medium shot. ".length)}` : `Diego walks through window ${window.id}.`,
          entryState: state(window.id), exitState: state(window.id + 1), actionIndices: [] })) });
    }
    const review = body as WireReview, scope = review.canonReview?.scopeSha256;
    expect(review.candidateSha256).toBe(generationScopeSha256(review.candidate));
    return Response.json({ version: 1, bindingSha256: review.input.bindingSha256, candidateSha256: review.candidateSha256, status: "passed", violations: [],
      ...(scope && options.reviewMarker !== "missing" ? { canonScopeSha256: options.reviewMarker === "wrong" ? "c".repeat(64) : scope } : {}) });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

test("author receives scoped positive canon and reviewer receives exact positive input plus matching exclusions", async () => {
  const input = fixture(), scope = input.groups[0].storyCanon!, mock = gateway();
  input.subjectNames = ["Diego", "Valentina"]; rehash(input);
  const result = await generateH3ShotPlan(input, { env, fetchImpl: mock.fetchImpl });
  expect(result.directions).toHaveLength(10);
  const author = mock.calls[0].body as H3ShotAuthorInput, review = mock.calls[1].body as WireReview;
  expect(author.context.subjectNames).toEqual(["Diego"]);
  expect(author.context.storyCanon).toEqual({ version: 1, bibleSha256: scope.bibleSha256, projectionSha256: scope.projectionSha256, scopeSha256: scope.scopeSha256,
    subjectNames: scope.subjectNames, referenceAssetIds: scope.referenceAssetIds, positiveFacts: scope.positiveFacts });
  expect(JSON.stringify(author)).not.toContain("Never repeat");
  expect(review.input).toEqual(author);
  expect(review.canonReview).toEqual({ version: 1, bibleSha256: scope.bibleSha256, projectionSha256: scope.projectionSha256, scopeSha256: scope.scopeSha256, reviewConstraints: scope.reviewConstraints });
  expect(JSON.stringify(mock.calls)).not.toContain('"storyBible"');
});

test("environment-only canon does not inherit global lead names", async () => {
  const input = fixture(), scope = input.groups[0].storyCanon!, mock = gateway();
  scope.subjectNames = []; scope.referenceAssetIds = ["club"];
  scope.positiveFacts = [{ id: "light", text: "Amber light spreads across concrete." }]; scope.reviewConstraints = [];
  rescope(scope); rehash(input);
  await generateH3ShotPlan(input, { env, fetchImpl: mock.fetchImpl });
  const author = mock.calls[0].body as H3ShotAuthorInput;
  expect(author.context.subjectNames).toEqual([]);
  expect(author.context.storyCanon!.subjectNames).toEqual([]);
  expect(author.context.storyCanon!.positiveFacts).toEqual(scope.positiveFacts);
});

for (const stage of ["author", "review"] as const) for (const marker of ["missing", "wrong"] as const) {
  test(`a ${stage} service with ${marker} canon acknowledgment fails without retries`, async () => {
    const mock = gateway(stage === "author" ? { authorMarker: marker } : { reviewMarker: marker });
    await expect(generateH3ShotPlan(fixture(), { env, fetchImpl: mock.fetchImpl })).rejects.toThrow(stage === "author" ? "chunk binding" : "review did not pass");
    expect(mock.calls).toHaveLength(stage === "author" ? 1 : 2);
  });
}

test("canon chunking pre-admits the maximum review text inside the existing byte cap", async () => {
  const mock = gateway({ maximumText: true }), result = await generateH3ShotPlan(fixture(30), { env, fetchImpl: mock.fetchImpl });
  expect(result.directions).toHaveLength(30);
  const authors = mock.calls.filter(call => call.path.endsWith("author")).map(call => call.body as H3ShotAuthorInput);
  expect(authors.length).toBeGreaterThan(2);
  expect(mock.calls.every(call => call.bytes <= H3_SHOT_GATEWAY_LIMITS.bodyBytes)).toBe(true);
  expect(authors.slice(1).every((author, index) => author.context.previousExitState === `${"界".repeat(797)}${String(authors[index].windows.at(-1)!.id + 1).padStart(3, "0")}`)).toBe(true);
});

test("oversized reviewer-only canon and changed scope fail before any author call", async () => {
  for (const problem of ["oversized", "changed"] as const) {
    const input = fixture(), scope = input.groups[0].storyCanon!;
    scope.reviewConstraints[0].text = problem === "oversized" ? "界".repeat(24000) : "Changed constraints.";
    if (problem === "oversized") rescope(scope);
    rehash(input);
    const mock = gateway();
    await expect(generateH3ShotPlan(input, { env, fetchImpl: mock.fetchImpl })).rejects.toThrow(problem === "oversized" ? "admission" : "scope changed");
    expect(mock.calls).toHaveLength(0);
  }
});

test("escaped carried boundary states are pre-admitted before the first model call", async () => {
  const padded = (prefix: string, length: number) => `${prefix}${"a".repeat(length - prefix.length - 1)}.`;
  for (const canon of [false, true]) {
    const projectId = "bounded-canon-project", count = 30;
    const direction = canon ? "Diego walks through CLUB_MAIN." : padded("The procession advances through the club. ", 4000);
    const draft = createMusicVideoProject({ id: projectId, analysis: null, duration: count, videoSources: [], storyDrafts: [
      { id: "travel", label: "Travel", start: 0, end: count, prompt: direction },
    ] });
    if (!canon) {
      const list = (label: string) => Array.from({ length: 12 }, (_, index) => padded(`${label} ${index}: `, 180));
      draft.editPlan.timelineItems[0].requirements = { subjects: list("Named participant"), actions: list("Action"),
        excludedActions: list("Continuity constraint"), actionSequence: list("Ordered action"), physicalStates: list("Physical state"),
        setting: padded("Club route: ", 240), intent: padded("Continue the procession: ", 240), focalSubjectCount: 12 };
    }
    const project = prepareApprovedPlacements({ project: draft, videoSources: [] });
    const segment = buildEditPlanPreviewSegments({ project, videoSources: [] })[0];
    const segments = Array.from({ length: count }, (_, index) => ({ ...segment, musicStart: index, musicEnd: index + 1 }));
    const references: ReferenceAsset[] = [
      { id: "diego", displayName: "Diego", role: "character-1", kind: "character" },
      { id: "club", displayName: "CLUB_MAIN", role: "environment", kind: "environment" },
    ].map(ref => ({ ...ref, fileName: `${ref.id}.png`, previewUrl: "", promptHint: "", storageStatus: "uploaded",
      storageBucket: "media", storagePath: `refs/${ref.id}.png`, createdAt: "2026-11-09T00:00:00Z" } as ReferenceAsset));
    const treatment: StoryTreatment = { id: "approved-travel", kind: "faithful", title: "Travel", logline: direction,
      synopsis: direction, visualThesis: "Amber light follows the route.", endingHook: "The route reaches the exit.",
      expectedReusePercent: 0, expectedGenerationPercent: 100, anchors: [{ id: "travel", title: "Travel", description: direction,
        purpose: "Continue the route.", generationPrompt: direction, coverage: "missing", candidates: [], selectedCandidateId: null, resolution: null }] };
    const facts: CanonFact[] = Array.from({ length: 15 }, (_, index) => ({ id: `light-${index}`, kind: "production",
      value: padded(`Amber light crosses wall ${index}: `, 1500), state: "confirmed", visibility: "public", channel: "positive",
      characterIds: [], referenceAssetIds: ["club"], provenance: { kind: "user", sourceIds: [`light-${index}`] } }));
    const subjectNames = canon ? ["Diego"] : Array.from({ length: 32 }, (_, index) => padded(`Declared participant ${index}: `, 120));
    const build = () => {
      if (canon) treatment.storyBible = normalizeStoryBible({ version: 1, adapter: STORY_BIBLE_ADAPTER,
        binding: buildStoryBibleBinding({ projectId, treatment, referenceAssets: references }),
        characters: [{ id: "diego", canonicalName: "Diego", referenceAssetIds: ["diego"] }], facts, relationships: [] });
      return buildH3ShotPlanningInput({ projectId, project, segments, subjectNames,
        ...(canon ? { storyCanonSource: { treatment, references } } : {}) });
    };
    const contextFor = (input: H3ShotPlanningInput) => {
      const group = input.groups[0], scope = group.storyCanon;
      return { approvedDirection: group.approvedDirection, constraints: group.constraints, subjectNames: scope?.subjectNames ?? input.subjectNames,
        completedActionCount: 0, remainingWindowCount: group.windows.length, previousExitState: "x".repeat(800),
        ...(scope ? { storyCanon: { version: scope.version, bibleSha256: scope.bibleSha256, projectionSha256: scope.projectionSha256,
          scopeSha256: scope.scopeSha256, subjectNames: scope.subjectNames, referenceAssetIds: scope.referenceAssetIds, positiveFacts: scope.positiveFacts } } : {}) };
    };
    let input = build();
    if (canon) {
      const adjustedLength = facts.at(-1)!.value!.length + H3_SHOT_GATEWAY_LIMITS.contextCharacters - 600 - JSON.stringify(contextFor(input)).length;
      expect(adjustedLength > 0 && adjustedLength <= 1600).toBe(true);
      facts.at(-1)!.value = padded("Amber light crosses the final wall: ", adjustedLength);
      input = build();
      expect(input.groups[0].storyCanon!.positiveFacts.every(fact => fact.text.length <= 1600)).toBe(true);
    }
    const context = contextFor(input);
    // Actual builders/normalizers enforce direction <=4000, 32 names <=120,
    // 12 entries/list <=180, setting/intent <=240 and Bible facts <=1600.
    expect(input.groups[0].approvedDirection.length <= 4000).toBe(true);
    expect(JSON.stringify(context).length).toBeLessThan(H3_SHOT_GATEWAY_LIMITS.contextCharacters);
    if (canon) expect(JSON.stringify({ ...context, previousExitState: '"'.repeat(800) }).length).toBeGreaterThan(H3_SHOT_GATEWAY_LIMITS.contextCharacters);
    expect(JSON.stringify({ ...context, previousExitState: "\ud800".repeat(800) }).length).toBeGreaterThan(H3_SHOT_GATEWAY_LIMITS.contextCharacters);
    const mock = gateway();
    await expect(generateH3ShotPlan(input, { env, fetchImpl: mock.fetchImpl })).rejects.toThrow("context exceeds gateway admission");
    expect(mock.calls).toHaveLength(0);
  }
});

test("no-Bible calls retain the original chunk size, body keys and chunk hashing", async () => {
  const input = fixture(30, false), mock = gateway();
  await generateH3ShotPlan(input, { env, fetchImpl: mock.fetchImpl });
  const authors = mock.calls.filter(call => call.path.endsWith("author")).map(call => call.body as H3ShotAuthorInput);
  expect(authors.map(author => author.windows.length)).toEqual([24, 6]);
  for (const [index, author] of authors.entries()) {
    expect(Object.keys(author)).toEqual(["version", "bindingSha256", "context", "windows"]);
    expect(Object.hasOwn(author.context, "storyCanon")).toBe(false);
    expect(author.bindingSha256).toBe(generationScopeSha256({ inputBinding: input.bindingSha256, groupId: input.groups[0].id, context: author.context, windows: author.windows }));
    expect(Object.keys(mock.calls[index * 2 + 1].body as object)).toEqual(["input", "candidate", "candidateSha256"]);
  }
});

test("canon admission reserves the actual critic envelope before choosing a chunk", async () => {
  const projectId = "envelope-project", direction = "Diego moves through CLUB_MAIN.";
  const project = prepareApprovedPlacements({ project: createMusicVideoProject({ id: projectId, analysis: null, duration: 24, videoSources: [], storyDrafts: [
    { id: "travel", label: "Travel", start: 0, end: 24, prompt: direction },
  ] }), videoSources: [] });
  const segment = buildEditPlanPreviewSegments({ project, videoSources: [] })[0];
  const references: ReferenceAsset[] = [{ id: "diego", role: "character-1", kind: "character", displayName: "Diego" },
    { id: "club", role: "environment", kind: "environment", displayName: "CLUB_MAIN" }].map(ref => ({ ...ref, fileName: `${ref.id}.png`, previewUrl: "", promptHint: "",
      storageStatus: "uploaded", storageBucket: "media", storagePath: `refs/${ref.id}.png`, createdAt: "2026-11-09T00:00:00Z" } as ReferenceAsset));
  const treatment: StoryTreatment = { id: "travel", kind: "faithful", title: "Travel", logline: direction, synopsis: direction, visualThesis: "Warm concrete.", endingHook: "Diego leaves.",
    expectedReusePercent: 0, expectedGenerationPercent: 100, anchors: [{ id: "travel", title: "Travel", description: direction, purpose: "Move forward.", generationPrompt: direction,
      coverage: "missing", candidates: [], selectedCandidateId: null, resolution: null }] };
  treatment.storyBible = normalizeStoryBible({ version: 1, adapter: STORY_BIBLE_ADAPTER, binding: buildStoryBibleBinding({ projectId, treatment, referenceAssets: references }),
    characters: [{ id: "diego", canonicalName: "Diego", referenceAssetIds: ["diego"] }], relationships: [],
    facts: Array.from({ length: 10 }, (_, index) => ({ id: `f${index}`, kind: "production", value: "界".repeat(index === 9 ? 1200 : 1600), state: "confirmed", visibility: "public", channel: "positive",
      characterIds: [], referenceAssetIds: ["club"], provenance: { kind: "user", sourceIds: ["brief"] } })) });
  const input = buildH3ShotPlanningInput({ projectId, project, segments: Array.from({ length: 8 }, (_, index) => ({ ...segment, musicStart: index * 3, musicEnd: (index + 1) * 3 })),
    subjectNames: ["Diego"], storyCanonSource: { treatment, references } });
  const mock = gateway({ maximumText: true });
  await generateH3ShotPlan(input, { env, fetchImpl: mock.fetchImpl });
  const authors = mock.calls.filter(call => call.path.endsWith("author")).map(call => call.body as H3ShotAuthorInput);
  // The previous HTTP-only admission chose four; its actual Python critic
  // envelope was 131981 bytes and failed after authoring had already run.
  expect(authors.every(author => author.windows.length < 4)).toBe(true);
  const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
  for (const call of mock.calls.filter(call => call.path.endsWith("review"))) {
    const body = call.body as WireReview, candidate = body.candidate as { directions: { windowId: number; direction: string; entryState: string; exitState: string }[] };
    const composedDirections = candidate.directions.map(row => {
      const split = row.direction.indexOf(". ") + 1;
      const sentence = (text: string) => /[.!?]$/.test(text) ? text : `${text}.`;
      return { windowId: row.windowId, prompt: `${row.direction.slice(0, split)} ${sentence(row.entryState)} ${row.direction.slice(split).trim()} ${sentence(row.exitState)}` };
    });
    const criticInput = { input: body.input, candidate: body.candidate, composedDirections, canonReview: body.canonReview };
    const variableBytes = byteLength(JSON.stringify(criticInput)) - 2;
    expect(variableBytes + H3_SHOT_GATEWAY_LIMITS.canonModelEnvelopeOverheadBytes <= H3_SHOT_GATEWAY_LIMITS.bodyBytes).toBe(true);
  }
});
