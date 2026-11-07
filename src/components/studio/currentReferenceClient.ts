import type { PersistedStudioProjectDraft } from "./projectPersistence";
import type { SavedStudioProject } from "@/lib/studioProjectStore";
import { normalizeGenerationScopeReceipt, type GenerationScopeReceipt } from "./generationScope";
import { sourceConfirmationBaselineSha256 } from "./sourceConfirmationClient";
import { STUDIO_JSON_TRANSPORT_HEADERS } from "@/lib/studioJsonTransport";
import { buildCurrentIdentityRequest, type CurrentIdentityAssessment, type CurrentIdentityRequest } from "./currentReferenceIdentity";
import { identityPolicySha256 } from "./issuedIdentityPolicy";

/** Preparation never adopts a reference version; the caller must perform a guarded project save. */
export async function prepareReferenceMigration(params: {
  projectId: string;
  baseline: PersistedStudioProjectDraft;
  isCurrent: () => boolean;
  fetchImpl?: typeof fetch;
}): Promise<{ draft: PersistedStudioProjectDraft; receipt: GenerationScopeReceipt; expectedRevision: string; baselineSha256: string }> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const baselineSha256 = sourceConfirmationBaselineSha256(params.baseline);
  const fresh = await fetchImpl(`/api/studio/projects/${encodeURIComponent(params.projectId)}`, {
    cache: "no-store", headers: STUDIO_JSON_TRANSPORT_HEADERS,
  });
  const payload = await fresh.json() as { saved?: SavedStudioProject & { revision?: string }; error?: string };
  const saved = payload.saved;
  if (!fresh.ok || !saved?.draft || saved.project.id !== params.projectId || !saved.revision) {
    throw new Error(payload.error || "Reload this saved project before updating its references.");
  }
  if (!params.isCurrent() || sourceConfirmationBaselineSha256(saved.draft) !== baselineSha256) {
    throw new Error("The saved project or open draft changed. Reload before updating its references.");
  }
  const response = await fetchImpl("/api/studio/projects/reference-migration", {
    method: "POST", headers: { ...STUDIO_JSON_TRANSPORT_HEADERS, "content-type": "application/json" },
    body: JSON.stringify({ projectId: params.projectId, expectedRevision: saved.revision }),
  });
  const result = await response.json() as {
    draft?: PersistedStudioProjectDraft; receipt?: GenerationScopeReceipt; expectedRevision?: string; baselineSha256?: string; error?: string;
  };
  const receipt = normalizeGenerationScopeReceipt(result.receipt);
  const context = result.draft?.musicVideoProject?.currentIdentity;
  if (!response.ok || !result.draft || !receipt || receipt.body.kind !== "reference-version-migration"
    || receipt.body.projectId !== params.projectId || receipt.body.baselineRevision !== saved.revision
    || result.expectedRevision !== saved.revision || result.baselineSha256 !== baselineSha256
    || result.draft.musicVideoProject?.generationScope?.sha256 !== receipt.sha256
    || !context || context.migrationSha256 !== receipt.sha256
    || receipt.body.referenceMigration?.baselineSha256 !== baselineSha256
    || context.contextSha256 !== receipt.body.referenceMigration?.contextSha256) {
    throw new Error(result.error || "The updated references could not establish a verified candidate.");
  }
  if (!params.isCurrent()) throw new Error("The open project changed while preparing updated references. The candidate was not saved.");
  return { draft: result.draft, receipt, expectedRevision: saved.revision, baselineSha256 };
}

type CheckInput = {
  projectId: string; expectedRevision: string; baselineSha256: string; migrationId: string;
  contextSha256: string; jobId: string; assetId: string; trimStart: number; identityAssessmentId?: string;
};
type CheckReceipt = CheckInput & { version: 1; requestIntentId: string; requestId?: string; runId?: string;
  attempt: number; phase: "prepared" | "submission_unknown" | "accepted" | "known_rejected"; lastError?: string };
type CheckResponse = { request?: CurrentIdentityRequest; runId?: string; assessment?: CurrentIdentityAssessment | null;
  outcome?: { requestId: string; status: "ready" | "failed"; assessmentId?: string; errorCode?: "assessment-failed" };
  error?: string; code?: string };

type CheckParams = CheckInput & {
  isCurrent: () => boolean; fetchImpl?: typeof fetch; storage?: Pick<Storage, "getItem" | "setItem">;
  wait?: () => Promise<void>; maximumPolls?: number;
  lock?: { request: <T>(name: string, callback: () => Promise<T>) => Promise<T> };
};

/** Serialize tabs before touching the receipt; uncertain submissions remain bound to their exact intent. */
export async function checkCurrentReferenceRange(params: CheckParams): Promise<CurrentIdentityAssessment> {
  const key = `studio-current-identity-v1:${params.projectId}:${identityPolicySha256({
    migrationId: params.migrationId, contextSha256: params.contextSha256, jobId: params.jobId,
    assetId: params.assetId, trimStart: params.trimStart, identityAssessmentId: params.identityAssessmentId ?? null,
  })}`;
  const lock = params.lock ?? (typeof navigator !== "undefined" ? navigator.locks : undefined);
  if (!lock) throw new Error("This browser cannot safely coordinate reference checks across tabs. Use a browser with Web Locks support.");
  return lock.request(key, () => runCurrentReferenceCheck(params, key));
}

async function runCurrentReferenceCheck(params: CheckParams, key: string): Promise<CurrentIdentityAssessment> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const storage = params.storage ?? window.localStorage;
  const stored = storage.getItem(key);
  let receipt: CheckReceipt;
  if (stored) {
    try { receipt = JSON.parse(stored) as CheckReceipt; } catch { throw new Error("The saved check receipt is unreadable. Its submission was not repeated."); }
    if (receipt.version !== 1 || receipt.projectId !== params.projectId || receipt.migrationId !== params.migrationId
      || receipt.contextSha256 !== params.contextSha256 || receipt.jobId !== params.jobId || receipt.assetId !== params.assetId
      || receipt.trimStart !== params.trimStart || receipt.identityAssessmentId !== params.identityAssessmentId
      || !receipt.requestIntentId || !receipt.expectedRevision || !receipt.baselineSha256
      || ![1, 2].includes(receipt.attempt) || !["prepared", "submission_unknown", "accepted", "known_rejected"].includes(receipt.phase)) {
      throw new Error("The saved check receipt differs from this take. Its submission was not repeated.");
    }
  } else {
    receipt = { version: 1, projectId: params.projectId, expectedRevision: params.expectedRevision, baselineSha256: params.baselineSha256,
      migrationId: params.migrationId, contextSha256: params.contextSha256, jobId: params.jobId, assetId: params.assetId,
      trimStart: params.trimStart, ...(params.identityAssessmentId ? { identityAssessmentId: params.identityAssessmentId } : {}),
      requestIntentId: crypto.randomUUID(), attempt: 1, phase: "prepared" };
    storage.setItem(key, JSON.stringify(receipt));
  }
  const persist = () => storage.setItem(key, JSON.stringify(receipt));
  const validate = (value: CheckResponse) => {
    const request = value.request;
    if (!request) throw new Error("The existing check is not available yet. Check again to recover it; no new submission was sent.");
    const { id, version, ...body } = request;
    if (version !== 1 || buildCurrentIdentityRequest(body).id !== id || request.migrationId !== receipt.migrationId
      || request.expectedRevision !== receipt.expectedRevision || request.baselineSha256 !== receipt.baselineSha256
      || request.identityAssessmentId !== receipt.identityAssessmentId || request.scope.requestIntentId !== receipt.requestIntentId
      || request.scope.projectId !== receipt.projectId || request.scope.jobId !== receipt.jobId || request.scope.assetId !== receipt.assetId
      || request.scope.trimStart !== receipt.trimStart || request.scope.contextSha256 !== receipt.contextSha256
      || (receipt.requestId && receipt.requestId !== id) || (receipt.runId && value.runId && receipt.runId !== value.runId)) {
      throw new Error("The current-reference response differs from the saved check receipt.");
    }
    receipt = { ...receipt, phase: "accepted", requestId: id, ...(value.runId ? { runId: value.runId } : {}) }; persist();
    if (value.outcome && (value.outcome.requestId !== id || (value.assessment && value.outcome.assessmentId !== value.assessment.scope.id))) {
      throw new Error("The completion receipt differs from this saved request.");
    }
    if (value.assessment) {
      const { id: _assessmentId, policyId: _policyId, policySha256: _policySha, ...assessmentBase } = value.assessment.scope;
      void _assessmentId; void _policyId; void _policySha;
      if (identityPolicySha256(assessmentBase) !== identityPolicySha256(request.scope)) {
        throw new Error("The completed assessment differs from this saved request.");
      }
    }
    return value;
  };
  const read = async () => {
    const query = new URLSearchParams({ projectId: receipt.projectId, requestIntentId: receipt.requestIntentId });
    const response = await fetchImpl(`/api/generate/h3/current-identity?${query}`, { cache: "no-store", headers: STUDIO_JSON_TRANSPORT_HEADERS });
    const value = await response.json() as CheckResponse;
    if (response.status === 404 && value.code === "CURRENT_IDENTITY_REQUEST_NOT_FOUND") return null;
    if (!response.ok) throw new Error(value.error || "Could not recover the saved current-reference check.");
    return validate(value);
  };
  let response: CheckResponse | null = null;
  if (receipt.phase === "known_rejected") {
    // Even a definite pre-submission rejection must be reconciled before reserving another intent.
    response = await read();
    if (!response) {
      const baselineChanged = receipt.expectedRevision !== params.expectedRevision || receipt.baselineSha256 !== params.baselineSha256;
      if (receipt.attempt >= 2 && !baselineChanged) {
        throw new Error(receipt.lastError || "This check was rejected twice. Reload the saved project before another request.");
      }
      storage.setItem(`${key}:rejected:${receipt.requestIntentId}`, JSON.stringify(receipt));
      receipt = { ...receipt, expectedRevision: params.expectedRevision, baselineSha256: params.baselineSha256,
        requestIntentId: crypto.randomUUID(), attempt: baselineChanged ? 1 : receipt.attempt + 1, phase: "prepared", lastError: undefined,
        requestId: undefined, runId: undefined };
      persist();
    }
  }
  if (receipt.phase === "prepared") {
    if (!params.isCurrent()) throw new Error("The open draft changed before the check. Its reserved intent was not submitted.");
    receipt = { ...receipt, phase: "submission_unknown" }; persist();
    try {
      const posted = await fetchImpl("/api/generate/h3/current-identity", {
        method: "POST", headers: { ...STUDIO_JSON_TRANSPORT_HEADERS, "content-type": "application/json" },
        body: JSON.stringify({ projectId: receipt.projectId, expectedRevision: receipt.expectedRevision, migrationId: receipt.migrationId,
          jobId: receipt.jobId, assetId: receipt.assetId, trimStart: receipt.trimStart, requestIntentId: receipt.requestIntentId,
          ...(receipt.identityAssessmentId ? { identityAssessmentId: receipt.identityAssessmentId } : {}) }),
      });
      const value = await posted.json() as CheckResponse;
      if (!posted.ok) {
        // A status code alone cannot prove that dispatch did not happen.
        response = await read();
        if (!response && value.code === "CHECK_NOT_SUBMITTED" && posted.status >= 400 && posted.status < 500) {
          receipt = { ...receipt, phase: "known_rejected", lastError: value.error || "The current-reference request was rejected." }; persist();
        }
        if (!response) throw new Error(value.error || "The current-reference check could not be started. Its intent is preserved.");
      } else response = validate(value);
    } catch (failure) {
      if (receipt.phase === "known_rejected") throw failure;
      response = await read();
      if (!response) throw new Error("The check acknowledgment is unresolved. Check again to recover the same submission.", { cause: failure });
    }
  }
  const wait = params.wait ?? (() => new Promise<void>(resolve => setTimeout(resolve, 2_000)));
  for (let poll = 0; poll < (params.maximumPolls ?? 300); poll++) {
    if (!params.isCurrent()) throw new Error("The open draft changed. The check remains saved; its result was not applied.");
    response ??= await read();
    if (response?.assessment) return response.assessment;
    if (response?.outcome?.status === "failed") throw new Error("The saved current-reference check failed. Its original request and failure remain available.");
    await wait(); response = null;
  }
  throw new Error("The check is still pending. Check again to recover the same submission.");
}
