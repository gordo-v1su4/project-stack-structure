import { fmt } from "../math";
import type { AdaptiveCueMap, OnsetMarker } from "../adaptiveCueMap";
import type { MusicVideoProject } from "../musicVideoProject";

export function MatchMusicCueTimeline({ cueMap, project }: { cueMap: AdaptiveCueMap; project: MusicVideoProject | null }) {
  const duration = cueMap.duration || project?.duration || 0;
  if (!duration) {
    return <div className="rounded-[2px] border border-dashed border-[#202020] bg-[#070707] px-3 py-8 text-center text-[10px] uppercase tracking-[0.14em] text-[#4f4f4f]">Upload/analyze master song to show adaptive cut blocks.</div>;
  }

  // A merged lyric cut is rendered on the onset that absorbed it, not as a
  // separate marker at the lyric position.
  const mergedLyricsByOnsetKey = new Map<string, OnsetMarker>();
  for (const marker of cueMap.markers) {
    if (marker.kind === "lyric" && marker.mergedWithTime !== undefined) {
      mergedLyricsByOnsetKey.set(marker.mergedWithTime.toFixed(2), marker);
    }
  }

  const lyricCoverageRatio = duration > 0 ? cueMap.lyricCoverageSeconds / duration : 0;
  const showSparseTranscriptWarning = cueMap.lyricCount > 0 && (lyricCoverageRatio < 0.7 || cueMap.lyricLastTime < duration * 0.85);

  return (
    <div className="rounded-[2px] border border-[#151515] bg-[#060606] p-2">
      <div className="relative h-24 overflow-hidden border border-[#101010] bg-[#040404]">
        {project?.storySections.map((section) => {
          const left = clamp01(section.start / duration) * 100;
          const width = Math.max(0.15, clamp01((section.end - section.start) / duration) * 100);
          return (
            <div
              key={section.id}
              className="absolute inset-y-0 border-r border-[#241408] bg-[#e05c0006]"
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${section.label} · ${fmt(section.start)}–${fmt(section.end)}`}
            >
              <span className="absolute left-1 top-1 max-w-[140px] truncate text-[8px] uppercase tracking-[0.12em] text-[#8a4b20]">{section.label}</span>
            </div>
          );
        })}
        {cueMap.chunks.map((chunk) => {
          const left = clamp01(chunk.start / duration) * 100;
          const width = Math.max(0.12, clamp01((chunk.end - chunk.start) / duration) * 100);
          return (
            <button
              key={chunk.id}
              type="button"
              className="absolute bottom-2 top-6 border border-[#0c0c0c] text-left transition-colors hover:border-[#e05c00]"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                background: `rgba(224, 92, 0, ${0.16 + chunk.strength * 0.58})`,
              }}
              title={`${chunk.sectionLabel} · ${fmt(chunk.start)}–${fmt(chunk.end)} · ${chunk.onsetCueCount} music · ${chunk.lyricCueCount} lyric`}
            >
              <span className="absolute bottom-1 left-1 text-[7px] font-mono text-[#120700] opacity-70">{chunk.onsetCueCount}+{chunk.lyricCueCount}</span>
            </button>
          );
        })}
        {cueMap.markers.map((marker, index) => {
          if (marker.kind === "lyric") {
            if (marker.mergedWithTime !== undefined) return null;
            return (
              <div
                key={`${marker.kind}-${index}-${marker.time}`}
                className="absolute bottom-2 w-[2px]"
                style={{
                  left: `${marker.position * 100}%`,
                  height: "52%",
                  background: marker.active ? "#32c7d7" : "#1d3a3e",
                  opacity: marker.active ? 0.92 : 0.35,
                }}
                title={`SRT ${fmt(marker.time)} · ${marker.label ?? "phrase"}${marker.active ? " · added cut" : " · filtered"}${marker.text ? ` · ${marker.text}` : ""}`}
              />
            );
          }

          const absorbedLyric = mergedLyricsByOnsetKey.get(marker.time.toFixed(2));
          return (
            <div
              key={`${marker.kind}-${index}-${marker.time}`}
              className={`absolute bottom-2 ${absorbedLyric ? "w-[2px]" : "w-px"}`}
              style={{
                left: `${marker.position * 100}%`,
                height: `${Math.max(12, marker.strength * 62)}%`,
                background: absorbedLyric ? "#75d767" : marker.active ? "#ff9a28" : "#333",
                opacity: marker.active || absorbedLyric ? 0.92 : 0.3,
              }}
              title={absorbedLyric
                ? `onset ${fmt(marker.time)} + SRT ${fmt(absorbedLyric.time)} merged${absorbedLyric.text ? ` · ${absorbedLyric.text}` : ""}`
                : `onset ${fmt(marker.time)} · strength ${marker.strength.toFixed(2)}${marker.active ? " · section-kept" : " · filtered"}`}
            />
          );
        })}
      </div>
      {showSparseTranscriptWarning ? (
        <div className="mt-2 rounded-[2px] border border-[#6f4a12] bg-[#120d05] px-2 py-1.5 text-[10px] leading-4 text-[#c07a3f]">
          SRT transcript covers only {fmt(cueMap.lyricCoverageSeconds)} of {fmt(duration)} and ends at {fmt(cueMap.lyricLastTime)} — the vocal after that has no timed lyrics, so no cyan cuts can appear there. Re-run the transcription in Story for full-song lyric cuts.
        </div>
      ) : null}
      <div className="mt-2 flex items-center justify-between font-mono text-[9px] text-[#555]">
        <span>0:00</span>
        <span>{cueMap.chunks.length} blocks · {cueMap.onsetActiveCount} active onsets · {cueMap.lyricActiveCount}/{cueMap.lyricCount} SRT cuts · {cueMap.lyricMergedCount} merged into onsets · {cueMap.beatCount} beats</span>
        <span>{fmt(duration)}</span>
      </div>
    </div>
  );
}


function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
