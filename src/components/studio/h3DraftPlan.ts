import { H3_MAX_SHOT_SECONDS, isH3JobTerminal, type H3GenerationJob, type H3GenerationRequest } from "./h3Generation";
import type { GeneratedStudioAssetTarget } from "./generatedAssets";
import type { EditPlanPreviewSegment } from "./musicVideoProject";
import type { ReferenceAsset } from "./referenceAssets";

/** Generation covers editorial holes; inference handles never extend song time. */
export function planH3DraftWindows(segments: EditPlanPreviewSegment[]) {
  const windows: EditPlanPreviewSegment[] = [];
  for (const segment of segments) {
    if (segment.kind !== "gap" && segment.videoUrl) continue;
    if (!segment.planSignature || !Number.isFinite(segment.musicStart)
      || !Number.isFinite(segment.musicEnd) || segment.musicEnd <= segment.musicStart) continue;
    const previous = windows.at(-1);
    if (previous && Math.abs(previous.musicEnd - segment.musicStart) < 0.001
      && previous.sectionId === segment.sectionId && previous.planSignature === segment.planSignature
      && previous.requirementId === segment.requirementId && previous.timelineItemId === segment.timelineItemId
      && previous.placementId === segment.placementId
      && previous.storyDirection === segment.storyDirection) {
      previous.musicEnd = segment.musicEnd;
      previous.endTime = previous.musicEnd - previous.musicStart;
    } else windows.push({ ...segment });
  }
  return windows.flatMap(segment => {
    const duration = segment.musicEnd - segment.musicStart;
    const count = Math.ceil(duration / H3_MAX_SHOT_SECONDS);
    // Equal subdivision avoids a nearly-empty final shot after a 12s take.
    return Array.from({ length: count }, (_, index) => ({
      ...segment,
      musicStart: segment.musicStart + duration * index / count,
      musicEnd: index === count - 1 ? segment.musicEnd : segment.musicStart + duration * (index + 1) / count,
      startTime: 0,
      endTime: duration / count,
    }));
  });
}

export function h3WindowKey(segment: Pick<EditPlanPreviewSegment, "planSignature" | "requirementId" | "timelineItemId" | "sectionId" | "musicStart" | "musicEnd">) {
  return JSON.stringify([segment.planSignature, segment.requirementId, segment.timelineItemId, segment.sectionId,
    Number(segment.musicStart.toFixed(6)), Number(segment.musicEnd.toFixed(6))]);
}

export function h3RequestWindowKey(request: H3GenerationRequest) {
  return h3WindowKey({ ...request, musicStart: request.songStart, musicEnd: request.songEnd });
}

/** A response loss retries transport with the same intent; existing submissions are never re-enqueued. */
export async function enqueueH3DraftRequest(request: H3GenerationRequest, jobs: H3GenerationJob[], fetchImpl: typeof fetch = fetch): Promise<H3GenerationJob> {
  const existing = jobs.find(job => job.request.requestIntentId === request.requestIntentId && (job.request.attempt ?? 0) === (request.attempt ?? 0));
  if (existing) {
    if (h3RequestWindowKey(existing.request) !== h3RequestWindowKey(request) || existing.request.prompt !== request.prompt
      || existing.request.draftRevision !== request.draftRevision || JSON.stringify(existing.request.referenceAssetIds) !== JSON.stringify(request.referenceAssetIds)) {
      throw new Error("The saved shot request conflicts with an existing submission. Review its current job before continuing.");
    }
    if (existing.runId || existing.state !== "queued") return existing;
  }
  const response = await fetchImpl("/api/generate/h3", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
  const result = await response.json() as { error?: string; jobId?: string; job?: H3GenerationJob };
  if (!response.ok || !result.jobId || !result.job || result.job.id !== result.jobId) throw new Error(result.error || "Could not confirm the render submission. Continue the saved batch to check its existing intent.");
  return result.job;
}

/** A generated take may span several display fragments after partial overlays. */
export function findH3TargetSegment(segments: EditPlanPreviewSegment[], target: GeneratedStudioAssetTarget): EditPlanPreviewSegment | null {
  const matching = segments.filter(segment => segment.planSignature === target.planSignature && segment.sectionId === target.sectionId
    && (target.requirementId ? segment.requirementId === target.requirementId : segment.timelineItemId === target.timelineItemId)
    && segment.musicEnd > target.songStart + 0.001 && segment.musicStart < target.songEnd - 0.001).sort((a, b) => a.musicStart - b.musicStart);
  let end = target.songStart;
  for (const segment of matching) {
    if (segment.musicStart > end + 0.001) return null;
    end = Math.max(end, segment.musicEnd);
  }
  if (!matching.length || end < target.songEnd - 0.001) return null;
  return { ...matching[0], timelineItemId: target.timelineItemId, requirementId: target.requirementId, musicStart: target.songStart, musicEnd: target.songEnd, startTime: 0, endTime: target.songEnd - target.songStart };
}

/** Identity references are attached only when that exact named person is in the shot. */
export function selectH3ReferenceAssetIds(assets: ReferenceAsset[], direction: string): string[] {
  const uploaded = assets.filter(asset => asset.storageStatus === "uploaded" && asset.storageBucket && asset.storagePath && asset.displayName?.trim());
  const mentions = (name: string) => {
    const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu").test(direction);
  };
  const environments = uploaded.filter(asset => asset.kind === "environment" || asset.role === "environment");
  const environment = environments.find(asset => mentions(asset.displayName)) ?? environments.find(asset => asset.role === "environment");
  if (!environment) throw new Error("Upload a named environment reference before creating this shot.");
  const identities = uploaded.filter(asset => (asset.kind === "character" || asset.role.startsWith("character-")) && mentions(asset.displayName));
  if (identities.length > 8) throw new Error("This shot names more characters than the reference limit permits.");
  return [...identities.map(asset => asset.id), environment.id];
}

/** Retrying transport reuses a request unchanged; a deliberate new render increments its bounded attempt. */
export function nextH3Attempt(job: H3GenerationJob, siblings: H3GenerationJob[], draftRevision: number, prompt = job.request.prompt): H3GenerationRequest {
  const intent = siblings.filter(candidate => candidate.request.requestIntentId === job.request.requestIntentId);
  if (intent.some(candidate => !isH3JobTerminal(candidate))) throw new Error("Check the existing submission before creating another take.");
  const attempt = Math.max(job.request.attempt ?? 0, ...intent.map(candidate => candidate.request.attempt ?? 0)) + 1;
  if (attempt > 2) throw new Error("This shot has used its initial render and two revisions. Review the saved takes or change the story plan.");
  return { ...job.request, attempt, draftRevision, prompt };
}

export type H3DraftBatch = { version: 1; projectId: string; planSignature: string; requests: H3GenerationRequest[]; paused: boolean };
export function h3DraftBatchStorageKey(projectId: string) { return `stack-structure:h3-draft-batch:v1:${projectId}`; }
export function parseH3DraftBatch(raw: string | null, projectId: string): H3DraftBatch | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as H3DraftBatch;
    if (value.version !== 1 || value.projectId !== projectId || !value.planSignature || !Array.isArray(value.requests)
      || value.requests.some(request => request.projectId !== projectId || request.planSignature !== value.planSignature
        || !request.requestIntentId || !Number.isFinite(request.songStart) || !Number.isFinite(request.songEnd)
        || request.songEnd <= request.songStart || request.songEnd - request.songStart > H3_MAX_SHOT_SECONDS + 0.001
        || !Array.isArray(request.referenceAssetIds) || !request.prompt
        || !Number.isInteger(request.attempt ?? 0) || (request.attempt ?? 0) < 0 || (request.attempt ?? 0) > 2)) return null;
    return { ...value, paused: Boolean(value.paused) };
  } catch { return null; }
}
