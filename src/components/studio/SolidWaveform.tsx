"use client";

import { useMemo } from "react";
import { fmt } from "./math";

type SolidWaveformProps = {
  points: number[];
  playhead: number;
  bpm?: number;
  beatsPerBar?: number;
  totalBars?: number;
  accent?: string;
  height?: number;
  label?: string;
  showRuler?: boolean;
};

export function SolidWaveform({
  points,
  playhead,
  bpm = 130,
  beatsPerBar = 4,
  totalBars = 8,
  accent = "#e05c00",
  height = 100,
  label = "SOURCE",
  showRuler = true,
}: SolidWaveformProps) {
  const W = 1000;
  const rulerH = showRuler ? 22 : 0;
  const waveH = height - rulerH;
  const H = waveH * 2;
  const mid = H / 2;

  const topPath = useMemo(() => {
    if (points.length < 2) return "";
    const step = W / (points.length - 1);
    let d = `M 0 ${mid}`;
    points.forEach((v, i) => {
      const x = i * step;
      const y = mid - v * mid * 0.92;
      d += ` L ${x} ${y}`;
    });
    for (let i = points.length - 1; i >= 0; i--) {
      const x = i * step;
      const y = mid + points[i] * mid * 0.92;
      d += ` L ${x} ${y}`;
    }
    d += " Z";
    return d;
  }, [points, mid]);

  const ph = playhead * W;
  const totalBeats = totalBars * beatsPerBar;
  const gradId = `wg-${label.replace(/\s/g, "-")}`;

  return (
    <div className="relative border border-[#1e1e1e] rounded-[2px] bg-[#070707] overflow-hidden" style={{ height }}>
      <div className="absolute top-[3px] left-[8px] text-[9px] uppercase tracking-[0.18em] text-[#3a3a3a] z-10 pointer-events-none">
        {label}
      </div>

      <svg
        className="absolute left-0 right-0"
        style={{ top: rulerH, height: waveH }}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={accent} stopOpacity="0.9" />
            <stop offset={`${playhead * 100}%`} stopColor={accent} stopOpacity="0.85" />
            <stop offset={`${playhead * 100}%`} stopColor="#2e2e2e" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#1e1e1e" stopOpacity="0.6" />
          </linearGradient>
        </defs>

        {Array.from({ length: totalBeats + 1 }, (_, i) => {
          const x = (i / totalBeats) * W;
          const isBar = i % beatsPerBar === 0;
          return (
            <line
              key={i}
              x1={x}
              y1={0}
              x2={x}
              y2={H}
              stroke={isBar ? "#252525" : "#141414"}
              strokeWidth={isBar ? 1.2 : 0.6}
            />
          );
        })}

        <path d={topPath} fill={`url(#${gradId})`} />

        <line x1={ph} y1={0} x2={ph} y2={H} stroke={accent} strokeWidth={1.5} />
        <polygon points={`${ph - 5},0 ${ph + 5},0 ${ph},10`} fill={accent} />
      </svg>

      {showRuler && (
        <div
          className="absolute top-0 left-0 right-0 border-b border-[#1a1a1a] bg-[#0a0a0a]"
          style={{ height: rulerH }}
        >
          <svg className="w-full h-full" viewBox={`0 0 ${W} ${rulerH * 2}`} preserveAspectRatio="none">
            {Array.from({ length: totalBeats }, (_, i) => {
              const x = (i / totalBeats) * W;
              const bar = Math.floor(i / beatsPerBar) + 1;
              const beat = (i % beatsPerBar) + 1;
              const isBarStart = beat === 1;
              return (
                <g key={i}>
                  <line
                    x1={x}
                    y1={0}
                    x2={x}
                    y2={rulerH * 2}
                    stroke={isBarStart ? "#2a2a2a" : "#181818"}
                    strokeWidth={isBarStart ? 1.2 : 0.6}
                  />
                  {isBarStart && (
                    <text
                      x={x + 4}
                      y={rulerH * 1.4}
                      fontSize={10}
                      fill="#404040"
                      fontFamily="monospace"
                      fontWeight="600"
                    >
                      {bar}
                    </text>
                  )}
                  {!isBarStart && (
                    <text x={x + 3} y={rulerH * 1.5} fontSize={8} fill="#282828" fontFamily="monospace">
                      {bar}-{beat}
                    </text>
                  )}
                </g>
              );
            })}
            <rect x={ph - 1} y={0} width={2} height={rulerH * 2} fill={accent} opacity="0.7" />
          </svg>
        </div>
      )}

      <div className="absolute bottom-[3px] right-[8px] flex gap-4 text-[9px] font-mono text-[#333] z-10 pointer-events-none">
        <span>
          BPM <span className="text-[#4a4a4a]">{bpm}</span>
        </span>
        <span>
          BARS <span className="text-[#4a4a4a]">{totalBars}</span>
        </span>
        <span className="text-[#4a4a4a]">{fmt(playhead * (totalBars * beatsPerBar * (60 / bpm)))}</span>
      </div>
    </div>
  );
}
