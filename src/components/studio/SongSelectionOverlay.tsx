import type { SongRange } from "./reviewSelection";
import { clipSpineRange } from "./shell/spineViewport";

/** One song-time projection for every lane, independent of its clip/cue boundaries. */
export function SongSelectionOverlay({ ranges, view, lane }: { ranges: SongRange[]; view: SongRange; lane: string }) {
  return <div aria-hidden="true" data-selection-lane={lane} className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
    {ranges.map((range, index) => {
      const geometry = clipSpineRange(range, view);
      return geometry ? <span key={`${range.start}:${range.end}:${index}`} data-selection-start={range.start} data-selection-end={range.end}
        className="absolute inset-y-0 border-2 border-fg-0 bg-fg-0/10"
        style={{ left: `${geometry.left}%`, width: `${geometry.width}%` }} /> : null;
    })}
  </div>;
}
