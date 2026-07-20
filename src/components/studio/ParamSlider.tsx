"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

type ParamSliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  accent?: string;
  layout?: "row" | "stack";
  commitOnRelease?: boolean;
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
  commitOnRelease = false,
  onChange,
}: ParamSliderProps) {
  const [previewValue, setPreviewValue] = useState<number | null>(null);
  const previewValueRef = useRef<number | null>(null);
  const committedValueRef = useRef<number | null>(null);
  const normalizedPropValue = normalizeSliderValue(value, min, max, step);
  const normalizedValue = previewValue ?? normalizedPropValue;
  const pct = ((normalizedValue - min) / (max - min)) * 100;
  const dv = Math.abs(max - min) >= 10 ? normalizedValue.toFixed(step < 1 ? 1 : 0) : normalizedValue.toFixed(2);
  const sliderStyle = {
    "--slider-accent": accent,
    "--slider-pct": `${pct}%`,
  } as CSSProperties;
  const nudge = (direction: -1 | 1) => onChange(normalizeSliderValue(normalizedValue + direction * step, min, max, step));
  const previewChange = (nextValue: number) => {
    const update = resolveSliderUpdate({ deferred: commitOnRelease, phase: "input", value: nextValue });
    if (commitOnRelease) {
      committedValueRef.current = null;
      previewValueRef.current = update.previewValue;
      setPreviewValue(update.previewValue);
    }
    if (update.publishValue !== null) onChange(update.publishValue);
  };
  const commitPreview = () => {
    const pendingValue = previewValueRef.current;
    if (pendingValue === null) return;
    const update = resolveSliderUpdate({ deferred: commitOnRelease, phase: "commit", value: pendingValue });
    previewValueRef.current = null;
    committedValueRef.current = update.retainPreview ? pendingValue : null;
    if (!update.retainPreview) setPreviewValue(null);
    if (update.publishValue !== null) onChange(update.publishValue);
  };

  useEffect(() => {
    if (committedValueRef.current !== normalizedPropValue) return;
    committedValueRef.current = null;
    const clearPreviewTimer = window.setTimeout(() => setPreviewValue(null), 0);
    return () => window.clearTimeout(clearPreviewTimer);
  }, [normalizedPropValue]);
  const input = (
    <input
      type="range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={normalizedValue}
      onChange={(event) => previewChange(normalizeSliderValue(Number(event.target.value), min, max, step))}
      onPointerUp={commitPreview}
      onPointerCancel={commitPreview}
      onKeyUp={commitPreview}
      onBlur={commitPreview}
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

export function resolveSliderUpdate({ deferred, phase, value }: { deferred: boolean; phase: "input" | "commit"; value: number }) {
  return {
    previewValue: value,
    publishValue: deferred && phase === "input" ? null : value,
    retainPreview: deferred,
  };
}

function normalizeSliderValue(value: number, min: number, max: number, step: number) {
  const clamped = Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  if (!Number.isFinite(step) || step <= 0) return clamped;
  const snapped = min + Math.round((clamped - min) / step) * step;
  const decimals = Math.max(0, `${step}`.split(".")[1]?.length ?? 0);
  return Number(Math.min(max, Math.max(min, snapped)).toFixed(decimals));
}
