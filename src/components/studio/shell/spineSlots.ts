import { buildGeneratedAssetPlaybackUrl, type GeneratedStudioAsset } from "../generatedAssets";
import type { EditPlanPreviewSegment, MusicVideoProject, SemanticClipMatch, StorySection, VideoMoment } from "../musicVideoProject";
import { buildMatchCandidateRailItems, type MatchCandidateRailItem } from "../panels/matchCandidateRailModel";
import { getDisplayCaption } from "../panels/matchCaptions";

export type SpineSlotKind = "footage" | "generated";

/**
 * One cut on the song timeline. Built from the resolved preview segments, so
 * the spine shows exactly what the prepared cut plays — including approved
 * generated shots, which are labeled rather than hidden.
 */
export interface SpineSlot {
  id: string;
  index: number;
  sectionId: string;
  sectionLabel: string;
  start: number;
  end: number;
  duration: number;
  label: string;
  kind: SpineSlotKind;
  videoUrl: string;
  momentId: string | null;
  thumbnailUrl: string | null;
  sourceRefLabel: string | null;
  generatedAssetId: string | null;
}

export interface SlotEvidence {
  slot: SpineSlot;
  section: StorySection | null;
  moment: VideoMoment | null;
  caption: string | null;
  lyrics: string[];
  match: SemanticClipMatch | null;
  /** Alternate takes for the slot's section, ranked, with the current one flagged. */
  takes: MatchCandidateRailItem[];
  generated: GeneratedStudioAsset | null;
}

export function slotId(segment: Pick<EditPlanPreviewSegment, "sectionId" | "musicStart">, index: number) {
  return `${segment.sectionId}:${index}:${segment.musicStart.toFixed(2)}`;
}

export function buildSpineSlots(params: {
  segments: EditPlanPreviewSegment[];
  project: MusicVideoProject | null;
  generatedAssets: GeneratedStudioAsset[];
}): SpineSlot[] {
  const sectionLabelById = new Map((params.project?.storySections ?? []).map((section) => [section.id, section.label]));
  const generatedByUrl = new Map<string, GeneratedStudioAsset>();
  for (const asset of params.generatedAssets) {
    const url = buildGeneratedAssetPlaybackUrl(asset);
    if (url) generatedByUrl.set(url, asset);
  }

  return params.segments.map((segment, index) => {
    const generated = generatedByUrl.get(segment.videoUrl) ?? null;
    return {
      id: slotId(segment, index),
      index,
      sectionId: segment.sectionId,
      sectionLabel: sectionLabelById.get(segment.sectionId) ?? segment.sectionId,
      start: segment.musicStart,
      end: segment.musicEnd,
      duration: Math.max(0, segment.musicEnd - segment.musicStart),
      label: segment.label,
      kind: generated ? "generated" : "footage",
      videoUrl: segment.videoUrl,
      momentId: segment.momentId ?? null,
      thumbnailUrl: segment.thumbnailUrl ?? generated?.thumbnailUrl ?? null,
      sourceRefLabel: segment.sourceRefLabel ?? null,
      generatedAssetId: generated?.id ?? null,
    };
  });
}

export function describeSlot(
  slot: SpineSlot,
  params: { project: MusicVideoProject | null; generatedAssets: GeneratedStudioAsset[] },
): SlotEvidence {
  const project = params.project;
  const section = project?.storySections.find((candidate) => candidate.id === slot.sectionId) ?? null;
  const momentsById = new Map((project?.videoMoments ?? []).map((moment) => [moment.id, moment]));
  const moment = slot.momentId ? momentsById.get(slot.momentId) ?? null : null;
  const item = project?.editPlan.timelineItems.find((candidate) => candidate.sectionId === slot.sectionId
    && candidate.start <= slot.start + 0.08 && candidate.end >= slot.end - 0.08) ?? null;
  const lyricChunks = project?.lyricChunks ?? [];
  const lyrics = lyricChunks
    .filter((chunk) => chunk.end > slot.start && chunk.start < slot.end)
    .map((chunk) => chunk.text.trim())
    .filter(Boolean);
  const selectedMatch = section?.semanticMatch ?? item?.semanticMatch ?? null;
  const match = slot.momentId && selectedMatch?.momentId === slot.momentId
    ? selectedMatch
    : section?.candidateMatches?.find((candidate) => candidate.momentId === slot.momentId) ?? null;
  const takes = buildMatchCandidateRailItems({
    candidateMatches: section?.candidateMatches ?? [],
    selectedMomentId: slot.momentId,
    momentsById,
    mode: "balanced",
    limit: 6,
  });
  const generated = slot.generatedAssetId
    ? params.generatedAssets.find((asset) => asset.id === slot.generatedAssetId) ?? null
    : null;

  return {
    slot,
    section,
    moment,
    caption: moment ? getDisplayCaption(moment) || null : null,
    lyrics,
    match,
    takes,
    generated,
  };
}

export function slotAtTime(slots: SpineSlot[], seconds: number): SpineSlot | null {
  return slots.find((slot) => seconds >= slot.start && seconds < slot.end) ?? null;
}

export function neighborSlot(slots: SpineSlot[], selectedId: string | null, direction: -1 | 1): SpineSlot | null {
  if (!slots.length) return null;
  const currentIndex = selectedId ? slots.findIndex((slot) => slot.id === selectedId) : -1;
  if (currentIndex < 0) return direction > 0 ? slots[0] ?? null : slots[slots.length - 1] ?? null;
  const next = currentIndex + direction;
  if (next < 0 || next >= slots.length) return slots[currentIndex] ?? null;
  return slots[next] ?? null;
}
