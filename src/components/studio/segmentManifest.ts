import { attachMotionDescriptorToSegment, getAuthoritativeMotionDescriptor } from "./motionDescriptors";
import type { SourceClipSpan } from "./sourceTimeline";
import type { BeatJoinAnalysis, MotionDescriptor } from "./types";

export type MusicCutKind = "beat" | "onset" | "section" | "tail";

export interface MusicCutEvent {
  id: string;
  time: number;
  kind: MusicCutKind;
  label?: string;
  sectionLabel?: string;
  quantized: boolean;
}

export interface SegmentManifestItem {
  id: number;
  start: number;
  end: number;
  duration: number;
  sourceClipIds: number[];
  leadingCut: MusicCutEvent;
  trailingCut: MusicCutEvent;
  motionDescriptor: MotionDescriptor | null;
}

export interface RankedSegmentCandidate {
  id: string;
  musicalScore: number;
  continuityScore: number;
  fitPenalty?: number;
}

export function buildMusicCutEvents(params: {
  analysis: BeatJoinAnalysis;
  mode: "beats" | "onsets";
  includeSectionBoundaries?: boolean;
  quantizeStep?: number | null;
  quantizeTolerance?: number;
  minSpacing?: number;
}) {
  const {
    analysis,
    mode,
    includeSectionBoundaries = true,
    quantizeStep = null,
    quantizeTolerance = 0,
    minSpacing = 0.03,
  } = params;
  const duration = Math.max(analysis.duration, 0);
  if (duration <= 0) return [];

  const eventMap = new Map<number, MusicCutEvent>();
  const primaryTimes = mode === "onsets" ? analysis.onsets : analysis.beats;

  for (const time of primaryTimes) {
    upsertEvent(eventMap, {
      time,
      kind: mode === "onsets" ? "onset" : "beat",
      duration,
      quantizeStep,
      quantizeTolerance,
      minSpacing,
    });
  }

  if (includeSectionBoundaries) {
    for (const section of analysis.sections) {
      upsertEvent(eventMap, {
        time: section.start,
        kind: "section",
        label: section.label,
        duration,
        quantizeStep,
        quantizeTolerance,
        minSpacing,
      });
      upsertEvent(eventMap, {
        time: section.end,
        kind: "section",
        label: section.label,
        duration,
        quantizeStep,
        quantizeTolerance,
        minSpacing,
      });
    }
  }

  const events = [...eventMap.values()].sort((left, right) => left.time - right.time);
  const startEvent = createBoundaryEvent(0);
  const endEvent = createBoundaryEvent(duration);

  if (!events.length || events[0]?.time > 0) {
    events.unshift(startEvent);
  } else {
    events[0] = mergeBoundary(events[0], startEvent);
  }

  if (events.at(-1)?.time !== duration) {
    events.push(endEvent);
  } else {
    events[events.length - 1] = mergeBoundary(events[events.length - 1], endEvent);
  }

  return dedupeBySpacing(events, minSpacing);
}

export function buildSegmentManifest(params: {
  sourceClips: SourceClipSpan[];
  cutEvents: MusicCutEvent[];
  totalDuration?: number;
}) {
  const { sourceClips, cutEvents, totalDuration } = params;
  const maxDuration = totalDuration ?? sourceClips.at(-1)?.end ?? cutEvents.at(-1)?.time ?? 0;
  if (maxDuration <= 0 || cutEvents.length < 2) return [];

  const boundedEvents = cutEvents
    .filter((event) => event.time >= 0 && event.time <= maxDuration)
    .sort((left, right) => left.time - right.time);

  const segments: SegmentManifestItem[] = [];
  for (let index = 1; index < boundedEvents.length; index += 1) {
    const leadingCut = boundedEvents[index - 1];
    const trailingCut = boundedEvents[index];
    if (!leadingCut || !trailingCut) continue;

    const start = leadingCut.time;
    const end = trailingCut.time;
    const duration = end - start;
    if (duration <= 0.0001) continue;

    const sourceClipIds = collectSourceClipIds(sourceClips, start, end);
    const filePath = sourceClips.find((clip) => clip.start < end && clip.end > start)?.label ?? "segment";

    segments.push(
      attachMotionDescriptorToSegment(
        {
          id: segments.length,
          start,
          end,
          duration,
          sourceClipIds,
          leadingCut,
          trailingCut,
          motionDescriptor: null,
        },
        filePath,
      ),
    );
  }

  return segments;
}

export function pickBestSegmentCandidate(candidates: RankedSegmentCandidate[]) {
  return [...candidates].sort(compareSegmentCandidates)[0] ?? null;
}

export function compareSegmentCandidates(left: RankedSegmentCandidate, right: RankedSegmentCandidate) {
  if (left.musicalScore !== right.musicalScore) {
    return right.musicalScore - left.musicalScore;
  }

  if (left.continuityScore !== right.continuityScore) {
    return right.continuityScore - left.continuityScore;
  }

  const leftPenalty = left.fitPenalty ?? 0;
  const rightPenalty = right.fitPenalty ?? 0;
  if (leftPenalty !== rightPenalty) {
    return leftPenalty - rightPenalty;
  }

  return left.id.localeCompare(right.id);
}

export function resolveSegmentMotionDescriptor(params: {
  segment: SegmentManifestItem;
  fileDescriptor?: MotionDescriptor | null;
}) {
  return getAuthoritativeMotionDescriptor({
    segmentDescriptor: params.segment.motionDescriptor,
    fileDescriptor: params.fileDescriptor,
  });
}

function collectSourceClipIds(sourceClips: SourceClipSpan[], start: number, end: number) {
  return sourceClips.filter((clip) => clip.start < end && clip.end > start).map((clip) => clip.id);
}

function upsertEvent(
  eventMap: Map<number, MusicCutEvent>,
  params: {
    time: number;
    kind: Exclude<MusicCutKind, "tail">;
    label?: string;
    duration: number;
    quantizeStep: number | null;
    quantizeTolerance: number;
    minSpacing: number;
  },
) {
  const { time, kind, label, duration, quantizeStep, quantizeTolerance, minSpacing } = params;
  if (!Number.isFinite(time) || time < 0 || time > duration) return;

  const snapped = maybeQuantize(time, quantizeStep, quantizeTolerance);
  const normalized = roundTime(clamp(snapped.time, 0, duration));
  const existingKey = findNearbyKey(eventMap, normalized, minSpacing);
  const id = label ? `${kind}:${normalized}:${label}` : `${kind}:${normalized}`;
  const nextEvent: MusicCutEvent = {
    id,
    time: normalized,
    kind,
    label,
    sectionLabel: label,
    quantized: snapped.quantized,
  };

  if (existingKey === null) {
    eventMap.set(normalized, nextEvent);
    return;
  }

  const previous = eventMap.get(existingKey);
  if (!previous) {
    eventMap.set(normalized, nextEvent);
    return;
  }

  eventMap.set(existingKey, mergeEvents(previous, nextEvent));
}

function createBoundaryEvent(time: number): MusicCutEvent {
  return {
    id: `tail:${roundTime(time)}`,
    time: roundTime(time),
    kind: "tail",
    quantized: false,
  };
}

function mergeBoundary(current: MusicCutEvent, boundary: MusicCutEvent) {
  if (current.kind === "tail") return current;
  return { ...current, id: current.id, time: boundary.time };
}

function mergeEvents(current: MusicCutEvent, incoming: MusicCutEvent): MusicCutEvent {
  const precedence: Record<MusicCutKind, number> = {
    onset: 4,
    beat: 3,
    section: 2,
    tail: 1,
  };

  const winner = precedence[incoming.kind] > precedence[current.kind] ? incoming : current;
  return {
    ...winner,
    quantized: current.quantized || incoming.quantized,
    label: winner.label ?? current.label ?? incoming.label,
    sectionLabel: winner.sectionLabel ?? current.sectionLabel ?? incoming.sectionLabel,
  };
}

function maybeQuantize(time: number, step: number | null, tolerance: number) {
  if (!step || step <= 0) return { time, quantized: false };

  const snapped = Math.round(time / step) * step;
  if (Math.abs(snapped - time) > tolerance) {
    return { time, quantized: false };
  }

  return { time: snapped, quantized: true };
}

function findNearbyKey(eventMap: Map<number, MusicCutEvent>, time: number, minSpacing: number) {
  for (const key of eventMap.keys()) {
    if (Math.abs(key - time) <= minSpacing) {
      return key;
    }
  }

  return null;
}

function dedupeBySpacing(events: MusicCutEvent[], minSpacing: number) {
  return events.reduce<MusicCutEvent[]>((accumulator, event) => {
    const previous = accumulator.at(-1);
    if (!previous || Math.abs(previous.time - event.time) > minSpacing) {
      accumulator.push(event);
      return accumulator;
    }

    accumulator[accumulator.length - 1] = mergeEvents(previous, event);
    return accumulator;
  }, []);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundTime(value: number) {
  return Math.round(value * 1000) / 1000;
}
