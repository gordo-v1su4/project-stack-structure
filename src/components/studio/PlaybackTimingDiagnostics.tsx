"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { installPlaybackTimingProbe, playbackTimingOptedIn } from "./playbackTimingProbe";

const noSubscription = () => () => {};
const serverDisabled = () => false;
const queryEnabled = () => playbackTimingOptedIn(window.location.search);

/** Diagnostic controls exist only on the explicit query opt-in; never autoplay. */
export function PlaybackTimingDiagnostics() {
  const enabled = useSyncExternalStore(noSubscription, queryEnabled, serverDisabled);
  const start = useRef<HTMLButtonElement>(null);
  const finish = useRef<HTMLButtonElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const output = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (!enabled || !start.current || !finish.current || !status.current || !output.current) return;
    return installPlaybackTimingProbe(window, { start: start.current, finish: finish.current, status: status.current, output: output.current });
  }, [enabled]);
  if (!enabled) return null;
  return (
    <aside aria-label="Local playback timing diagnostic" data-playback-timing-probe="true"
      className="fixed bottom-14 right-3 z-50 max-w-sm rounded-md border border-line bg-ink-2 p-3 text-xs text-fg-2 shadow-lg">
      <p className="font-medium text-fg-0">Local playback timing · 20-second window</p>
      <p ref={status} role="status" className="mt-1 text-fg-3">Armed. Start captures timing only; it does not start playback.</p>
      <p className="mt-1 text-fg-3">Group state covers this player in the current document, excluding other tabs and frames.</p>
      <div className="my-2 flex gap-2">
        <button ref={start} type="button" className="rounded-md border border-line px-2 py-1">Start timing capture</button>
        <button ref={finish} type="button" disabled className="rounded-md border border-line px-2 py-1 disabled:text-fg-4">Finish timing capture</button>
      </div>
      <pre ref={output} data-playback-timing-output="true" className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-fg-3" />
    </aside>
  );
}
