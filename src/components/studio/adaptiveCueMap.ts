import type { BeatJoinAnalysis } from "./types";
import type { LyricChunk, MusicVideoProject } from "./musicVideoProject";

export type CueMarkerKind = "onset" | "lyric";

export type OnsetMarker = {
  time: number;
  position: number;
  strength: number;
  active: boolean;
  kind: CueMarkerKind;
  label?: string;
  text?: string;
  mergedWithTime?: number;
};

export type TimelineChunk = {
  id: string;
  sectionId: string;
  sectionLabel: string;
  start: number;
  end: number;
  strength: number;
  cueCount: number;
  onsetCueCount: number;
  lyricCueCount: number;
};

export type AdaptiveCueMap = {
  duration: number;
  markers: OnsetMarker[];
  chunks: TimelineChunk[];
  activeCount: number;
  beatCount: number;
  onsetActiveCount: number;
  lyricActiveCount: number;
  lyricMergedCount: number;
  lyricCount: number;
};


type LyricBoundary = {
  time: number;
  strength: number;
  label: string;
  text: string;
  chunkId: string;
};

export function buildAdaptiveCueMap(params: {
  analysis: BeatJoinAnalysis | null;
  project: MusicVideoProject | null;
  density: number;
  lyricBlend?: number;
  lyricMergeWindowSeconds?: number;
}): AdaptiveCueMap {
  const { analysis, project } = params;
  const duration = analysis?.duration ?? project?.duration ?? 0;
  if (!analysis || duration <= 0) return createEmptyCueMap(duration);

  const density = clamp(params.density, 0.1, 1);
  const lyricBlend = clamp(params.lyricBlend ?? 0, 0, 1);
  const lyricMergeWindowSeconds = clamp(params.lyricMergeWindowSeconds ?? 0, 0, 8);
  const onsets = uniqueSortedTimes(analysis.onsets, duration).map((time) => ({
    time,
    strength: clamp(sampleSeries(analysis.energy, duration, time) * 0.62 + sampleSeries(analysis.waveform, duration, time) * 0.38, 0.05, 1),
  }));
  const lyricBoundaries = buildLyricBoundaries(project?.lyricChunks ?? [], duration);
  const sections = buildCoverageWindows(project?.storySections ?? [], duration);

  const activeOnsetKeys = new Set<string>();
  const activeLyricKeys = new Set<string>();
  const mergedLyricKeys = new Set<string>();
  const chunks: TimelineChunk[] = [];

  for (const section of sections) {
    const start = clamp(section.start, 0, duration);
    const end = clamp(section.end, start, duration);
    if (end <= start) continue;

    const sectionOnsets = onsets.filter((onset) => onset.time > start + 0.05 && onset.time < end - 0.05);
    const sectionLyrics = lyricBoundaries.filter((marker) => marker.time > start + 0.05 && marker.time < end - 0.05);
    const bars = Math.max(1, countBeatsInWindow(analysis.beats, start, end) / 4);
    const energyBias = 0.75 + clamp(section.energy ?? averageEnergy(analysis.energy, duration, start, end), 0, 1) * 0.55;
    const minimumInteriorCuts = Math.max(1, Math.floor(bars / 8));
    const targetInteriorCuts = Math.max(minimumInteriorCuts, Math.round(bars * (0.12 + density * 0.78) * energyBias));
    const selectedOnsets = [...sectionOnsets]
      .sort((left, right) => right.strength - left.strength)
      .slice(0, targetInteriorCuts)
      .sort((left, right) => left.time - right.time);
    const targetLyricCuts = Math.round(sectionLyrics.length * lyricBlend);
    const selectedLyrics = [...sectionLyrics]
      .sort((left, right) => right.strength - left.strength || left.time - right.time)
      .slice(0, targetLyricCuts)
      .sort((left, right) => left.time - right.time);

    const onsetCutTimes = selectedOnsets.map((onset) => onset.time);
    const lyricCutTimes: number[] = [];
    selectedOnsets.forEach((onset) => activeOnsetKeys.add(timeKey(onset.time)));

    for (const lyric of selectedLyrics) {
      activeLyricKeys.add(timeKey(lyric.time));
      const nearestOnset = nearestTime(lyric.time, onsetCutTimes);
      if (nearestOnset !== null && Math.abs(nearestOnset - lyric.time) <= lyricMergeWindowSeconds) {
        mergedLyricKeys.add(timeKey(lyric.time));
        continue;
      }
      lyricCutTimes.push(lyric.time);
    }

    const cutTimes = uniqueSortedTimes([start, ...onsetCutTimes, ...lyricCutTimes, end], duration);
    // Strength-ranked selection clusters cuts where the music is loud and can
    // leave the rest of a window as one giant block. Split oversized gaps at
    // the strongest unused onset inside them (midpoint when none exists) so
    // no chunk exceeds the density-derived maximum.
    const maxChunkSeconds = Math.max(1.2, 6.5 - density * 4.6);
    enforceMaxChunkDuration({ cutTimes, onsets: sectionOnsets, maxChunkSeconds, activeOnsetKeys });

    for (let index = 0; index < cutTimes.length - 1; index += 1) {
      const chunkStart = cutTimes[index];
      const chunkEnd = cutTimes[index + 1];
      const chunkOnsets = sectionOnsets.filter((onset) => onset.time >= chunkStart && onset.time < chunkEnd);
      const chunkLyrics = selectedLyrics.filter((lyric) => lyric.time >= chunkStart && lyric.time < chunkEnd);
      chunks.push({
        id: `${section.id}-${index}-${chunkStart.toFixed(2)}`,
        sectionId: section.id,
        sectionLabel: section.label,
        start: chunkStart,
        end: chunkEnd,
        strength: chunkOnsets.length ? chunkOnsets.reduce((sum, onset) => sum + onset.strength, 0) / chunkOnsets.length : averageEnergy(analysis.energy, duration, chunkStart, chunkEnd),
        cueCount: chunkOnsets.length + chunkLyrics.length,
        onsetCueCount: chunkOnsets.length,
        lyricCueCount: chunkLyrics.length,
      });
    }
  }

  const onsetMarkers = onsets.map((onset) => ({
    ...onset,
    kind: "onset" as const,
    position: clamp01(onset.time / duration),
    active: activeOnsetKeys.has(timeKey(onset.time)),
  }));
  const lyricMarkers = lyricBoundaries.map((lyric) => {
    const nearestActiveOnset = nearestTime(lyric.time, onsets.filter((onset) => activeOnsetKeys.has(timeKey(onset.time))).map((onset) => onset.time));
    return {
      time: lyric.time,
      strength: lyric.strength,
      kind: "lyric" as const,
      label: lyric.label,
      text: lyric.text,
      position: clamp01(lyric.time / duration),
      active: activeLyricKeys.has(timeKey(lyric.time)),
      mergedWithTime: mergedLyricKeys.has(timeKey(lyric.time)) && nearestActiveOnset !== null ? nearestActiveOnset : undefined,
    };
  });
  const markers = [...onsetMarkers, ...lyricMarkers].sort((left, right) => left.time - right.time || left.kind.localeCompare(right.kind));
  const lyricActiveCount = lyricMarkers.filter((marker) => marker.active).length;
  const onsetActiveCount = onsetMarkers.filter((marker) => marker.active).length;

  return {
    duration,
    markers,
    chunks,
    activeCount: onsetActiveCount + lyricActiveCount,
    beatCount: analysis.beats.length,
    onsetActiveCount,
    lyricActiveCount,
    lyricMergedCount: lyricMarkers.filter((marker) => Boolean(marker.mergedWithTime)).length,
    lyricCount: lyricMarkers.length,
  };
}

function createEmptyCueMap(duration: number): AdaptiveCueMap {
  return {
    duration,
    markers: [],
    chunks: [],
    activeCount: 0,
    beatCount: 0,
    onsetActiveCount: 0,
    lyricActiveCount: 0,
    lyricMergedCount: 0,
    lyricCount: 0,
  };
}

function buildLyricBoundaries(chunks: LyricChunk[], duration: number): LyricBoundary[] {
  const byTime = new Map<string, LyricBoundary>();
  for (const chunk of chunks) {
    const cleanText = chunk.text?.trim() || chunk.lyrics?.trim() || "lyric phrase";
    const chunkDuration = Math.max(0.25, chunk.end - chunk.start);
    const strength = clamp(0.38 + Math.min(chunkDuration, 6) / 12 + Math.min(cleanText.length, 80) / 400, 0.35, 1);
    for (const [label, time] of [["lyric start", chunk.start], ["lyric end", chunk.end]] as const) {
      if (!Number.isFinite(time) || time <= 0 || time >= duration) continue;
      const key = timeKey(time);
      const existing = byTime.get(key);
      if (!existing || strength > existing.strength) {
        byTime.set(key, { time: roundTime(time), strength, label, text: cleanText, chunkId: chunk.id });
      }
    }
  }
  return Array.from(byTime.values()).sort((left, right) => left.time - right.time);
}

type CoverageWindow = {
  id: string;
  label: string;
  start: number;
  end: number;
  energy?: number;
};

/**
 * Tiles the full song duration with cue windows. Story sections rarely cover
 * the whole track (intros/outros/bridges without analysis windows), and cuts
 * were only ever generated inside them — so lyrics sung outside a section got
 * no representation and uncovered spans rendered as giant empty blocks. Gaps
 * between, before, and after sections become their own windows.
 */
export function buildCoverageWindows(
  sections: Array<{ id: string; label: string; start: number; end: number; energy?: number }>,
  duration: number,
): CoverageWindow[] {
  const MIN_GAP_SECONDS = 1.25;
  const valid = sections
    .filter((section) => Number.isFinite(section.start) && Number.isFinite(section.end))
    .map((section) => ({
      id: section.id,
      label: section.label,
      start: clamp(section.start, 0, duration),
      end: clamp(section.end, 0, duration),
      energy: section.energy,
    }))
    .filter((section) => section.end > section.start + 0.05)
    .sort((left, right) => left.start - right.start);

  if (!valid.length) return buildFallbackSections(duration);

  const windows: CoverageWindow[] = [];
  let cursor = 0;
  for (const section of valid) {
    if (section.start - cursor >= MIN_GAP_SECONDS) {
      windows.push({ id: `coverage-gap-${cursor.toFixed(2)}`, label: "Unmapped", start: roundTime(cursor), end: roundTime(section.start) });
    }
    const start = Math.max(section.start, cursor);
    if (section.end > start + 0.05) {
      windows.push({ ...section, start: roundTime(start) });
    }
    cursor = Math.max(cursor, section.end);
  }
  if (duration - cursor >= MIN_GAP_SECONDS) {
    windows.push({ id: `coverage-gap-${cursor.toFixed(2)}`, label: "Unmapped", start: roundTime(cursor), end: roundTime(duration) });
  }

  return windows;
}

function enforceMaxChunkDuration(params: {
  cutTimes: number[];
  onsets: Array<{ time: number; strength: number }>;
  maxChunkSeconds: number;
  activeOnsetKeys: Set<string>;
}) {
  const { cutTimes, onsets, maxChunkSeconds, activeOnsetKeys } = params;
  const used = new Set(cutTimes.map(timeKey));

  let index = 0;
  let guard = 512;
  while (index < cutTimes.length - 1 && guard-- > 0) {
    const gapStart = cutTimes[index]!;
    const gapEnd = cutTimes[index + 1]!;
    if (gapEnd - gapStart <= maxChunkSeconds) {
      index += 1;
      continue;
    }

    const margin = Math.min(0.4, (gapEnd - gapStart) / 4);
    const candidate = onsets
      .filter((onset) => onset.time > gapStart + margin && onset.time < gapEnd - margin && !used.has(timeKey(onset.time)))
      .sort((left, right) => right.strength - left.strength)[0];
    const splitTime = roundTime(candidate ? candidate.time : (gapStart + gapEnd) / 2);
    if (used.has(timeKey(splitTime))) {
      index += 1;
      continue;
    }

    used.add(timeKey(splitTime));
    if (candidate) activeOnsetKeys.add(timeKey(candidate.time));
    cutTimes.splice(index + 1, 0, splitTime);
    // Re-examine the same index: the left half may still be oversized.
  }
}

function buildFallbackSections(duration: number) {
  const count = Math.max(1, Math.ceil(duration / 30));
  return Array.from({ length: count }, (_, index) => ({
    id: `fallback-${index}`,
    label: `Block ${index + 1}`,
    start: (duration / count) * index,
    end: (duration / count) * (index + 1),
    energy: 0.5,
  }));
}

function uniqueSortedTimes(values: number[], duration: number) {
  return values
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= duration)
    .map(roundTime)
    .sort((left, right) => left - right)
    .filter((time, index, all) => index === 0 || Math.abs(time - all[index - 1]) > 0.015);
}

function nearestTime(time: number, values: number[]) {
  if (!values.length) return null;
  let nearest = values[0];
  let distance = Math.abs(time - nearest);
  for (const value of values.slice(1)) {
    const nextDistance = Math.abs(time - value);
    if (nextDistance < distance) {
      nearest = value;
      distance = nextDistance;
    }
  }
  return nearest;
}

function countBeatsInWindow(beats: number[], start: number, end: number) {
  return beats.filter((beat) => beat >= start && beat < end).length;
}

function averageEnergy(values: number[], duration: number, start: number, end: number) {
  if (!values.length || duration <= 0 || end <= start) return 0.35;
  const startIndex = clamp(Math.floor((start / duration) * (values.length - 1)), 0, values.length - 1);
  const endIndex = clamp(Math.ceil((end / duration) * (values.length - 1)), startIndex, values.length - 1);
  let total = 0;
  let count = 0;
  for (let index = startIndex; index <= endIndex; index += 1) {
    total += clamp(values[index] ?? 0, 0, 1);
    count += 1;
  }
  return count ? total / count : 0.35;
}

function sampleSeries(values: number[], duration: number, time: number) {
  if (!values.length || duration <= 0) return 0;
  const index = clamp(Math.floor((time / duration) * (values.length - 1)), 0, values.length - 1);
  return clamp(values[index] ?? 0, 0, 1);
}

function timeKey(time: number) {
  return time.toFixed(2);
}

function roundTime(time: number) {
  return Math.round(time * 1000) / 1000;
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
