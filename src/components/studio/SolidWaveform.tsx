"use client";

import { useEffect, useRef, useState } from "react";
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
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(0);
  const rulerH = showRuler ? 22 : 0;
  const waveH = height - rulerH;
  const canvasWidth = Math.max(1, width);
  const ph = playhead * canvasWidth;
  const totalBeats = totalBars * beatsPerBar;

  useEffect(() => {
    const node = wrapperRef.current;
    if (!node) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setWidth(Math.max(1, Math.floor(entry.contentRect.width)));
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || waveH <= 0 || canvasWidth <= 0) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(canvasWidth * dpr);
    canvas.height = Math.floor(waveH * dpr);
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${waveH}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvasWidth, waveH);

    const bg = ctx.createLinearGradient(0, 0, 0, waveH);
    bg.addColorStop(0, "rgba(14, 14, 14, 0.96)");
    bg.addColorStop(0.5, "rgba(8, 8, 8, 0.92)");
    bg.addColorStop(1, "rgba(14, 14, 14, 0.96)");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvasWidth, waveH);

    const centerY = waveH / 2;
    ctx.strokeStyle = "rgba(110, 110, 110, 0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(canvasWidth, centerY);
    ctx.stroke();

    if (!points.length) return;

    const accentFill = hexToRgba(accent, 0.72);
    const accentHighlight = hexToRgba(accent, 0.95);
    const trailFill = "rgba(42, 42, 42, 0.7)";
    const trailHighlight = "rgba(96, 96, 96, 0.36)";
    const innerHeight = Math.max(centerY - 3, 1);

    for (let x = 0; x < canvasWidth; x += 1) {
      const startIndex = Math.floor((x / canvasWidth) * points.length);
      const endIndex = Math.max(startIndex + 1, Math.floor(((x + 1) / canvasWidth) * points.length));
      let min = 1;
      let max = -1;

      for (let index = startIndex; index < endIndex; index += 1) {
        const value = clampPoint(points[index] ?? 0);
        min = Math.min(min, -value);
        max = Math.max(max, value);
      }

      const top = Math.max(1, centerY - max * innerHeight);
      const bottom = Math.min(waveH - 1, centerY - min * innerHeight);
      const barHeight = Math.max(1, bottom - top);
      const isAhead = x <= ph;

      ctx.fillStyle = isAhead ? accentFill : trailFill;
      ctx.fillRect(x, top, 1, barHeight);

      const center = centerY - ((max + min) * 0.5) * innerHeight;
      ctx.fillStyle = isAhead ? accentHighlight : trailHighlight;
      ctx.fillRect(x, Math.max(1, center - 0.75), 1, Math.max(1, barHeight * 0.14));
    }
  }, [waveH, ph, accent, points, canvasWidth]);

  return (
    <div ref={wrapperRef} className="relative border border-[#1e1e1e] rounded-[2px] bg-[#070707] overflow-hidden" style={{ height }}>
      <div className="absolute top-[3px] left-[8px] text-[9px] uppercase tracking-[0.18em] text-[#3a3a3a] z-10 pointer-events-none">
        {label}
      </div>

      <canvas ref={canvasRef} className="absolute inset-x-0 w-full" style={{ top: rulerH, height: waveH }} />

      <svg
        className="absolute inset-x-0 w-full"
        style={{ top: rulerH, height: waveH }}
        viewBox={`0 0 ${canvasWidth} ${waveH}`}
        preserveAspectRatio="none"
      >
        {Array.from({ length: totalBeats + 1 }, (_, i) => {
          const x = (i / totalBeats) * canvasWidth;
          const isBar = i % beatsPerBar === 0;
          return (
            <line
              key={i}
              x1={x}
              y1={0}
              x2={x}
              y2={waveH}
              stroke={isBar ? "#252525" : "#141414"}
              strokeWidth={isBar ? 1.2 : 0.6}
            />
          );
        })}

        <line x1={ph} y1={0} x2={ph} y2={waveH} stroke={accent} strokeWidth={1.5} />
        <polygon points={`${ph - 5},0 ${ph + 5},0 ${ph},10`} fill={accent} />
      </svg>

      {showRuler && (
        <div
          className="absolute top-0 left-0 right-0 border-b border-[#1a1a1a] bg-[#0a0a0a]"
          style={{ height: rulerH }}
        >
          <svg className="w-full h-full" viewBox={`0 0 ${canvasWidth} ${rulerH * 2}`} preserveAspectRatio="none">
            {Array.from({ length: totalBeats }, (_, i) => {
              const x = (i / totalBeats) * canvasWidth;
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

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((part) => `${part}${part}`).join("")
    : normalized;

  const int = Number.parseInt(value, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function clampPoint(value: number) {
  return Math.max(0, Math.min(1, Math.abs(value)));
}
