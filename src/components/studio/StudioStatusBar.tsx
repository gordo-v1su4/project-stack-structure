"use client";

import { useEffect, useState } from "react";
import { getPreviewAssetFileName } from "./studioUiState";

type StudioStatusBarProps = {
  previewStage?: string;
  activeRequestKey?: string | null;
  assetKey?: string | null;
  statusLabel?: string;
  draftStatus?: string;
};

export function StudioStatusBar({
  previewStage = "idle",
  activeRequestKey = null,
  assetKey = null,
  statusLabel = "Ready",
  draftStatus = "",
}: StudioStatusBarProps) {
  const assetFileName = getPreviewAssetFileName(assetKey);
  const [clockLabel, setClockLabel] = useState("--:--");

  useEffect(() => {
    if (assetFileName) return;

    const updateClock = () => {
      setClockLabel(formatStatusClock(new Date()));
    };

    updateClock();
    const intervalId = window.setInterval(updateClock, 30_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [assetFileName]);

  return (
    <footer className="flex items-center justify-between border-t border-[#181818] bg-[#0b0b0b] px-4 py-[5px] shrink-0">
      <div className="flex min-w-0 items-center gap-3">
        <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-[#3a8a3a]" />
        <span className="shrink-0 text-[10px] uppercase tracking-[0.18em] text-[#3a8a3a]">{statusLabel}</span>
        <span className="text-[#1e1e1e]">·</span>
        <span className="shrink-0 font-mono text-[10px] text-[#343434]">
          {previewStage.toUpperCase()}
          {activeRequestKey ? ` · ${activeRequestKey}` : ""}
        </span>
        {draftStatus ? (
          <>
            <span className="text-[#1e1e1e]">·</span>
            <span className="truncate font-mono text-[10px] text-[#343434]" title={draftStatus}>
              {draftStatus}
            </span>
          </>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-4 font-mono text-[10px] text-[#343434]">
        <span>{assetFileName ? `ASSET ${assetFileName}` : clockLabel}</span>
      </div>
    </footer>
  );
}

function formatStatusClock(date: Date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
