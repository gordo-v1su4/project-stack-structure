"use client";

import { useEffect, useRef, useState } from "react";
import { fmt } from "./math";

type SolidWaveformProps = {
  points: number[];
  playhead: number;
  bpm?: number;
  beatsPerBar?: number;
  totalBars?: number;
  beatTimes?: number[];
  durationSeconds?: number;
  accent?: string;
  height?: number;
  label?: string;
  showRuler?: boolean;
  zoom?: 1 | 2;
  onSeek?: (nextPlayhead: number) => void;
};

export function SolidWaveform({
  points,
  playhead,
  bpm = 130,
  beatsPerBar = 4,
  totalBars = 8,
  beatTimes,
  durationSeconds,
  accent = "#d4ae1d",
  height = 100,
  label = "SOURCE",
  showRuler = true,
  zoom = 1,
  onSeek,
}: SolidWaveformProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(0);
  const rulerH = showRuler ? 22 : 0;
  const waveH = height - rulerH;
  const canvasWidth = Math.max(1, width);
  const derivedBeatTimes = beatTimes?.length
    ? beatTimes.filter((time) => Number.isFinite(time) && time >= 0 && time <= Math.max(durationSeconds ?? 0, 0.001))
    : [];
  const totalBeats = derivedBeatTimes.length || totalBars * beatsPerBar;
  const resolvedDuration = durationSeconds && durationSeconds > 0
    ? durationSeconds
    : totalBars * beatsPerBar * (60 / Math.max(1, bpm));
  const resolvedZoom = zoom === 2 ? 2 : 1;
  const resolvedBarCount = derivedBeatTimes.length
    ? Math.max(1, Math.ceil(derivedBeatTimes.length / beatsPerBar))
    : totalBars;
  const visibleDuration = resolvedDuration / resolvedZoom;
  const playheadTime = playhead * resolvedDuration;
  const windowStart = resolvedZoom === 1
    ? 0
    : clamp(
        playheadTime - visibleDuration / 2,
        0,
        Math.max(0, resolvedDuration - visibleDuration)
      );
  const windowEnd = Math.min(resolvedDuration, windowStart + visibleDuration);
  const ph = projectTimeToX(playheadTime, windowStart, windowEnd, canvasWidth);
  const labelStep = resolvedBarCount > 96 ? 8 : resolvedBarCount > 48 ? 4 : resolvedBarCount > 24 ? 2 : 1;
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
    bg.addColorStop(0, "rgba(18, 18, 18, 0.98)");
    bg.addColorStop(0.5, "rgba(10, 10, 10, 0.94)");
    bg.addColorStop(1, "rgba(16, 16, 16, 0.98)");
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
    const trailFill = "rgba(46, 46, 46, 0.72)";
    const trailHighlight = "rgba(110, 110, 110, 0.4)";
    const innerHeight = Math.max(centerY - 3, 1);

    for (let x = 0; x < canvasWidth; x += 1) {
      const sampleStart = windowStart + (x / canvasWidth) * visibleDuration;
      const sampleEnd = windowStart + ((x + 1) / canvasWidth) * visibleDuration;
      const startIndex = Math.floor((sampleStart / resolvedDuration) * points.length);
      const endIndex = Math.max(startIndex + 1, Math.floor((sampleEnd / resolvedDuration) * points.length));
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
  }, [waveH, ph, accent, points, canvasWidth, resolvedDuration, visibleDuration, windowStart]);

  function handleSeek(clientX: number) {
    if (!onSeek || !wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
    const nextTime = windowStart + ratio * visibleDuration;
    onSeek(clamp(nextTime / Math.max(resolvedDuration, 0.001), 0, 1));
  }

  return (
    <div
      ref={wrapperRef}
      className={`relative border border-[#1e1e1e] rounded-[2px] bg-[#070707] overflow-hidden ${onSeek ? "cursor-pointer" : ""}`}
      style={{ height }}
      onPointerDown={(event) => handleSeek(event.clientX)}
    >
      {label ? (
        <div className="absolute top-[3px] left-[8px] text-[9px] uppercase tracking-[0.18em] text-[#3a3a3a] z-10 pointer-events-none">
          {label}
        </div>
      ) : null}

      <canvas ref={canvasRef} className="absolute inset-x-0 w-full" style={{ top: rulerH, height: waveH }} />

      <svg
        className="absolute inset-x-0 w-full"
        style={{ top: rulerH, height: waveH }}
        viewBox={`0 0 ${canvasWidth} ${waveH}`}
        preserveAspectRatio="none"
      >
        {Array.from({ length: totalBeats + 1 }, (_, i) => {
          const time = derivedBeatTimes.length ? (i === totalBeats ? resolvedDuration : (derivedBeatTimes[i] ?? 0)) : (i / totalBeats) * resolvedDuration;
          if (time < windowStart || time > windowEnd) return null;
          const x = projectTimeToX(time, windowStart, windowEnd, canvasWidth);
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
              const time = derivedBeatTimes.length ? (derivedBeatTimes[i] ?? 0) : (i / totalBeats) * resolvedDuration;
              if (time < windowStart || time > windowEnd) return null;
              const x = projectTimeToX(time, windowStart, windowEnd, canvasWidth);
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
                  {isBarStart && bar % labelStep === 1 && (
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
                  {!isBarStart && resolvedZoom === 2 && (
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
          BARS <span className="text-[#4a4a4a]">{resolvedBarCount}</span>
        </span>
        <span className="text-[#4a4a4a]">
          {fmt(playhead * resolvedDuration)} / {fmt(resolvedDuration)}
        </span>
      </div>
    </div>
  );
}

function projectTimeToX(time: number, windowStart: number, windowEnd: number, width: number) {
  const windowDuration = Math.max(windowEnd - windowStart, 0.001);
  return ((time - windowStart) / windowDuration) * width;
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
