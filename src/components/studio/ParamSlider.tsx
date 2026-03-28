"use client";

type ParamSliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  accent?: string;
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
  onChange,
}: ParamSliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  const dv = Math.abs(max - min) >= 10 ? value.toFixed(step < 1 ? 1 : 0) : value.toFixed(2);
  return (
    <div className="flex items-center gap-3 py-[5px] border-b border-[#141414] last:border-0">
      <span className="w-28 shrink-0 text-[10px] uppercase tracking-[0.12em] text-[#555]">{label}</span>
      <div className="relative flex-1 h-[2px] bg-[#1c1c1c]">
        <div className="absolute left-0 top-0 h-full" style={{ width: `${pct}%`, background: accent }} />
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-[2px] border border-[#484848] bg-[#2a2a2a]"
          style={{ left: `calc(${pct}% - 4px)`, width: 8, height: 20 }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
          style={{ height: 24, top: -11 }}
        />
      </div>
      <span className="w-14 text-right font-mono text-[12px] tabular-nums shrink-0" style={{ color: accent }}>
        {dv}
        {unit}
      </span>
    </div>
  );
}
