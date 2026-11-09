import { generationScopeSha256 } from "@/components/studio/generationScope";
import { parseH3ShotPlanningResult, type H3ShotDirection, type H3ShotPlanningInput, type H3ShotPlanningResult, type H3ShotPlanningWindow } from "@/components/studio/h3ShotPlanning";
import type { ShotRequirementConstraints } from "@/components/studio/storyMatchAssessment";
import { resolveSceneCaptionGatewayAuth } from "./sceneCaptionGateway";

export const H3_SHOT_GATEWAY_LIMITS = { chunkWindows: 24, bodyBytes: 128 * 1024, contextCharacters: 24_000,
  timeoutMs: 900_000, maximumTimeoutMs: 1_800_000 } as const;
export const H3_SHOT_REVIEW_VIOLATIONS = ["approved_story", "subjects", "constraints", "action_order", "repeated_action", "boundary_state", "continuity", "unclear"] as const;
export type H3ShotAuthorInput = {
  version: 1; bindingSha256: string;
  context: { approvedDirection: string; constraints: ShotRequirementConstraints; subjectNames: string[];
    previousExitState?: string; completedActionCount: number; remainingWindowCount: number };
  windows: ({ id: number } & Pick<H3ShotPlanningWindow, "songStart" | "songEnd" | "inference" | "sourceEvidence" | "generatedEvidence">)[];
};
export type H3ShotChunkCandidate = { version: 1; bindingSha256: string;
  directions: (Omit<H3ShotDirection, "windowKey"> & { windowId: number })[] };
export type H3ShotSemanticReview = { version: 1; bindingSha256: string; candidateSha256: string;
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
  if (!objectKeys(value, ["version", "bindingSha256", "directions"]) || value.version !== 1
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
    // Admit every possible chunk context and request before any model call.
    for (const group of snapshot.groups) {
      const context = { approvedDirection: group.approvedDirection, constraints: group.constraints, subjectNames: snapshot.subjectNames,
        completedActionCount: 0, remainingWindowCount: group.windows.length };
      if (JSON.stringify({ ...context, previousExitState: "x".repeat(800) }).length > H3_SHOT_GATEWAY_LIMITS.contextCharacters) fail("Shot planning context exceeds gateway admission limits.");
      for (let offset = 0; offset < group.windows.length; offset += H3_SHOT_GATEWAY_LIMITS.chunkWindows) boundedJson({ version: 1, bindingSha256,
        context: { ...context, previousExitState: "界".repeat(800) }, windows: group.windows.slice(offset, offset + H3_SHOT_GATEWAY_LIMITS.chunkWindows).map((window, id) => ({ id: offset + id,
          songStart: window.songStart, songEnd: window.songEnd, inference: window.inference,
          ...(window.sourceEvidence ? { sourceEvidence: window.sourceEvidence } : {}),
          ...(window.generatedEvidence ? { generatedEvidence: window.generatedEvidence } : {}) })) });
    }
    const directions: H3ShotDirection[] = [];
    for (const group of snapshot.groups) {
      let previousExitState: string | undefined;
      let completedActionCount = 0;
      for (let offset = 0; offset < group.windows.length; offset += H3_SHOT_GATEWAY_LIMITS.chunkWindows) {
        const windows = group.windows.slice(offset, offset + H3_SHOT_GATEWAY_LIMITS.chunkWindows);
        const context: H3ShotAuthorInput["context"] = { approvedDirection: group.approvedDirection,
          constraints: group.constraints, subjectNames: snapshot.subjectNames, ...(previousExitState !== undefined ? { previousExitState } : {}),
          completedActionCount, remainingWindowCount: group.windows.length - offset };
        const wireWindows = windows.map((window, index) => ({ id: offset + index, songStart: window.songStart, songEnd: window.songEnd, inference: window.inference,
          ...(window.sourceEvidence ? { sourceEvidence: window.sourceEvidence } : {}),
          ...(window.generatedEvidence ? { generatedEvidence: window.generatedEvidence } : {}) }));
        const wire: H3ShotAuthorInput = { version: 1,
          bindingSha256: generationScopeSha256({ inputBinding: bindingSha256, groupId: group.id, context, windows: wireWindows }), context, windows: wireWindows };
        const candidate = chunkCandidate(await post("/story/shots/author", wire), wire);
        const candidateSha256 = generationScopeSha256(candidate);
        const review = await post("/story/shots/review", { input: wire, candidate, candidateSha256 });
        if (!objectKeys(review, ["version", "bindingSha256", "candidateSha256", "status", "violations"]) || review.version !== 1
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
