import { listH3Jobs } from "./h3JobStore";
import { readH3StillJob } from "./h3StillJobStore";
import type { SavedStudioProject } from "./studioProjectStore";
import { animaticShotBinding, normalizeStillAnimaticPlan } from "@/components/studio/stillAnimatic";
import { isProjectWorkActive, type ProjectWorkRow, type ProjectWorkSnapshot } from "@/components/studio/projectWorkSnapshot";
import { projectReviewCut } from "./projectReviewCut";

const cache = new Map<string, { expires: number; promise: Promise<ProjectWorkSnapshot> }>();
let activeReads = 0;

/** Independent, read-only receipt projection. Never dispatches or reconciles jobs. */
export async function readProjectWorkSnapshot(ownerId: string, saved: SavedStudioProject): Promise<ProjectWorkSnapshot> {
  const projectId = saved.project.id;
  const key = JSON.stringify([ownerId, projectId, saved.revision]);
  const existing = cache.get(key);
  if (existing && existing.expires > Date.now()) return existing.promise;
  if (activeReads >= 4) throw new Error("Queue reads are busy.");
  activeReads++;
  const promise = projectWork(ownerId, projectId, saved).finally(() => { activeReads--; });
  cache.delete(key); cache.set(key, { expires: Infinity, promise });
  while (cache.size > 32) cache.delete(cache.keys().next().value!);
  try {
    const result = await promise;
    if (cache.get(key)?.promise === promise) cache.set(key, { expires: Date.now() + 10_000, promise });
    return result;
  } catch (error) { if (cache.get(key)?.promise === promise) cache.delete(key); throw error; }
}

async function projectWork(ownerId: string, projectId: string, saved: SavedStudioProject): Promise<ProjectWorkSnapshot> {
  const plan = normalizeStillAnimaticPlan(saved.draft.storyState.stillAnimaticPlan) ?? null;
  if (saved.draft.storyState.stillAnimaticPlan && !plan) throw new Error("Shot plan is unreadable.");
  const shots = new Map(plan?.shots.map(shot => [shot.id, shot]) ?? []);
  const itemIds = new Set(saved.draft.musicVideoProject?.editPlan.timelineItems.map(item => item.id) ?? []);
  const deadline = AbortSignal.timeout(20_000);
  const jobs = await listH3Jobs(ownerId, projectId, deadline);
  const selected = new Set(projectReviewCut(projectId, saved.draft, plan).segments.flatMap(s => s.generatedAssetId ? [s.generatedAssetId] : []));
  const rows: ProjectWorkRow[] = jobs.map(job => {
    const shotId = job.request.animaticMotion?.shotId ?? job.request.timelineItemId ?? job.request.sectionId;
    const shot = shots.get(shotId);
    return { id: job.id, kind: "video", shotId, state: job.state, updatedAt: job.updatedAt, runId: job.runId,
      attempt: job.request.attempt ?? 0, selected: Boolean(job.result?.asset && selected.has(job.result.asset.id)),
      currentPlan: plan ? Boolean(shot && animaticShotBinding(plan, shot).bindingSha256 === job.request.animaticMotion?.bindingSha256)
        : itemIds.has(job.request.timelineItemId ?? "") };
  });
  const records = new Map<string, { id: string; shotId: string; current: boolean; attempt: number }>();
  for (const shot of plan?.shots ?? []) {
    if (shot.record) records.set(shot.record.jobId ?? `intent:${shot.record.request.requestIntentId}`, {
      id: shot.record.jobId ?? `intent:${shot.record.request.requestIntentId}`, shotId: shot.id,
      current: shot.record.context === animaticShotBinding(plan!, shot).bindingSha256, attempt: shot.record.request.attempt });
  }
  for (const scene of saved.draft.storyState.sceneProofPlan?.scenes ?? []) for (const moment of scene.moments) {
    if (moment.record) records.set(moment.record.jobId ?? `intent:${moment.record.request.requestIntentId}`, {
      id: moment.record.jobId ?? `intent:${moment.record.request.requestIntentId}`, shotId: `${scene.id} ${moment.role}`, current: !plan,
      attempt: moment.record.request.attempt });
  }
  let partial = false;
  const imageRows = [...records.values()];
  for (let i = 0; i < imageRows.length; i += 8) {
    deadline.throwIfAborted();
    const batch = await Promise.all(imageRows.slice(i, i + 8).map(async record => {
      let job;
      try { if (!record.id.startsWith("intent:")) job = await readH3StillJob(ownerId, projectId, record.id); }
      catch { partial = true; }
      if (!job && !record.id.startsWith("intent:")) partial = true;
      return { id: record.id, kind: "image" as const, shotId: record.shotId, currentPlan: record.current, attempt: record.attempt,
        state: job?.state ?? (record.id.startsWith("intent:") ? "submission_unknown" : "unavailable"),
        updatedAt: job?.updatedAt ?? "", runId: job?.runId, selected: false };
    }));
    rows.push(...batch);
  }
  rows.sort((a, b) => Number(isProjectWorkActive(b)) - Number(isProjectWorkActive(a)) || Number(b.currentPlan) - Number(a.currentPlan)
    || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  return { projectId, revision: saved.revision ?? "", checkedAt: new Date().toISOString(), total: rows.length, partial, rows: rows.slice(0, 500) };
}
