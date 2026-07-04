import { fmt } from "../math";
import type { AdaptiveCueMap } from "../adaptiveCueMap";
import type { MusicVideoProject } from "../musicVideoProject";

export function MatchMusicCueTimeline({ cueMap, project }: { cueMap: AdaptiveCueMap; project: MusicVideoProject | null }) {
  const duration = cueMap.duration || project?.duration || 0;
  if (!duration) {
    return <div className="rounded-[2px] border border-dashed border-[#202020] bg-[#070707] px-3 py-8 text-center text-[10px] uppercase tracking-[0.14em] text-[#4f4f4f]">Upload/analyze master song to show adaptive cut blocks.</div>;
  }

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
        {cueMap.markers.map((marker, index) => (
          <div
            key={`${marker.kind}-${index}-${marker.time}`}
            className={`absolute bottom-2 ${marker.kind === "lyric" ? "w-[2px]" : "w-px"}`}
            style={{
              left: `${marker.position * 100}%`,
              height: `${Math.max(12, marker.strength * (marker.kind === "lyric" ? 48 : 62))}%`,
              background: marker.kind === "lyric"
                ? marker.mergedWithTime !== undefined
                  ? "#75d767"
                  : marker.active
                    ? "#32c7d7"
                    : "#1d3a3e"
                : marker.active
                  ? "#ff9a28"
                  : "#333",
              opacity: marker.active ? 0.92 : 0.3,
            }}
            title={marker.kind === "lyric"
              ? `SRT ${fmt(marker.time)} · ${marker.label ?? "phrase"}${marker.mergedWithTime !== undefined ? ` · merged with onset ${fmt(marker.mergedWithTime)}` : marker.active ? " · added cut" : " · filtered"}${marker.text ? ` · ${marker.text}` : ""}`
              : `onset ${fmt(marker.time)} · strength ${marker.strength.toFixed(2)}${marker.active ? " · section-kept" : " · filtered"}`}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between font-mono text-[9px] text-[#555]">
        <span>0:00</span>
        <span>{cueMap.chunks.length} blocks · {cueMap.onsetActiveCount} active onsets · {cueMap.lyricActiveCount}/{cueMap.lyricCount} SRT markers · {cueMap.lyricMergedCount} merged · {cueMap.beatCount} beats</span>
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
