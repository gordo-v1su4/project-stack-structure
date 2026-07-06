"use client";

type StudioHeaderProps = {
  tabLabel: string;
  tabSub: string;
  stepLabel: string | null;
  songLabel: string | null;
  songDuration: number | null;
};

export function StudioHeader({ tabLabel, tabSub, stepLabel, songLabel, songDuration }: StudioHeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-[#181818] bg-[#0c0c0c] px-5 py-[8px] shrink-0">
      <div className="flex items-center gap-3">
        <span className="text-[10px] uppercase tracking-[0.22em] text-[#363636]">SVS</span>
        <span className="text-[#222]">/</span>
        <span className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#d0d0d0]">{tabLabel}</span>
        <span className="text-[10px] text-[#3a3a3a] border-l border-[#222] pl-3 ml-1">{tabSub}</span>
      </div>
      <div className="flex items-center gap-4">
        {songLabel ? (
          <span className="max-w-[280px] truncate font-mono text-[10px] text-[#5a5a5a]" title={songLabel}>
            {songLabel}
            {songDuration ? ` · ${formatDuration(songDuration)}` : ""}
          </span>
        ) : (
          <span className="text-[10px] uppercase tracking-[0.18em] text-[#3a3a3a]">No master audio</span>
        )}
        {stepLabel ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#e05c00]">{stepLabel}</span>
        ) : null}
      </div>
    </header>
  );
}

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}
