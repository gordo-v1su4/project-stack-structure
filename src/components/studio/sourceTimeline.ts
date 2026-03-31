import { lerp, sv } from "./math";
import type { BeatJoinAnalysis, UploadedVideoSource } from "./types";

export interface SourceClipSpan {
  id: number;
  label: string;
  duration: number;
  start: number;
  end: number;
}

export interface SourceTimelineSegment {
  id: number;
  start: number;
  end: number;
  duration: number;
  sourceClipIds: number[];
  mergedTail: boolean;
}

export function buildSourceClipSpans(sources: UploadedVideoSource[]) {
  let cursor = 0;

  return sources
    .filter((source) => Number.isFinite(source.duration) && source.duration > 0)
    .map((source, index) => {
      const duration = source.duration;
      const start = cursor;
      const end = start + duration;
      cursor = end;

      return {
        id: source.id ?? index,
        label: source.name,
        duration,
        start,
        end,
      } satisfies SourceClipSpan;
    });
}

export function buildStandardSegments(sourceClips: SourceClipSpan[], targetDuration: number) {
  const safeTargetDuration = Math.max(0.1, targetDuration);
  return segmentTimeline(sourceClips, safeTargetDuration, Math.max(0.12, safeTargetDuration * 0.6));
}

export function buildBeatSegments(sourceClips: SourceClipSpan[], bpm: number, barsPerSegment: number) {
  const barDuration = (60 / Math.max(1, bpm)) * 4;
  const targetDuration = Math.max(0.1, barDuration * Math.max(1, barsPerSegment));
  return segmentTimeline(sourceClips, targetDuration, Math.max(0.18, targetDuration * 0.7));
}

export function buildAudioDrivenSegments(params: {
  sourceClips: SourceClipSpan[];
  analysis: BeatJoinAnalysis | null;
  mode: "beats" | "onsets";
  targetEvents: number;
  density: number;
}) {
  const { sourceClips, analysis, mode, targetEvents, density } = params;
  if (!analysis) return [];

  const totalDuration = sourceClips[sourceClips.length - 1]?.end ?? 0;
  if (totalDuration <= 0) return [];

  const pattern = mode === "beats"
    ? buildBeatDurationPattern(analysis, targetEvents, density)
    : buildOnsetDurationPattern(analysis, targetEvents, density);

  if (!pattern.length) return [];

  return segmentTimelineByDurations(sourceClips, totalDuration, pattern);
}

function segmentTimeline(sourceClips: SourceClipSpan[], targetDuration: number, minTailDuration: number) {
  const totalDuration = sourceClips[sourceClips.length - 1]?.end ?? 0;
  if (totalDuration <= 0) return [];

  const segments: SourceTimelineSegment[] = [];
  let cursor = 0;

  while (cursor < totalDuration - 0.001) {
    const remaining = totalDuration - cursor;
    const shouldMergeTail = remaining < targetDuration + minTailDuration && segments.length > 0;

    if (shouldMergeTail) {
      const previous = segments[segments.length - 1];
      previous.end = totalDuration;
      previous.duration = previous.end - previous.start;
      previous.sourceClipIds = collectSourceClipIds(sourceClips, previous.start, previous.end);
      previous.mergedTail = true;
      break;
    }

    const end = Math.min(totalDuration, cursor + targetDuration);
    segments.push({
      id: segments.length,
      start: cursor,
      end,
      duration: end - cursor,
      sourceClipIds: collectSourceClipIds(sourceClips, cursor, end),
      mergedTail: false,
    });
    cursor = end;
  }

  if (!segments.length) {
    return [
      {
        id: 0,
        start: 0,
        end: totalDuration,
        duration: totalDuration,
        sourceClipIds: collectSourceClipIds(sourceClips, 0, totalDuration),
        mergedTail: false,
      },
    ];
  }

  return segments;
}

function segmentTimelineByDurations(sourceClips: SourceClipSpan[], totalDuration: number, durations: number[]) {
  const safeDurations = durations.filter((duration) => Number.isFinite(duration) && duration > 0.03);
  if (!safeDurations.length) return [];

  const segments: SourceTimelineSegment[] = [];
  let cursor = 0;
  let durationIndex = 0;

  while (cursor < totalDuration - 0.001) {
    const remaining = totalDuration - cursor;
    const nextDuration = safeDurations[durationIndex % safeDurations.length] ?? safeDurations[safeDurations.length - 1] ?? remaining;
    const shouldMergeTail = remaining < Math.max(0.12, nextDuration * 0.55) && segments.length > 0;

    if (shouldMergeTail) {
      const previous = segments[segments.length - 1];
      previous.end = totalDuration;
      previous.duration = previous.end - previous.start;
      previous.sourceClipIds = collectSourceClipIds(sourceClips, previous.start, previous.end);
      previous.mergedTail = true;
      break;
    }

    const end = Math.min(totalDuration, cursor + nextDuration);
    segments.push({
      id: segments.length,
      start: cursor,
      end,
      duration: end - cursor,
      sourceClipIds: collectSourceClipIds(sourceClips, cursor, end),
      mergedTail: false,
    });
    cursor = end;
    durationIndex += 1;
  }

  return segments;
}

function buildBeatDurationPattern(analysis: BeatJoinAnalysis, targetEvents: number, density: number) {
  const duration = Math.max(analysis.duration, 0.001);
  const beats = uniqueSortedTimes(analysis.beats, duration);
  const beatInterval = medianInterval(beats) ?? Math.max(0.18, duration / 32);
  if (!beats.length) return [beatInterval * Math.max(1, targetEvents)];

  const targetBeats = clamp(Math.round(targetEvents), 1, 8);
  const variation = clamp(density, 0, 1);
  const cutTimes = [0];
  let beatIndex = 0;

  while (beatIndex < beats.length) {
    const jitter = Math.round(lerp(-2, 2, sv((beatIndex + 1) * 1.93 + variation * 3.1)) * variation);
    const nextStep = clamp(targetBeats + jitter, 1, 8);
    beatIndex += nextStep;

    const nextTime = beats[Math.min(beatIndex, beats.length - 1)];
    if (nextTime === undefined || nextTime >= duration - 0.04) break;
    cutTimes.push(nextTime);
  }

  return cutTimes
    .concat(duration)
    .map((time, index, all) => (index === 0 ? null : time - (all[index - 1] ?? 0)))
    .filter((value): value is number => value !== null && value > 0.03);
}

function buildOnsetDurationPattern(analysis: BeatJoinAnalysis, targetEvents: number, density: number) {
  const duration = Math.max(analysis.duration, 0.001);
  const onsets = uniqueSortedTimes(analysis.onsets, duration);
  if (!onsets.length) {
    const beats = buildBeatDurationPattern(analysis, targetEvents, density);
    return beats.length ? beats : [Math.max(0.18, duration / 24)];
  }

  const targetOnsets = clamp(Math.round(targetEvents), 1, 8);
  const keepRatio = lerp(0.35, 1, clamp(density, 0, 1));
  const scored = onsets.map((time) => ({
    time,
    strength: clamp(sampleSeries(analysis.energy, duration, time) * 0.62 + sampleSeries(analysis.waveform, duration, time) * 0.38, 0.05, 1),
  }));
  const strengthThreshold = [...scored]
    .sort((left, right) => right.strength - left.strength)[Math.max(0, Math.floor(scored.length * keepRatio) - 1)]?.strength ?? 0;
  const filtered = scored.filter((onset) => onset.strength >= strengthThreshold);
  const cutTimes = [0];
  let onsetIndex = 0;

  while (onsetIndex < filtered.length) {
    const anchor = filtered[onsetIndex];
    if (!anchor) break;
    const deviation = Math.round(lerp(-1, 2, sv(anchor.time * 2.7 + density * 9.1)) * Math.max(0.15, density));
    const nextStep = clamp(targetOnsets + deviation, 1, 8);
    onsetIndex += nextStep;
    const nextTime = filtered[Math.min(onsetIndex, filtered.length - 1)]?.time;
    if (nextTime === undefined || nextTime >= duration - 0.04) break;
    cutTimes.push(nextTime);
  }

  return cutTimes
    .concat(duration)
    .map((time, index, all) => (index === 0 ? null : time - (all[index - 1] ?? 0)))
    .filter((value): value is number => value !== null && value > 0.03);
}

function uniqueSortedTimes(values: number[], duration: number) {
  return values
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= duration)
    .sort((left, right) => left - right)
    .filter((time, index, all) => index === 0 || Math.abs(time - all[index - 1]) > 0.015);
}

function medianInterval(values: number[]) {
  if (values.length < 2) return null;

  const intervals = values
    .slice(1)
    .map((time, index) => time - values[index])
    .filter((interval) => interval > 0.02);

  if (!intervals.length) return null;
  const sorted = [...intervals].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

function sampleSeries(values: number[], duration: number, time: number) {
  if (!values.length || duration <= 0) return 0;
  const index = clamp(Math.floor((time / duration) * (values.length - 1)), 0, values.length - 1);
  return clamp(values[index] ?? 0, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function collectSourceClipIds(sourceClips: SourceClipSpan[], start: number, end: number) {
  return sourceClips
    .filter((clip) => clip.start < end && clip.end > start)
    .map((clip) => clip.id);
}
