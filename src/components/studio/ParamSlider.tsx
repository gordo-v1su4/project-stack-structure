"use client";

import type { CSSProperties, PointerEvent } from "react";

type ParamSliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  accent?: string;
  layout?: "row" | "stack";
  onChange: (v: number) => void;
};

export function ParamSlider({
  label,
  value,
  min,
  max,
  step = 0.01,
  unit = "",
  accent = "#e05c00",
  layout = "row",
  onChange,
}: ParamSliderProps) {
  const normalizedValue = normalizeSliderValue(value, min, max, step);
  const pct = ((normalizedValue - min) / (max - min)) * 100;
  const dv = Math.abs(max - min) >= 10 ? normalizedValue.toFixed(step < 1 ? 1 : 0) : normalizedValue.toFixed(2);
  const sliderStyle = {
    "--slider-accent": accent,
    "--slider-pct": `${pct}%`,
  } as CSSProperties;
  const nudge = (direction: -1 | 1) => onChange(normalizeSliderValue(normalizedValue + direction * step, min, max, step));
  const handlePointerDown = (event: PointerEvent<HTMLInputElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const thumbX = bounds.left + (pct / 100) * bounds.width;
    const pointerX = event.clientX;
    const thumbGrabWindow = 18;
    if (Math.abs(pointerX - thumbX) <= thumbGrabWindow) return;
    event.preventDefault();
    nudge(pointerX < thumbX ? -1 : 1);
  };
  const input = (
    <input
      type="range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={normalizedValue}
      onPointerDown={handlePointerDown}
      onChange={(e) => onChange(normalizeSliderValue(Number(e.target.value), min, max, step))}
      className="studio-range-input h-8 min-w-0 flex-1 cursor-pointer"
      style={sliderStyle}
    />
  );

  if (layout === "stack") {
    return (
      <div className="border-b border-[#141414] py-2 last:border-0">
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className="text-[10px] uppercase tracking-[0.12em] text-[#555]">{label}</span>
          <span className="text-right font-mono text-[12px] tabular-nums" style={{ color: accent }}>
            {dv}
            {unit}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" aria-label={`Decrease ${label}`} onClick={() => nudge(-1)} className="h-7 w-7 shrink-0 rounded-[2px] border border-[#262626] text-[12px] text-[#777] hover:border-[#555] hover:text-[#ddd]">
            −
          </button>
          {input}
          <button type="button" aria-label={`Increase ${label}`} onClick={() => nudge(1)} className="h-7 w-7 shrink-0 rounded-[2px] border border-[#262626] text-[12px] text-[#777] hover:border-[#555] hover:text-[#ddd]">
            +
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 border-b border-[#141414] py-[5px] last:border-0">
      <span className="w-28 shrink-0 text-[10px] uppercase tracking-[0.12em] text-[#555]">{label}</span>
      {input}
      <span className="w-14 shrink-0 text-right font-mono text-[12px] tabular-nums" style={{ color: accent }}>
        {dv}
        {unit}
      </span>
    </div>
  );
}

function normalizeSliderValue(value: number, min: number, max: number, step: number) {
  const clamped = Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  if (!Number.isFinite(step) || step <= 0) return clamped;
  const snapped = min + Math.round((clamped - min) / step) * step;
  const decimals = Math.max(0, `${step}`.split(".")[1]?.length ?? 0);
  return Number(Math.min(max, Math.max(min, snapped)).toFixed(decimals));
}
