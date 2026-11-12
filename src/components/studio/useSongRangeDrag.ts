"use client";
import { useRef, type PointerEvent, type MouseEvent } from "react";
import type { SelectionGesture, SongRange } from "./reviewSelection";

/** Shift-drag adds whole intersected blocks; ordinary clicks keep their native behavior. */
export function useSongRangeDrag(view: SongRange, blocks: SongRange[], select?: (range: SongRange, gesture: SelectionGesture) => void) {
  const drag = useRef<{ pointer: number; x: number; start: number } | null>(null);
  const suppressClick = useRef(false);
  const time = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return view.start + Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width))) * (view.end - view.start);
  };
  return {
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      suppressClick.current = false;
      if (!select || !event.shiftKey || event.button !== 0) return;
      drag.current = { pointer: event.pointerId, x: event.clientX, start: time(event) };
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const start = drag.current;
      if (start?.pointer === event.pointerId && Math.abs(event.clientX - start.x) >= 4
        && !event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      const start = drag.current;
      drag.current = null;
      if (!start || start.pointer !== event.pointerId) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      if (Math.abs(event.clientX - start.x) < 4) return;
      const end = time(event), low = Math.min(start.start, end), high = Math.max(start.start, end);
      const hits = blocks.filter(block => block.end > low && block.start < high);
      if (hits.length) select?.({ start: Math.min(...hits.map(b => b.start)), end: Math.max(...hits.map(b => b.end)) }, { add: true });
      suppressClick.current = true;
    },
    onPointerCancel() { drag.current = null; },
    onClickCapture(event: MouseEvent<HTMLDivElement>) {
      if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; }
    },
  };
}
