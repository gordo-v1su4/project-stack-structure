import { normalizeSongRanges, type SongRange } from "./reviewSelection";
import type { Tab } from "./types";

export function readReviewPreviewContext(search: string): { shotId?: string; ranges: SongRange[] } {
  const params = new URLSearchParams(search);
  const shot = params.get("shot") ?? "";
  const ranges = (params.get("ranges") ?? "").slice(0, 2048).split(",").slice(0, 32).flatMap(value => {
    const match = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(value);
    return match && Number(match[2]) <= 3600 ? [{ start: Number(match[1]), end: Number(match[2]) }] : [];
  });
  return { shotId: /^[\w-]{1,96}$/.test(shot) ? shot : undefined, ranges: normalizeSongRanges(ranges) };
}

export type ReviewStage = "story" | "draft";
export type ReviewLinkContext = { shotId?: string; ranges?: SongRange[]; stage?: ReviewStage };

export function reviewPreviewHref(projectId: string, context: ReviewLinkContext = {}) {
  const params = new URLSearchParams();
  if (context.shotId && /^[\w-]{1,96}$/.test(context.shotId)) params.set("shot", context.shotId);
  const ranges = normalizeSongRanges(context.ranges ?? []).filter(r => r.end <= 3600).slice(0, 32);
  if (ranges.length) params.set("ranges", ranges.map(r => `${r.start}-${r.end}`).join(","));
  if (context.stage === "story" || context.stage === "draft") params.set("stage", context.stage);
  return `/preview/${encodeURIComponent(projectId)}${params.size ? `?${params}` : ""}`;
}

/** Only viewing context crosses routes. No playback, save or adoption instruction. */
export function studioReviewHref(projectId: string, context: ReviewLinkContext = {}) {
  const href = reviewPreviewHref(projectId, context);
  const params = new URLSearchParams(href.split("?")[1] ?? "");
  params.set("reviewProject", projectId);
  return `/?${params}`;
}

export function readStudioReviewContext(search: string) {
  const params = new URLSearchParams(search), projectId = params.get("reviewProject") ?? "";
  if (!/^[\w-]{1,128}$/.test(projectId)) return null;
  return { projectId, ...readReviewPreviewContext(search), stage: params.get("stage") === "draft" ? "draft" as const : "story" as const };
}

/** Apply return stage after persisted UI settings, and only for that project. */
export function restoredReviewTab(projectId: string | null, savedTab: Tab | undefined, search: string): Tab | undefined {
  const incoming = readStudioReviewContext(search);
  return incoming && incoming.projectId === projectId ? incoming.stage === "draft" ? "generate" : "story" : savedTab;
}
