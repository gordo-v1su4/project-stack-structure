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

export function buildSourceClipSpans(durations: number[]) {
  let cursor = 0;

  return durations
    .filter((duration) => Number.isFinite(duration) && duration > 0)
    .map((duration, index) => {
      const start = cursor;
      const end = start + duration;
      cursor = end;

      return {
        id: index,
        label: `CLIP_${String(index + 1).padStart(3, "0")}.MP4`,
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

function collectSourceClipIds(sourceClips: SourceClipSpan[], start: number, end: number) {
  return sourceClips
    .filter((clip) => clip.start < end && clip.end > start)
    .map((clip) => clip.id);
}
