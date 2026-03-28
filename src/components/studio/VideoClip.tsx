"use client";

import { getClipPalette, getMotionDir } from "./palette";
import { sv } from "./math";
import type { ShuffleMode } from "./types";

type VideoClipProps = {
  idx: number;
  active?: boolean;
  mode: ShuffleMode;
  showColorBars?: boolean;
  matchScore?: number;
  onClick?: () => void;
};

export function VideoClip({
  idx,
  active,
  mode,
  showColorBars = false,
  matchScore = 0,
  onClick,
}: VideoClipProps) {
  const palette = getClipPalette(idx);
  const motion = getMotionDir(idx);
  const dur = (sv(idx + 0.3) * 6 + 1.5).toFixed(1);

  const bg1 = palette[0];
  const bg2 = palette[1];
  const bg3 = palette[2];
  const angle = Math.floor(sv(idx * 7) * 180);

  return (
    <div className="space-y-0">
      <div
        onClick={onClick}
        className={`relative cursor-pointer rounded-[2px] overflow-hidden border transition-all ${
          active ? "border-[#e05c00]" : "border-[#1e1e1e] hover:border-[#333]"
        }`}
        style={{
          background: `linear-gradient(${angle}deg, ${bg1} 0%, ${bg2} 55%, ${bg3} 100%)`,
        }}
      >
        <div className="aspect-[16/9]" />

        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice">
          <line
            x1={0}
            y1={sv(idx * 3 + 1) * 60 + 15}
            x2={160}
            y2={sv(idx * 5 + 2) * 60 + 15}
            stroke="#00000022"
            strokeWidth={20}
          />
          <ellipse
            cx={sv(idx * 11) * 100 + 30}
            cy={sv(idx * 7) * 40 + 25}
            rx={sv(idx * 13) * 25 + 8}
            ry={sv(idx * 9) * 20 + 6}
            fill="#00000033"
          />
          <ellipse
            cx={sv(idx * 17) * 120 + 20}
            cy={sv(idx * 19) * 30 + 5}
            rx={sv(idx * 23) * 30 + 5}
            ry={sv(idx * 29) * 15 + 3}
            fill="#ffffff0a"
          />
        </svg>

        {active && <div className="absolute top-0 left-0 right-0 h-[2px] bg-[#e05c00]" />}
        <div className="absolute top-[3px] left-[3px] text-[7px] font-mono text-[#ffffff88] bg-[#00000055] px-1 rounded-[1px]">
          C{String(idx + 1).padStart(2, "0")}
        </div>
        <div className="absolute bottom-[3px] right-[3px] text-[7px] font-mono text-[#ffffff66] bg-[#00000055] px-1 rounded-[1px]">
          {dur}s
        </div>

        {mode === "motion" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-[1px]">
              <span className="text-[16px] leading-none" style={{ color: active ? "#e05c00" : "#ffffff99" }}>
                {motion.dir}
              </span>
              <span
                className="text-[6px] font-mono tracking-[0.1em]"
                style={{ color: active ? "#e05c00aa" : "#ffffff55" }}
              >
                {motion.label}
              </span>
            </div>
          </div>
        )}

        {mode === "color" && (
          <div className="absolute bottom-0 left-0 right-0 flex h-[6px]">
            {palette.map((c, j) => (
              <div key={j} className="flex-1" style={{ background: c }} />
            ))}
          </div>
        )}

        {mode === "size" && (
          <div className="absolute bottom-[3px] left-[3px] text-[6px] font-mono text-[#ffffff77] bg-[#00000066] px-1 rounded-[1px]">
            {(sv(idx * 31) * 80 + 20).toFixed(0)}MB
          </div>
        )}
      </div>

      {showColorBars && mode === "color" && (
        <div className="relative h-[14px] bg-[#0a0a0a] border-x border-[#1e1e1e] flex items-center px-1 gap-px">
          {palette.slice(0, 2).map((c, j) => (
            <div key={j} className="h-[8px] flex-1 rounded-[1px]" style={{ background: c, opacity: 0.8 }} />
          ))}
          <div className="mx-1 flex-shrink-0 text-[6px] font-mono" style={{ color: matchScore > 0.7 ? "#e05c00" : "#333" }}>
            {(matchScore * 100).toFixed(0)}%
          </div>
          {getClipPalette(idx + 1)
            .slice(0, 2)
            .map((c, j) => (
              <div key={j} className="h-[8px] flex-1 rounded-[1px]" style={{ background: c, opacity: 0.8 }} />
            ))}
        </div>
      )}
    </div>
  );
}
