import { buildGeneratedAssetPlaybackUrl, type GeneratedStudioAsset } from "./generatedAssets";
import type { H3GenerationJob, H3GenerationRequest } from "./h3Generation";
import type { H3DraftBatch } from "./h3DraftPlan";

/** Saved edits override job snapshots, including rejection and current-reference evidence. */
export function buildLiveDraftTakes(assets: GeneratedStudioAsset[], jobs: H3GenerationJob[], selectedIds: string[]) {
  const byId = new Map(assets.map(asset => [asset.id, asset]));
  for (const job of jobs) if (job.state === "ready" && job.result?.asset && !byId.has(job.result.asset.id)) {
    byId.set(job.result.asset.id, job.result.asset);
  }
  return [...byId.values()].flatMap(asset => {
    const playbackUrl = buildGeneratedAssetPlaybackUrl(asset);
    return asset.status === "completed" && asset.mediaKind === "video" && playbackUrl
      ? [{ asset, playbackUrl, selected: selectedIds.includes(asset.id) }] : [];
  });
}

export const h3ReviewRequestKey = (request: H3GenerationRequest) => `${request.requestIntentId}:${request.attempt ?? 0}`;

/** Finishing an in-flight request must preserve a pause made while it was rendering. */
export function completeH3ReviewRequest(batch: H3DraftBatch): H3DraftBatch | null {
  const [completed, ...requests] = batch.requests;
  if (!requests.length) return null;
  const pause = Boolean(completed && batch.pauseAfterRequest === h3ReviewRequestKey(completed));
  return { ...batch, requests, paused: batch.paused || pause, ...(pause ? { pauseAfterRequest: undefined } : {}) };
}

/** A deliberate revision runs once and retains every previously queued packet unchanged. */
export function queueH3ReviewRevision(batch: H3DraftBatch | null, request: H3GenerationRequest): H3DraftBatch {
  if (batch && !batch.paused) throw new Error("Pause upcoming submissions before revising a take.");
  if (batch && (batch.projectId !== request.projectId || batch.planSignature !== request.planSignature)) {
    throw new Error("The saved batch belongs to another project or plan.");
  }
  return { version: 1, projectId: request.projectId, planSignature: request.planSignature,
    requests: [request, ...(batch?.requests ?? [])], paused: false, pauseAfterRequest: h3ReviewRequestKey(request) };
}

export function h3ReviewNotesStorageKey(projectId: string) { return `stack-structure:h3-review-notes:v1:${projectId}`; }
export function readH3ReviewNotes(storage: Pick<Storage, "getItem">, projectId: string) {
  return parseH3ReviewNotes(storage.getItem(h3ReviewNotesStorageKey(projectId)));
}
export function writeH3ReviewNotes(storage: Pick<Storage, "setItem">, projectId: string, values: Record<string, string>) {
  storage.setItem(h3ReviewNotesStorageKey(projectId), JSON.stringify(parseH3ReviewNotes(JSON.stringify(values))));
}
export function parseH3ReviewNotes(raw: string | null): Record<string, string> {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] =>
      entry[0].length <= 240 && typeof entry[1] === "string" && entry[1].length <= 6000).slice(0, 500));
  } catch { return {}; }
}
