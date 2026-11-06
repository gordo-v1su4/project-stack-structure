import { createHash } from "node:crypto";

export type StoryDiagnosticPhase = "author" | "review";
export type StoryRejectionIssue = {
  code: "duplicate-pitch" | "unsupported-element" | "resolution-spoiler" | "review-evidence-missing"
    | "review-evidence-invalid" | "review-quote-mismatch" | "review-unknown-moment"
    | "review-brief-quote-mismatch" | "review-time-budget" | "review-unavailable" | "review-approval-marker-missing" | "review-evidence-format-mismatch" | "gateway-rejected";
  treatmentIndex?: number;
  element?: "incident" | "protagonist" | "goal" | "opposition" | "stakes";
  verdict?: "contradicted" | "unclear" | "expressed-and-supported";
  kind?: "faithful" | "bold" | "wildcard";
};
export type StoryGatewayRejection = { phase: StoryDiagnosticPhase; httpStatus: number; issues: StoryRejectionIssue[] };
export type StoryDiagnosticEvent = {
  phase: StoryDiagnosticPhase;
  reviewAttempt?: 1 | 2;
  outcome: "authored-unreviewed" | "rejected" | "review-passed";
  authoredOutput?: unknown;
  actualModel?: string;
  rejection?: StoryGatewayRejection;
  httpStatus?: number;
  gatewayReviewMarker?: "passed" | "missing-or-invalid";
};
export type StoryDiagnosticDescriptor = {
  version: 1; runId: string; storage: "private-trigger-run-metadata";
  key: "storyAuthoredDiagnosticRecord" | "storyReviewDiagnosticRecord" | "storyReviewRepairDiagnosticRecord"; sha256: string;
  phase: StoryDiagnosticPhase; outcome: StoryDiagnosticEvent["outcome"];
  rejectionCodes?: StoryRejectionIssue["code"][];
};
export type StoryDiagnosticContext = {
  runId: string; ownerId: string; requestedModel: string;
  inputSha256: string; reviewContextSha256: string;
};
export const STORY_DIAGNOSTIC_MAX_BYTES = 96 * 1024;
export const STORY_TOTAL_METADATA_MAX_BYTES = 256 * 1024;
const PROGRESS_METADATA_RESERVE_BYTES = 4 * 1024;
const elements = "incident|protagonist|goal|opposition|stakes";
const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** The worker context, never a caller-supplied payload owner, supplies these tags. */
export function storyDiagnosticOwnerFromTags(tags: readonly string[]) {
  const owners = tags.filter(tag => tag.startsWith("user:"));
  if (owners.length !== 1 || !/^user:[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/.test(owners[0])) {
    throw new Error("Story diagnostics require exactly one authenticated owner tag.");
  }
  return owners[0].slice(5);
}

/** Only fixed gateway diagnostics survive; provider text, URLs and headers never do. */
export function classifyStoryGatewayRejection(phase: StoryDiagnosticPhase, httpStatus: number, detail: unknown): StoryGatewayRejection {
  const issues: StoryRejectionIssue[] = [];
  if (typeof detail === "string" && detail.length <= 800 && detail.startsWith("Story logline review failed: ")) {
    for (const reason of detail.slice("Story logline review failed: ".length).split(/; (?=treatment [1-3] )/).slice(0, 3)) {
      const duplicate = reason.match(/^(faithful|bold|wildcard) repeats an earlier pitch; develop a different logline, synopsis and visualThesis while preserving the brief$/);
      const element = reason.match(new RegExp(`^treatment ([1-3]) (${elements}) needs expression in the logline and story support \\(verdict: (contradicted|unclear|expressed-and-supported)\\)$`));
      const spoiler = reason.match(/^treatment ([1-3]) must avoid revealing its resolution$/);
      const evidence = reason.match(new RegExp(`^treatment ([1-3]) (${elements}) reviewer (logline quote is not an exact excerpt|cited an unknown moment id|brief quote is not an exact excerpt)$`));
      if (duplicate) issues.push({ code: "duplicate-pitch", kind: duplicate[1] as StoryRejectionIssue["kind"] });
      else if (element) issues.push({ code: element[3] === "expressed-and-supported" ? "review-evidence-missing" : "unsupported-element", treatmentIndex: Number(element[1]), element: element[2] as StoryRejectionIssue["element"], verdict: element[3] as StoryRejectionIssue["verdict"] });
      else if (spoiler) issues.push({ code: "resolution-spoiler", treatmentIndex: Number(spoiler[1]) });
      else if (evidence) issues.push({ code: evidence[3] === "cited an unknown moment id" ? "review-unknown-moment" : evidence[3] === "brief quote is not an exact excerpt" ? "review-brief-quote-mismatch" : "review-quote-mismatch", treatmentIndex: Number(evidence[1]), element: evidence[2] as StoryRejectionIssue["element"] });
      else if (reason === "reviewer returned incomplete or invalid evidence; retry the story request") issues.push({ code: "review-evidence-invalid" });
      else if (reason === "review exceeded its time budget; retry the story request") issues.push({ code: "review-time-budget" });
      else if (reason === "reviewer unavailable; retry the story request") issues.push({ code: "review-unavailable" });
    }
  }
  return { phase, httpStatus: Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : 502, issues: issues.length ? issues : [{ code: "gateway-rejected" }] };
}

function text(value: unknown, maximum: number) {
  if (typeof value !== "string" || value.length > maximum) throw new Error("Story diagnostic text is outside its bound.");
  return value;
}
function texts(value: unknown, maximum: number, length: number) {
  if (!Array.isArray(value) || value.length > length) throw new Error("Story diagnostic array is outside its bound.");
  return value.map(item => text(item, maximum));
}
function pickText(source: Record<string, unknown>, fields: Record<string, number>) {
  const target: Record<string, unknown> = {};
  for (const [key, maximum] of Object.entries(fields)) if (source[key] !== undefined) target[key] = text(source[key], maximum);
  return target;
}
function finite(value: unknown, minimum = 0, maximum = 86_400) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error("Story diagnostic number is outside its bound.");
  return value;
}
function constraints(value: unknown) {
  if (!record(value)) throw new Error("Story diagnostic constraints must be an object.");
  const result = pickText(value, { setting: 240, intent: 240 });
  for (const key of ["subjects", "actions", "excludedActions", "actionSequence", "physicalStates"]) if (value[key] !== undefined) result[key] = texts(value[key], 180, 12);
  if (value.focalSubjectCount !== undefined) {
    result.focalSubjectCount = finite(value.focalSubjectCount, 0, 100);
    if (!Number.isInteger(result.focalSubjectCount)) throw new Error("Story diagnostic subject count must be an integer.");
  }
  return result;
}
function requirement(value: unknown) {
  if (!record(value)) throw new Error("Story diagnostic requirement must be an object.");
  const result = pickText(value, { id: 120, momentId: 80, description: 500 });
  if (value.optional !== undefined) { if (typeof value.optional !== "boolean") throw new Error("Invalid optional flag."); result.optional = value.optional; }
  if (value.durationSeconds !== undefined) result.durationSeconds = finite(value.durationSeconds);
  if (value.constraints !== undefined) result.constraints = constraints(value.constraints);
  return result;
}
function anchor(value: unknown) {
  if (!record(value)) throw new Error("Story diagnostic moment must be an object.");
  const result = pickText(value, { id: 80, title: 100, description: 500, purpose: 240, generationPrompt: 600, role: 100 });
  if (value.optional !== undefined) { if (typeof value.optional !== "boolean") throw new Error("Invalid optional flag."); result.optional = value.optional; }
  if (value.causalDependencies !== undefined) result.causalDependencies = texts(value.causalDependencies, 80, 15);
  if (value.requirements !== undefined) {
    if (!Array.isArray(value.requirements) || value.requirements.length > 12) throw new Error("Too many diagnostic requirements.");
    result.requirements = value.requirements.map(requirement);
  }
  if (value.songWindow !== undefined) {
    if (!record(value.songWindow)) throw new Error("Invalid diagnostic song window.");
    result.songWindow = { start: finite(value.songWindow.start), end: finite(value.songWindow.end) };
  }
  return result;
}
function treatment(value: unknown) {
  if (!record(value)) throw new Error("Story diagnostic treatment must be an object.");
  const result = pickText(value, { id: 120, kind: 12, title: 100, logline: 320, synopsis: 900, visualThesis: 400, endingHook: 320, structure: 20 });
  if (value.loglineElements !== undefined) {
    if (!record(value.loglineElements)) throw new Error("Invalid diagnostic logline elements.");
    result.loglineElements = pickText(value.loglineElements, { incident: 240, protagonist: 240, goal: 240, opposition: 240, stakes: 240 });
  }
  for (const key of ["expectedReusePercent", "expectedGenerationPercent"]) if (value[key] !== undefined) result[key] = finite(value[key], 0, 100);
  if (value.anchors !== undefined) {
    if (!Array.isArray(value.anchors) || value.anchors.length > 15) throw new Error("Too many diagnostic moments.");
    result.anchors = value.anchors.map(anchor);
  }
  return result;
}

/** Diagnostic retention never parses, repairs, hydrates or approves a treatment. */
export function sanitizeStoryDiagnosticCandidate(value: unknown) {
  if (!record(value)) throw new Error("Story diagnostic output must be an object.");
  if (Array.isArray(value.treatments) && value.treatment === undefined && value.treatments.length >= 1 && value.treatments.length <= 3) return { treatments: value.treatments.map(treatment) };
  if (record(value.treatment) && value.treatments === undefined) return { treatment: treatment(value.treatment) };
  throw new Error("Story diagnostic output has an unsupported envelope.");
}

export function storyDiagnosticContext(args: { runId: string; tags: readonly string[]; requestedModel: string; input: string; reviewContext: unknown }): StoryDiagnosticContext {
  if (!/^run_[A-Za-z0-9]{1,96}$/.test(args.runId)) throw new Error("Invalid Story diagnostic run ID.");
  return { runId: args.runId, ownerId: storyDiagnosticOwnerFromTags(args.tags), requestedModel: text(args.requestedModel, 200), inputSha256: sha256(args.input), reviewContextSha256: sha256(JSON.stringify(args.reviewContext)) };
}

export async function persistStoryTreatmentDiagnostic(context: StoryDiagnosticContext, event: StoryDiagnosticEvent, dependencies: {
  currentMetadata: () => unknown;
  writeMetadata: (key: StoryDiagnosticDescriptor["key"], record: Record<string, unknown>) => Promise<void>;
  now?: () => Date;
}): Promise<StoryDiagnosticDescriptor> {
  // Revalidate even when a test or future internal caller constructs the context.
  storyDiagnosticOwnerFromTags([`user:${context.ownerId}`]);
  if (!/^run_[A-Za-z0-9]{1,96}$/.test(context.runId) || !/^[a-f0-9]{64}$/.test(context.inputSha256) || !/^[a-f0-9]{64}$/.test(context.reviewContextSha256)) throw new Error("Invalid Story diagnostic context.");
  if (!["author", "review"].includes(event.phase) || !["authored-unreviewed", "rejected", "review-passed"].includes(event.outcome)) throw new Error("Invalid Story diagnostic phase or outcome.");
  if (event.reviewAttempt !== undefined && (event.phase !== "review" || ![1, 2].includes(event.reviewAttempt))) throw new Error("Invalid Story review attempt.");
  if (event.httpStatus !== undefined && (!Number.isInteger(event.httpStatus) || event.httpStatus < 100 || event.httpStatus > 599)) throw new Error("Invalid diagnostic HTTP status.");
  if (event.gatewayReviewMarker !== undefined && !["passed", "missing-or-invalid"].includes(event.gatewayReviewMarker)) throw new Error("Invalid diagnostic review marker.");
  const rejection = event.rejection ? sanitizeRejection(event.rejection, event.phase) : undefined;
  const candidate = event.authoredOutput === undefined ? undefined : sanitizeStoryDiagnosticCandidate(event.authoredOutput);
  const actualModel = event.actualModel === undefined ? undefined : text(event.actualModel, 200);
  const data = { version: 1, acceptance: "diagnostic-only-not-approved", runId: context.runId, ownerId: context.ownerId,
    recordedAt: (dependencies.now?.() ?? new Date()).toISOString(), phase: event.phase, outcome: event.outcome, reviewAttempt: event.reviewAttempt,
    requestedModel: text(context.requestedModel, 200), actualAuthorModel: actualModel, inputSha256: context.inputSha256,
    reviewContextSha256: context.reviewContextSha256,
    // Retain the candidate once. Later records refer to its exact whitelisted bytes.
    candidate: event.outcome === "authored-unreviewed" ? candidate : undefined,
    candidateSha256: candidate ? sha256(JSON.stringify(candidate)) : undefined,
    rejection, httpStatus: event.httpStatus, gatewayReviewMarker: event.gatewayReviewMarker, reviewerEvidenceAvailable: false,
    reviewerEvidenceLimitation: "The gateway returns a fixed rejection diagnostic, not the critic's raw JSON. No unavailable critic evidence is inferred." };
  const serialized = JSON.stringify(data, null, 2);
  if (Buffer.byteLength(serialized) > STORY_DIAGNOSTIC_MAX_BYTES) throw new Error("Story diagnostic byte bound exceeded.");
  const key = event.outcome === "authored-unreviewed" ? "storyAuthoredDiagnosticRecord" : event.reviewAttempt === 2 ? "storyReviewRepairDiagnosticRecord" : "storyReviewDiagnosticRecord";
  assertStoryDiagnosticMetadataBudget(dependencies.currentMetadata(), key, data);
  await dependencies.writeMetadata(key, data);
  return { version: 1, runId: context.runId, storage: "private-trigger-run-metadata", key, sha256: sha256(serialized), phase: event.phase, outcome: event.outcome, rejectionCodes: rejection?.issues.map(issue => issue.code) };
}

/** Account for existing progress and the other diagnostic before touching metadata. */
export function assertStoryDiagnosticMetadataBudget(current: unknown, key: StoryDiagnosticDescriptor["key"], data: unknown) {
  if (current !== undefined && !record(current)) throw new Error("Invalid current metadata object.");
  const bytes = Buffer.byteLength(JSON.stringify({ ...(current ?? {}) as Record<string, unknown>, [key]: data }));
  if (bytes > STORY_TOTAL_METADATA_MAX_BYTES - PROGRESS_METADATA_RESERVE_BYTES) throw new Error("Story diagnostics exceed the total metadata budget.");
  return bytes;
}

function sanitizeRejection(value: StoryGatewayRejection, phase: StoryDiagnosticPhase): StoryGatewayRejection {
  const codes: StoryRejectionIssue["code"][] = ["duplicate-pitch", "unsupported-element", "resolution-spoiler", "review-evidence-missing", "review-evidence-invalid", "review-quote-mismatch", "review-unknown-moment", "review-brief-quote-mismatch", "review-time-budget", "review-unavailable", "review-approval-marker-missing", "review-evidence-format-mismatch", "gateway-rejected"];
  if (value.phase !== phase || !Number.isInteger(value.httpStatus) || value.httpStatus < 100 || value.httpStatus > 599 || !Array.isArray(value.issues) || value.issues.length < 1 || value.issues.length > 3) throw new Error("Invalid Story diagnostic rejection.");
  const issues = value.issues.map(issue => {
    if (!codes.includes(issue.code)) throw new Error("Unknown Story diagnostic rejection code.");
    const safe: StoryRejectionIssue = { code: issue.code };
    if (issue.treatmentIndex !== undefined) { if (![1, 2, 3].includes(issue.treatmentIndex)) throw new Error("Invalid diagnostic treatment index."); safe.treatmentIndex = issue.treatmentIndex; }
    if (issue.element !== undefined) { if (!elements.split("|").includes(issue.element)) throw new Error("Invalid diagnostic element."); safe.element = issue.element; }
    if (issue.verdict !== undefined) { if (!["contradicted", "unclear", "expressed-and-supported"].includes(issue.verdict)) throw new Error("Invalid diagnostic verdict."); safe.verdict = issue.verdict; }
    if (issue.kind !== undefined) { if (!["faithful", "bold", "wildcard"].includes(issue.kind)) throw new Error("Invalid diagnostic kind."); safe.kind = issue.kind; }
    return safe;
  });
  return { phase, httpStatus: value.httpStatus, issues };
}
