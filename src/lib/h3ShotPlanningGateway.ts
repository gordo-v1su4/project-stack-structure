import { generationScopeSha256 } from "@/components/studio/generationScope";
import { parseH3ShotPlanningResult, type H3ShotDirection, type H3ShotPlanningInput, type H3ShotPlanningResult, type H3ShotPlanningWindow } from "@/components/studio/h3ShotPlanning";
import type { ShotRequirementConstraints } from "@/components/studio/storyMatchAssessment";
import { resolveSceneCaptionGatewayAuth } from "./sceneCaptionGateway";

export const H3_SHOT_GATEWAY_LIMITS = { chunkWindows: 24, bodyBytes: 128 * 1024, contextCharacters: 24_000,
  canonModelEnvelopeOverheadBytes: 16 * 1024,
  timeoutMs: 900_000, maximumTimeoutMs: 1_800_000 } as const;
export const H3_SHOT_REVIEW_VIOLATIONS = ["approved_story", "subjects", "constraints", "action_order", "repeated_action", "boundary_state", "continuity", "unclear"] as const;
type CanonScope = NonNullable<H3ShotPlanningInput["groups"][number]["storyCanon"]>;
type AuthorCanon = Pick<CanonScope, "version" | "bibleSha256" | "projectionSha256" | "scopeSha256" | "subjectNames" | "referenceAssetIds" | "positiveFacts">;
type ReviewCanon = Pick<CanonScope, "version" | "bibleSha256" | "projectionSha256" | "scopeSha256" | "reviewConstraints">;
export type H3ShotAuthorInput = {
  version: 1; bindingSha256: string;
  context: { approvedDirection: string; constraints: ShotRequirementConstraints; subjectNames: string[];
    previousExitState?: string; completedActionCount: number; remainingWindowCount: number; storyCanon?: AuthorCanon };
  windows: ({ id: number } & Pick<H3ShotPlanningWindow, "songStart" | "songEnd" | "inference" | "sourceEvidence" | "generatedEvidence">)[];
};
export type H3ShotChunkCandidate = { version: 1; bindingSha256: string; canonScopeSha256?: string;
  directions: (Omit<H3ShotDirection, "windowKey"> & { windowId: number })[] };
export type H3ShotSemanticReview = { version: 1; bindingSha256: string; candidateSha256: string; canonScopeSha256?: string;
  status: "passed" | "rejected"; violations: (typeof H3_SHOT_REVIEW_VIOLATIONS)[number][] };
type Dependencies = { fetchImpl?: typeof fetch; now?: () => number; timeoutMs?: number; signal?: AbortSignal;
  env?: Record<string, string | undefined> };

class ShotGatewayError extends Error {}
const fail = (message: string): never => { throw new ShotGatewayError(message); };
function boundedJson(value: unknown): string {
  let json: string | undefined;
  try { json = JSON.stringify(value); } catch { fail("Shot planning gateway payload is not JSON serializable."); }
  if (json === undefined || new TextEncoder().encode(json).length > H3_SHOT_GATEWAY_LIMITS.bodyBytes) fail("Shot planning gateway payload exceeds its byte bound.");
  return json!;
}
const objectKeys = (value: unknown, keys: string[]): value is Record<string, unknown> => Boolean(value && typeof value === "object"
  && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key)));
function chunkCandidate(value: unknown, input: H3ShotAuthorInput): H3ShotChunkCandidate {
  const canon = input.context.storyCanon;
  if (!objectKeys(value, ["version", "bindingSha256", "directions", ...(canon ? ["canonScopeSha256"] : [])]) || value.version !== 1
    || (canon && value.canonScopeSha256 !== canon.scopeSha256)
    || value.bindingSha256 !== input.bindingSha256 || !Array.isArray(value.directions) || value.directions.length !== input.windows.length) fail("Shot author returned a different chunk binding or coverage.");
  const candidate = value as H3ShotChunkCandidate;
  let previousExit = input.context.previousExitState;
  let actionIndex = input.context.completedActionCount;
  const actions = input.context.constraints.actionSequence ?? [];
  for (const [index, direction] of candidate.directions.entries()) {
    if (!objectKeys(direction, ["windowId", "direction", "entryState", "exitState", "actionIndices"])
      || direction.windowId !== input.windows[index].id || !Array.isArray(direction.actionIndices) || direction.actionIndices.length > actions.length) fail("Shot author returned invalid ordered chunk windows.");
    for (const [key, limit] of [["direction", 1600], ["entryState", 800], ["exitState", 800]] as const) {
      const text = direction[key];
      if (typeof text !== "string" || !text.trim() || text !== text.trim() || text.length > limit
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) fail("Shot author returned invalid bounded direction text.");
    }
    if (previousExit !== undefined && previousExit !== direction.entryState) fail("Shot author restarted or changed the carried boundary state.");
    previousExit = direction.exitState;
    for (const action of direction.actionIndices) {
      if (!Number.isInteger(action) || action !== actionIndex || action >= actions.length) fail("Shot author restarted or skipped the approved action sequence.");
      actionIndex++;
    }
  }
  if (input.context.remainingWindowCount === input.windows.length && actionIndex !== actions.length) fail("Shot author did not finish the approved action sequence.");
  return candidate;
}

function canonContexts(scope?: CanonScope): { author?: AuthorCanon; review?: ReviewCanon } {
  if (!scope) return {};
  const { scopeSha256, ...body } = scope;
  if (generationScopeSha256(body) !== scopeSha256) fail("Shot planning canon scope changed.");
  const { version, bibleSha256, projectionSha256, subjectNames, referenceAssetIds, positiveFacts, reviewConstraints } = scope;
  // Whitelist the public projection; the full Bible and provenance never travel.
  const tags = { version, bibleSha256, projectionSha256, scopeSha256 };
  return { author: { ...tags, subjectNames: [...subjectNames], referenceAssetIds: [...referenceAssetIds], positiveFacts: positiveFacts.map(({ id, text }) => ({ id, text })) },
    review: { ...tags, reviewConstraints: reviewConstraints.map(({ id, text }) => ({ id, text })) } };
}

/** Author and independently review bounded chunks. A passed semantic review is
 * model evidence only: no identity certification, creative approval or GPU
 * authorization is issued here. No failed/ambiguous call is automatically retried.
 */
export async function generateH3ShotPlan(input: H3ShotPlanningInput, dependencies: Dependencies = {}): Promise<H3ShotPlanningResult> {
  if (typeof window !== "undefined") fail("Shot planning gateway is server-only.");
  const snapshot = structuredClone(input);
  const { bindingSha256, ...body } = snapshot;
  if (generationScopeSha256(body) !== bindingSha256) fail("Shot planning input binding changed.");
  // The caller supplies canonical input; retain its full binding and bounds.
  if (!snapshot.groups.length || snapshot.groups.length > 64 || snapshot.groups.some(group => !group.windows.length || group.windows.length > 64)
    || snapshot.groups.reduce((total, group) => total + group.windows.length, 0) > 512) fail("Shot planning input exceeds its window bounds.");
  const environment = dependencies.env ?? process.env;
  const gateway = resolveSceneCaptionGatewayAuth(environment);
  let base: URL;
  try { base = new URL(gateway.gatewayUrl); } catch { return fail("Shot planning gateway is not configured."); }
  if (!(environment.SCENE_CAPTION_SMART_GATEWAY_INTERNAL_URL || environment.SCENE_CAPTION_SMART_GATEWAY_URL || environment.QWEN_CAPTION_GATEWAY_URL)
    || !gateway.token || !["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) fail("Shot planning gateway is not configured.");
  const timeoutMs = dependencies.timeoutMs ?? H3_SHOT_GATEWAY_LIMITS.timeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > H3_SHOT_GATEWAY_LIMITS.maximumTimeoutMs) fail("Invalid shot planning deadline.");
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? Date.now;
  const deadline = now() + timeoutMs;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  dependencies.signal?.addEventListener("abort", onAbort, { once: true });
  if (dependencies.signal?.aborted) controller.abort();
  const timer = setTimeout(onAbort, timeoutMs);
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new ShotGatewayError("Shot planning deadline expired or request was cancelled; no automatic retry was attempted.")), { once: true });
  });
  // Attach a rejection handler even if admission fails before the first await.
  void aborted.catch(() => {});
  const checkDeadline = () => { if (now() >= deadline) controller.abort(); if (controller.signal.aborted) fail("Shot planning deadline expired or request was cancelled; no automatic retry was attempted."); };
  async function post(endpoint: "/story/shots/author" | "/story/shots/review", payload: unknown): Promise<unknown> {
    checkDeadline();
    const requestBody = boundedJson(payload);
    const response = await Promise.race([fetchImpl(`${gateway.gatewayUrl}${endpoint}`, { method: "POST", redirect: "error", signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${gateway.token}` }, body: requestBody }), aborted]);
    checkDeadline();
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      if (response.status === 404 || response.status === 405) fail("The configured gateway does not support shot planning; no story-treatment fallback was attempted.");
      fail(`Shot planning gateway rejected the request (${response.status}); no automatic retry was attempted.`);
    }
    const length = response.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > H3_SHOT_GATEWAY_LIMITS.bodyBytes)) { void response.body?.cancel().catch(() => {}); fail("Shot planning gateway response exceeds its byte bound."); }
    if (!response.body) fail("Shot planning gateway returned an empty response.");
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const part = await Promise.race([reader.read(), aborted]);
        checkDeadline();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > H3_SHOT_GATEWAY_LIMITS.bodyBytes) fail("Shot planning gateway response exceeds its byte bound.");
        chunks.push(part.value);
      }
    } catch (error) { void reader.cancel().catch(() => {}); throw error; }
    finally { try { reader.releaseLock(); } catch { /* Aborted reads are cancelled without awaiting cleanup. */ } }
    const joined = new Uint8Array(bytes);
    let offset = 0; for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined)); }
    catch { return fail("Shot planning gateway returned invalid JSON."); }
  }
  try {
    const chunkSizes: number[] = [];
    // JSON escapes can expand one valid boundary-state code unit to six
    // characters. Use the same maximum sentinel for context and byte admission.
    const maximumBoundaryState = "\ud800".repeat(800);
    // Admit every possible chunk context and request before any model call.
    for (const group of snapshot.groups) {
      const canon = canonContexts(group.storyCanon);
      const context = { approvedDirection: group.approvedDirection, constraints: group.constraints, subjectNames: group.storyCanon?.subjectNames ?? snapshot.subjectNames,
        completedActionCount: 0, remainingWindowCount: group.windows.length, ...(canon.author ? { storyCanon: canon.author } : {}) };
      const maximumContext = { ...context, completedActionCount: (group.constraints.actionSequence ?? []).length, previousExitState: maximumBoundaryState };
      if (JSON.stringify(maximumContext).length > H3_SHOT_GATEWAY_LIMITS.contextCharacters) fail("Shot planning context exceeds gateway admission limits.");
      if (canon.review) {
        if (JSON.stringify({ context: maximumContext, canonReview: canon.review }).length > H3_SHOT_GATEWAY_LIMITS.contextCharacters) fail("Shot planning canon review context exceeds gateway admission limits.");
        // Canon jobs pre-admit their largest legal review candidate as well as
        // author input. Legacy jobs retain their exact historical chunking.
        let admitted = 0;
        for (let size = H3_SHOT_GATEWAY_LIMITS.chunkWindows; size >= 1 && !admitted; size--) {
          let fits = true;
          for (let offset = 0; offset < group.windows.length; offset += size) {
            const windows = group.windows.slice(offset, offset + size).map((window, id) => ({ id: offset + id,
              songStart: window.songStart, songEnd: window.songEnd, inference: window.inference,
              ...(window.sourceEvidence ? { sourceEvidence: window.sourceEvidence } : {}), ...(window.generatedEvidence ? { generatedEvidence: window.generatedEvidence } : {}) }));
            // A JSON-escaped UTF-16 code unit can occupy six bytes. Count that
            // worst case rather than assuming every returned character is UTF-8.
            const input = { version: 1, bindingSha256, context: maximumContext, windows };
            const candidate = { version: 1, bindingSha256, canonScopeSha256: canon.review.scopeSha256,
              directions: windows.map(window => ({ windowId: window.id, direction: "\ud800".repeat(1600), entryState: maximumBoundaryState, exitState: maximumBoundaryState,
                actionIndices: (group.constraints.actionSequence ?? []).map((_, index) => index) })) };
            try {
              boundedJson(input); boundedJson({ input, candidate, candidateSha256: "x".repeat(64), canonReview: canon.review });
              // The service critic also receives mechanically composed prose,
              // then JSON-quotes its entire user message inside the model
              // envelope. Reserve the source contract's fixed 16KiB for system
              // text, schema, model ID and options; no service cap is increased.
              const criticInput = { input, candidate, canonReview: canon.review,
                composedDirections: windows.map(window => ({ windowId: window.id, prompt: "\ud800".repeat(3208) })) };
              const quotedBytes = new TextEncoder().encode(JSON.stringify(JSON.stringify(criticInput))).length - 2;
              if (quotedBytes + H3_SHOT_GATEWAY_LIMITS.canonModelEnvelopeOverheadBytes > H3_SHOT_GATEWAY_LIMITS.bodyBytes) { fits = false; break; }
            }
            catch { fits = false; break; }
          }
          if (fits) admitted = size;
        }
        if (!admitted) fail("Shot planning canon review payload exceeds gateway admission limits.");
        chunkSizes.push(admitted);
        continue;
      }
      chunkSizes.push(H3_SHOT_GATEWAY_LIMITS.chunkWindows);
      for (let offset = 0; offset < group.windows.length; offset += H3_SHOT_GATEWAY_LIMITS.chunkWindows) boundedJson({ version: 1, bindingSha256,
        context: maximumContext, windows: group.windows.slice(offset, offset + H3_SHOT_GATEWAY_LIMITS.chunkWindows).map((window, id) => ({ id: offset + id,
          songStart: window.songStart, songEnd: window.songEnd, inference: window.inference,
          ...(window.sourceEvidence ? { sourceEvidence: window.sourceEvidence } : {}),
          ...(window.generatedEvidence ? { generatedEvidence: window.generatedEvidence } : {}) })) });
    }
    const directions: H3ShotDirection[] = [];
    for (const [groupIndex, group] of snapshot.groups.entries()) {
      const canon = canonContexts(group.storyCanon), chunkSize = chunkSizes[groupIndex];
      let previousExitState: string | undefined;
      let completedActionCount = 0;
      for (let offset = 0; offset < group.windows.length; offset += chunkSize) {
        const windows = group.windows.slice(offset, offset + chunkSize);
        const context: H3ShotAuthorInput["context"] = { approvedDirection: group.approvedDirection,
          constraints: group.constraints, subjectNames: group.storyCanon?.subjectNames ?? snapshot.subjectNames, ...(previousExitState !== undefined ? { previousExitState } : {}),
          completedActionCount, remainingWindowCount: group.windows.length - offset, ...(canon.author ? { storyCanon: canon.author } : {}) };
        const wireWindows = windows.map((window, index) => ({ id: offset + index, songStart: window.songStart, songEnd: window.songEnd, inference: window.inference,
          ...(window.sourceEvidence ? { sourceEvidence: window.sourceEvidence } : {}),
          ...(window.generatedEvidence ? { generatedEvidence: window.generatedEvidence } : {}) }));
        const wire: H3ShotAuthorInput = { version: 1,
          bindingSha256: generationScopeSha256({ inputBinding: bindingSha256, groupId: group.id, context, windows: wireWindows }), context, windows: wireWindows };
        const candidate = chunkCandidate(await post("/story/shots/author", wire), wire);
        const candidateSha256 = generationScopeSha256(candidate);
        const review = await post("/story/shots/review", { input: wire, candidate, candidateSha256, ...(canon.review ? { canonReview: canon.review } : {}) });
        if (!objectKeys(review, ["version", "bindingSha256", "candidateSha256", "status", "violations", ...(canon.review ? ["canonScopeSha256"] : [])]) || review.version !== 1
          || (canon.review && review.canonScopeSha256 !== canon.review.scopeSha256)
          || review.bindingSha256 !== wire.bindingSha256 || review.candidateSha256 !== candidateSha256 || !Array.isArray(review.violations)
          || review.violations.length > H3_SHOT_REVIEW_VIOLATIONS.length || new Set(review.violations).size !== review.violations.length
          || review.violations.some(code => !H3_SHOT_REVIEW_VIOLATIONS.includes(code as typeof H3_SHOT_REVIEW_VIOLATIONS[number]))
          || review.status !== "passed" || review.violations.length) fail("Independent shot review did not pass the exact candidate; no automatic re-author was attempted.");
        for (const [index, direction] of candidate.directions.entries()) {
          directions.push({ windowKey: windows[index].key, direction: direction.direction, entryState: direction.entryState,
            exitState: direction.exitState, actionIndices: [...direction.actionIndices] });
          completedActionCount += direction.actionIndices.length;
        }
        previousExitState = candidate.directions.at(-1)!.exitState;
      }
    }
    checkDeadline();
    return parseH3ShotPlanningResult({ version: 1, bindingSha256, directions }, snapshot);
  } catch (error) {
    if (error instanceof ShotGatewayError) throw error;
    throw new ShotGatewayError("Shot planning gateway transport or validation failed; no automatic retry was attempted.");
  } finally { clearTimeout(timer); dependencies.signal?.removeEventListener("abort", onAbort); }
}
