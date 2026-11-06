import { expect, test } from "bun:test";
import { assertStoryDiagnosticMetadataBudget, classifyStoryGatewayRejection, persistStoryTreatmentDiagnostic, sanitizeStoryDiagnosticCandidate, storyDiagnosticContext, storyDiagnosticOwnerFromTags, STORY_TOTAL_METADATA_MAX_BYTES, type StoryDiagnosticDescriptor } from "../../src/lib/storyTreatmentDiagnostics";

const context = () => storyDiagnosticContext({ runId: "run_diagnostic123", tags: ["stack-structure", "user:github-owner"], requestedModel: "requested-4B", input: "private full input", reviewContext: { brief: "private brief" } });
const candidate = () => ({ treatment: { id: "faithful", kind: "faithful", title: "Quiet start", logline: "A performer faces hesitation.", synopsis: "One. Two. Three.", visualThesis: "Reserved confidence.", endingHook: "A smile.", structure: "performance", loglineElements: { incident: "Hesitation", protagonist: "Diego", goal: "Offer a welcome", opposition: "Self-consciousness", stakes: "Miss the moment" }, anchors: [{ id: "a", title: "Breath", description: "Diego breathes.", purpose: "Find composure", generationPrompt: "Diego breathes.", role: "setup", optional: false, causalDependencies: [], songWindow: { start: 0, end: 2.5 }, requirements: [{ id: "r", momentId: "a", description: "One breath", optional: false, constraints: { subjects: ["Diego"], actions: ["breathing"], focalSubjectCount: 1, setting: "Club" } }] }] } });
function privateStore(initial: Record<string, unknown> = {}) {
  const values = structuredClone(initial), writes: string[] = [];
  return { values, writes, currentMetadata: () => values, writeMetadata: async (key: StoryDiagnosticDescriptor["key"], value: Record<string, unknown>) => { values[key] = JSON.parse(JSON.stringify(value)); writes.push(key); } };
}

test("owner context requires exactly one authoritative user tag", () => {
  expect(storyDiagnosticOwnerFromTags(["user:github-owner", "story"])).toBe("github-owner");
  for (const tags of [[], ["user:"], ["user:a", "user:b"], ["user:../../foreign"], ["user: owner"]]) expect(() => storyDiagnosticOwnerFromTags(tags)).toThrow();
});

test("fixed diagnostics distinguish semantics, copied pitches and malformed reviewer evidence without forwarding unknown text", () => {
  expect(classifyStoryGatewayRejection("review", 502, "Story logline review failed: treatment 1 goal needs expression in the logline and story support (verdict: unclear)").issues).toEqual([{ code: "unsupported-element", treatmentIndex: 1, element: "goal", verdict: "unclear" }]);
  expect(classifyStoryGatewayRejection("author", 502, "Story logline review failed: bold repeats an earlier pitch; develop a different logline, synopsis and visualThesis while preserving the brief").issues).toEqual([{ code: "duplicate-pitch", kind: "bold" }]);
  expect(classifyStoryGatewayRejection("review", 502, "Story logline review failed: reviewer returned incomplete or invalid evidence; retry the story request").issues).toEqual([{ code: "review-evidence-invalid" }]);
  expect(classifyStoryGatewayRejection("review", 502, "Story logline review failed: treatment 2 stakes needs expression in the logline and story support (verdict: expressed-and-supported)").issues[0].code).toBe("review-evidence-missing");
  const unknown = classifyStoryGatewayRejection("review", 502, "Bearer PRIVATE https://private/?token=PRIVATE");
  expect(unknown.issues).toEqual([{ code: "gateway-rejected" }]);
  expect(JSON.stringify(unknown)).not.toContain("PRIVATE");
});

test("candidate retention whitelists every nested level without mutating the actual author output", () => {
  const value = candidate();
  const contaminated = { ...value, authorization: "NEVER", treatment: { ...value.treatment, token: "NEVER", loglineElements: { ...value.treatment.loglineElements, env: "NEVER" }, anchors: value.treatment.anchors.map(a => ({ ...a, serverConfig: "NEVER", songWindow: { ...a.songWindow, secret: "NEVER" }, requirements: a.requirements.map(r => ({ ...r, headers: "NEVER", constraints: { ...r.constraints, credentials: "NEVER" } })) })) } };
  const before = JSON.stringify(contaminated), safe = sanitizeStoryDiagnosticCandidate(contaminated);
  expect(safe).toEqual(value);
  expect(JSON.stringify(safe)).not.toContain("NEVER");
  expect(JSON.stringify(contaminated)).toBe(before);
});

test("private run retention stores the candidate once, preserves progress, and binds later rejection to its bytes", async () => {
  const store = privateStore({ stage: "reviewing", stageLabel: "Checking story" });
  const rejection = classifyStoryGatewayRejection("review", 502, "Story logline review failed: treatment 1 must avoid revealing its resolution");
  await persistStoryTreatmentDiagnostic(context(), { phase: "author", outcome: "authored-unreviewed", authoredOutput: candidate(), actualModel: "actual-8B" }, store);
  const descriptor = await persistStoryTreatmentDiagnostic(context(), { phase: "review", outcome: "rejected", authoredOutput: candidate(), actualModel: "actual-8B", rejection, httpStatus: 502 }, store);
  const authored = store.values.storyAuthoredDiagnosticRecord as Record<string, unknown>, review = store.values.storyReviewDiagnosticRecord as Record<string, unknown>;
  expect(authored.candidate).toEqual(candidate());
  expect(review.candidate).toBe(undefined);
  expect(review.candidateSha256).toBe(authored.candidateSha256);
  expect(authored.requestedModel).toBe("requested-4B");
  expect(authored.actualAuthorModel).toBe("actual-8B");
  expect(authored.acceptance).toBe("diagnostic-only-not-approved");
  expect(review.reviewerEvidenceAvailable).toBe(false);
  expect(review.rejection).toEqual(rejection);
  expect(store.values.stage).toBe("reviewing");
  expect(store.values.stageLabel).toBe("Checking story");
  expect(descriptor.storage).toBe("private-trigger-run-metadata");
  expect(descriptor.rejectionCodes).toEqual(["resolution-spoiler"]);
  expect(JSON.stringify(store.values)).not.toContain("private full input");
  expect(JSON.stringify(descriptor)).not.toMatch(/uploadToken|NEVER|logline|private brief/);
});

test("oversize or invalid-owner diagnostics fail before any private metadata is written", async () => {
  const store = privateStore();
  const oversized = candidate(); oversized.treatment.logline = "x".repeat(321);
  await expect(persistStoryTreatmentDiagnostic(context(), { phase: "author", outcome: "authored-unreviewed", authoredOutput: oversized }, store)).rejects.toThrow("bound");
  await expect(persistStoryTreatmentDiagnostic({ ...context(), ownerId: "../../foreign" }, { phase: "author", outcome: "authored-unreviewed", authoredOutput: candidate() }, store)).rejects.toThrow("authenticated owner");
  expect(store.writes).toHaveLength(0);
});

test("whole-record bound rejects many individually valid fields and arbitrary rejection extensions are dropped", async () => {
  const value = candidate(), anchor = value.treatment.anchors[0], requirement = anchor.requirements[0];
  const huge = { treatments: Array.from({ length: 3 }, () => ({ ...value.treatment, anchors: Array.from({ length: 15 }, () => ({ ...anchor, requirements: Array.from({ length: 12 }, () => ({ ...requirement, constraints: { subjects: Array(12).fill("x".repeat(180)) } })) })) })) };
  const store = privateStore();
  await expect(persistStoryTreatmentDiagnostic(context(), { phase: "author", outcome: "authored-unreviewed", authoredOutput: huge }, store)).rejects.toThrow("byte bound");
  const rejection = { ...classifyStoryGatewayRejection("review", 502, "unknown"), secret: "NEVER" };
  await persistStoryTreatmentDiagnostic(context(), { phase: "review", outcome: "rejected", rejection }, store);
  expect(JSON.stringify(store.values)).not.toContain("NEVER");
});

test("the total metadata bound includes existing progress and all previously retained diagnostic fields", async () => {
  const initial = { stage: "reviewing", existingProgress: "p".repeat(STORY_TOTAL_METADATA_MAX_BYTES - 2048) }, store = privateStore(initial);
  await expect(persistStoryTreatmentDiagnostic(context(), { phase: "author", outcome: "authored-unreviewed", authoredOutput: candidate() }, store)).rejects.toThrow("total metadata budget");
  expect(store.writes).toHaveLength(0);
  expect(store.values).toEqual(initial);
  expect(() => assertStoryDiagnosticMetadataBudget({ storyAuthoredDiagnosticRecord: "x".repeat(200 * 1024) }, "storyReviewDiagnosticRecord", "y".repeat(60 * 1024))).toThrow("total metadata budget");
});

test("review repair appends a distinct bounded record with the same candidate hash and preserves the first rejection", async () => {
  const store = privateStore({ stage: "reviewing" });
  const rejection = classifyStoryGatewayRejection("review", 502, "Story logline review failed: treatment 1 stakes reviewer brief quote is not an exact excerpt");
  await persistStoryTreatmentDiagnostic(context(), { phase: "author", outcome: "authored-unreviewed", authoredOutput: candidate() }, store);
  await persistStoryTreatmentDiagnostic(context(), { phase: "review", reviewAttempt: 1, outcome: "rejected", rejection, authoredOutput: candidate() }, store);
  const first = JSON.stringify(store.values.storyReviewDiagnosticRecord);
  const descriptor = await persistStoryTreatmentDiagnostic(context(), { phase: "review", reviewAttempt: 2, outcome: "review-passed", authoredOutput: candidate(), gatewayReviewMarker: "passed" }, store);
  const second = store.values.storyReviewRepairDiagnosticRecord as Record<string, unknown>;
  expect(descriptor.key).toBe("storyReviewRepairDiagnosticRecord");
  expect(JSON.stringify(store.values.storyReviewDiagnosticRecord)).toBe(first);
  expect(second.reviewAttempt).toBe(2);
  expect(second.candidate).toBe(undefined);
  expect(second.candidateSha256).toBe((store.values.storyAuthoredDiagnosticRecord as Record<string, unknown>).candidateSha256);
  expect(store.values.stage).toBe("reviewing");
  await expect(persistStoryTreatmentDiagnostic(context(), { phase: "author", reviewAttempt: 2, outcome: "authored-unreviewed" }, store)).rejects.toThrow("review attempt");
});
