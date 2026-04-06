"use client";

import { getPreviewAssetFileName } from "./studioUiState";

type StudioStatusBarProps = {
  gpu: number;
  previewStage?: string;
  activeRequestKey?: string | null;
  assetKey?: string | null;
  statusLabel?: string;
};

export function StudioStatusBar({ gpu, previewStage = "idle", activeRequestKey = null, assetKey = null, statusLabel = "Ready" }: StudioStatusBarProps) {
  const assetFileName = getPreviewAssetFileName(assetKey);

  return (
    <footer className="flex items-center justify-between border-t border-[#181818] bg-[#0b0b0b] px-4 py-[5px] shrink-0">
      <div className="flex items-center gap-3">
        <span className="h-[5px] w-[5px] rounded-full bg-[#3a8a3a]" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-[#3a8a3a]">{statusLabel}</span>
        <span className="text-[#1e1e1e]">·</span>
        <span className="font-mono text-[10px] text-[#343434]">RTX 5090 · {gpu.toFixed(0)}% · 42°C</span>
        <span className="text-[#1e1e1e]">·</span>
        <span className="font-mono text-[10px] text-[#343434]">{previewStage.toUpperCase()}{activeRequestKey ? ` · ${activeRequestKey}` : ""}</span>
      </div>
      <div className="flex items-center gap-4 font-mono text-[10px] text-[#343434]">
        <span>FFmpeg 7.1 · CUDA 12.8</span>
        <span>·</span>
        <span>{assetFileName ? `ASSET ${assetFileName}` : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
    </footer>
  );
}
