"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";

// ─── Seed RNG ─────────────────────────────────────────────────────────────────
function sv(seed: number) {
  const x = Math.sin(seed * 127.1 + 3.7) * 43758.5453;
  return x - Math.floor(x);
}
function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

type Tab = "split" | "beatsplit" | "shuffle" | "join" | "beatjoin" | "ramp";
type ShuffleMode = "simple" | "size" | "color" | "motion";
type RampPreset = "subtle" | "dynamic" | "extreme" | "cinematic";

// ─── Solid waveform data (smooth envelope) ────────────────────────────────────
function makeWavePoints(n: number, seed: number): number[] {
  return Array.from({ length: n }, (_, i) => {
    const t = i / n;
    const env = 0.1 + 0.85 * Math.pow(Math.sin(t * Math.PI), 0.4);
    const hi = Math.abs(Math.sin(t * 53.1 + seed * 2.3)) * 0.6;
    const mid = Math.abs(Math.sin(t * 17.7 + seed * 1.1)) * 0.35;
    const lo = Math.abs(Math.sin(t * 6.2 + seed * 0.7)) * 0.25;
    return Math.min(0.98, env * (0.12 + hi + mid + lo));
  });
}

const WAVE_MAIN = makeWavePoints(400, 2.3);
const WAVE_AUDIO = makeWavePoints(400, 5.7);

// ─── Solid Filled Waveform SVG ────────────────────────────────────────────────
function SolidWaveform({
  points,
  playhead,
  bpm = 130,
  beatsPerBar = 4,
  totalBars = 8,
  accent = "#e05c00",
  height = 100,
  label = "SOURCE",
  showRuler = true,
}: {
  points: number[];
  playhead: number;
  bpm?: number;
  beatsPerBar?: number;
  totalBars?: number;
  accent?: string;
  height?: number;
  label?: string;
  showRuler?: boolean;
}) {
  const W = 1000;
  const rulerH = showRuler ? 22 : 0;
  const waveH = height - rulerH;
  const H = waveH * 2; // SVG coordinate height (doubled for resolution)
  const mid = H / 2;

  // Build solid filled waveform path (top + mirrored bottom)
  const topPath = useMemo(() => {
    if (points.length < 2) return "";
    const step = W / (points.length - 1);
    // top half
    let d = `M 0 ${mid}`;
    points.forEach((v, i) => {
      const x = i * step;
      const y = mid - v * mid * 0.92;
      d += ` L ${x} ${y}`;
    });
    // bottom mirror
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

  return (
    <div className="relative border border-[#1e1e1e] rounded-[2px] bg-[#070707] overflow-hidden" style={{ height }}>
      {/* Label */}
      <div className="absolute top-[3px] left-[8px] text-[9px] uppercase tracking-[0.18em] text-[#3a3a3a] z-10 pointer-events-none">
        {label}
      </div>

      {/* Waveform SVG */}
      <svg
        className="absolute left-0 right-0"
        style={{ top: rulerH, height: waveH }}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={`wg-${label.replace(/\s/g,"-")}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={accent} stopOpacity="0.9" />
            <stop offset={`${playhead * 100}%`} stopColor={accent} stopOpacity="0.85" />
            <stop offset={`${playhead * 100}%`} stopColor="#2e2e2e" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#1e1e1e" stopOpacity="0.6" />
          </linearGradient>
          {/* beat grid clip before playhead */}
        </defs>

        {/* Beat grid lines */}
        {Array.from({ length: totalBeats + 1 }, (_, i) => {
          const x = (i / totalBeats) * W;
          const isBar = i % beatsPerBar === 0;
          return (
            <line key={i} x1={x} y1={0} x2={x} y2={H}
              stroke={isBar ? "#252525" : "#141414"}
              strokeWidth={isBar ? 1.2 : 0.6}
            />
          );
        })}

        {/* Waveform fill */}
        <path d={topPath} fill={`url(#wg-${label.replace(/\s/g,"-")})`} />

        {/* Playhead line */}
        <line x1={ph} y1={0} x2={ph} y2={H} stroke={accent} strokeWidth={1.5} />
        <polygon points={`${ph - 5},0 ${ph + 5},0 ${ph},10`} fill={accent} />
      </svg>

      {/* Bar/Beat ruler */}
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
              const isBar = beat === 1;
              return (
                <g key={i}>
                  <line x1={x} y1={0} x2={x} y2={rulerH * 2}
                    stroke={isBar ? "#2a2a2a" : "#181818"}
                    strokeWidth={isBar ? 1.2 : 0.6}
                  />
                  {isBar && (
                    <text x={x + 4} y={rulerH * 1.4} fontSize={10} fill="#404040"
                      fontFamily="monospace" fontWeight="600">
                      {bar}
                    </text>
                  )}
                  {!isBar && (
                    <text x={x + 3} y={rulerH * 1.5} fontSize={8} fill="#282828"
                      fontFamily="monospace">
                      {bar}-{beat}
                    </text>
                  )}
                </g>
              );
            })}
            {/* Playhead on ruler */}
            <rect x={ph - 1} y={0} width={2} height={rulerH * 2} fill={accent} opacity="0.7" />
          </svg>
        </div>
      )}

      {/* BPM / time readout */}
      <div className="absolute bottom-[3px] right-[8px] flex gap-4 text-[9px] font-mono text-[#333] z-10 pointer-events-none">
        <span>BPM <span className="text-[#4a4a4a]">{bpm}</span></span>
        <span>BARS <span className="text-[#4a4a4a]">{totalBars}</span></span>
        <span className="text-[#4a4a4a]">{fmt(playhead * (totalBars * beatsPerBar * (60 / bpm)))}</span>
      </div>
    </div>
  );
}

// ─── Palette extraction (deterministic) ──────────────────────────────────────
function getClipPalette(idx: number): string[] {
  const palettes = [
    ["#c94a2a", "#e07030", "#d4a050", "#8a3020"],
    ["#2a4a8a", "#3060b0", "#1a8090", "#204060"],
    ["#3a8a3a", "#60a840", "#2a6020", "#80c060"],
    ["#8a2a6a", "#b04080", "#602050", "#d060a0"],
    ["#8a7020", "#c0a030", "#604010", "#e0c050"],
    ["#2a6a7a", "#40a0b0", "#1a4050", "#60c0d0"],
    ["#6a3a1a", "#a06030", "#402010", "#c08050"],
    ["#4a2a8a", "#7040c0", "#301060", "#9060e0"],
    ["#7a2a2a", "#b04040", "#501010", "#e06060"],
    ["#2a5a2a", "#409040", "#1a3010", "#60b060"],
    ["#5a4a1a", "#907830", "#3a2a08", "#c0a850"],
    ["#1a4a6a", "#2870a0", "#0a2030", "#4090c0"],
  ];
  return palettes[idx % palettes.length];
}

function getMotionDir(idx: number): { dir: string; angle: number; label: string } {
  const dirs = [
    { dir: "→", angle: 0,   label: "PAN R" },
    { dir: "←", angle: 180, label: "PAN L" },
    { dir: "↑", angle: 270, label: "TILT U" },
    { dir: "↓", angle: 90,  label: "TILT D" },
    { dir: "↗", angle: 315, label: "DIAG UR" },
    { dir: "↙", angle: 135, label: "DIAG DL" },
    { dir: "↘", angle: 45,  label: "DIAG DR" },
    { dir: "↖", angle: 225, label: "DIAG UL" },
    { dir: "⟳", angle: -1,  label: "ROTATE" },
    { dir: "⤢", angle: -2,  label: "ZOOM IN" },
    { dir: "⤡", angle: -3,  label: "ZOOM OUT" },
    { dir: "⊕", angle: -4,  label: "STATIC" },
  ];
  return dirs[idx % dirs.length];
}

// ─── Visual Clip Thumbnail (looks like a video frame, no waveform inside) ─────
function VideoClip({
  idx,
  active,
  mode,
  showColorBars = false,
  matchScore = 0,
  onClick,
}: {
  idx: number;
  active?: boolean;
  mode: ShuffleMode;
  showColorBars?: boolean;
  matchScore?: number;
  onClick?: () => void;
}) {
  const palette = getClipPalette(idx);
  const motion = getMotionDir(idx);
  const dur = (sv(idx + 0.3) * 6 + 1.5).toFixed(1);

  // Generate a gradient that looks like a video still
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

        {/* Simulated scene content: a few abstract shapes */}
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice">
          {/* horizon line */}
          <line x1={0} y1={sv(idx * 3 + 1) * 60 + 15} x2={160} y2={sv(idx * 5 + 2) * 60 + 15}
            stroke="#00000022" strokeWidth={20} />
          {/* subject silhouette */}
          <ellipse cx={sv(idx * 11) * 100 + 30} cy={sv(idx * 7) * 40 + 25} rx={sv(idx * 13) * 25 + 8} ry={sv(idx * 9) * 20 + 6}
            fill="#00000033" />
          {/* highlight */}
          <ellipse cx={sv(idx * 17) * 120 + 20} cy={sv(idx * 19) * 30 + 5} rx={sv(idx * 23) * 30 + 5} ry={sv(idx * 29) * 15 + 3}
            fill="#ffffff0a" />
        </svg>

        {/* Top-left: clip label */}
        {active && <div className="absolute top-0 left-0 right-0 h-[2px] bg-[#e05c00]" />}
        <div className="absolute top-[3px] left-[3px] text-[7px] font-mono text-[#ffffff88] bg-[#00000055] px-1 rounded-[1px]">
          C{String(idx + 1).padStart(2, "0")}
        </div>
        <div className="absolute bottom-[3px] right-[3px] text-[7px] font-mono text-[#ffffff66] bg-[#00000055] px-1 rounded-[1px]">
          {dur}s
        </div>

        {/* Motion mode: direction arrow overlay */}
        {mode === "motion" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-[1px]">
              <span className="text-[16px] leading-none" style={{ color: active ? "#e05c00" : "#ffffff99" }}>
                {motion.dir}
              </span>
              <span className="text-[6px] font-mono tracking-[0.1em]" style={{ color: active ? "#e05c00aa" : "#ffffff55" }}>
                {motion.label}
              </span>
            </div>
          </div>
        )}

        {/* Color mode: palette bar at bottom */}
        {mode === "color" && (
          <div className="absolute bottom-0 left-0 right-0 flex h-[6px]">
            {palette.map((c, j) => (
              <div key={j} className="flex-1" style={{ background: c }} />
            ))}
          </div>
        )}

        {/* Size mode: file size indicator */}
        {mode === "size" && (
          <div className="absolute bottom-[3px] left-[3px] text-[6px] font-mono text-[#ffffff77] bg-[#00000066] px-1 rounded-[1px]">
            {(sv(idx * 31) * 80 + 20).toFixed(0)}MB
          </div>
        )}
      </div>

      {/* Color match bar — shown between clips in color mode */}
      {showColorBars && mode === "color" && (
        <div className="relative h-[14px] bg-[#0a0a0a] border-x border-[#1e1e1e] flex items-center px-1 gap-px">
          {/* current clip end colors */}
          {palette.slice(0, 2).map((c, j) => (
            <div key={j} className="h-[8px] flex-1 rounded-[1px]" style={{ background: c, opacity: 0.8 }} />
          ))}
          {/* match score indicator */}
          <div className="mx-1 flex-shrink-0 text-[6px] font-mono" style={{ color: matchScore > 0.7 ? "#e05c00" : "#333" }}>
            {(matchScore * 100).toFixed(0)}%
          </div>
          {/* next clip start colors */}
          {getClipPalette(idx + 1).slice(0, 2).map((c, j) => (
            <div key={j} className="h-[8px] flex-1 rounded-[1px]" style={{ background: c, opacity: 0.8 }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Param Slider (rectangular thumb, no circles) ─────────────────────────────
function ParamSlider({
  label, value, min, max, step = 0.01, unit = "", accent = "#e05c00", onChange,
}: {
  label: string; value: number; min: number; max: number;
  step?: number; unit?: string; accent?: string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const dv = Math.abs(max - min) >= 10 ? value.toFixed(step < 1 ? 1 : 0) : value.toFixed(2);
  return (
    <div className="flex items-center gap-3 py-[5px] border-b border-[#141414] last:border-0">
      <span className="w-28 shrink-0 text-[10px] uppercase tracking-[0.12em] text-[#555]">{label}</span>
      <div className="relative flex-1 h-[2px] bg-[#1c1c1c]">
        <div className="absolute left-0 top-0 h-full" style={{ width: `${pct}%`, background: accent }} />
        {/* rectangular thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-[2px] border border-[#484848] bg-[#2a2a2a]"
          style={{ left: `calc(${pct}% - 4px)`, width: 8, height: 20 }}
        />
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
          style={{ height: 24, top: -11 }}
        />
      </div>
      <span className="w-14 text-right font-mono text-[12px] tabular-nums shrink-0" style={{ color: accent }}>
        {dv}{unit}
      </span>
    </div>
  );
}

// ─── Speed Curve Editor ───────────────────────────────────────────────────────
function SpeedCurve({ minSpeed, maxSpeed, preset }: { minSpeed: number; maxSpeed: number; preset: RampPreset }) {
  const W = 800; const H = 200;
  const PAD = { t: 16, b: 28, l: 40, r: 12 };
  const chartW = W - PAD.l - PAD.r;
  const chartH = H - PAD.t - PAD.b;

  const basePoints = useMemo(() => {
    const shapes: Record<RampPreset, number[]> = {
      subtle:    [0.5,0.55,0.52,0.6,0.58,0.65,0.6,0.55,0.5],
      dynamic:   [0.3,0.4,0.55,0.8,1.0,0.85,0.7,0.5,0.35],
      extreme:   [0.25,0.5,0.9,1.0,0.75,1.0,0.6,0.9,0.25],
      cinematic: [0.4,0.45,0.5,0.6,0.7,0.75,0.65,0.55,0.45],
    };
    return shapes[preset];
  }, [preset]);

  const [nodes, setNodes] = useState(() =>
    basePoints.map((v, i) => ({ x: i / (basePoints.length - 1), y: v }))
  );
  useEffect(() => {
    setNodes(basePoints.map((v, i) => ({ x: i / (basePoints.length - 1), y: v })));
  }, [preset]);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<number | null>(null);
  const toScreen = (nx: number, ny: number) => ({ sx: PAD.l + nx * chartW, sy: PAD.t + (1 - ny) * chartH });
  const toNorm = useCallback((sx: number, sy: number) => ({
    nx: Math.max(0, Math.min(1, (sx - PAD.l) / chartW)),
    ny: Math.max(0, Math.min(1, 1 - (sy - PAD.t) / chartH)),
  }), []);

  function catmullPath() {
    if (nodes.length < 2) return "";
    const pts = nodes.map((n) => toScreen(n.x, n.y));
    let d = `M ${pts[0].sx} ${pts[0].sy}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      const cp1x = p1.sx + (p2.sx - p0.sx) / 6, cp1y = p1.sy + (p2.sy - p0.sy) / 6;
      const cp2x = p2.sx - (p3.sx - p1.sx) / 6, cp2y = p2.sy - (p3.sy - p1.sy) / 6;
      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.sx} ${p2.sy}`;
    }
    return d;
  }
  function fillPath() {
    const curve = catmullPath();
    const last = toScreen(nodes[nodes.length - 1].x, nodes[nodes.length - 1].y);
    const first = toScreen(nodes[0].x, nodes[0].y);
    return `${curve} L ${last.sx} ${PAD.t + chartH} L ${first.sx} ${PAD.t + chartH} Z`;
  }

  const accent = "#e05c00";
  const yLabels = [maxSpeed, lerp(minSpeed, maxSpeed, 0.75), 1, lerp(minSpeed, maxSpeed, 0.25), minSpeed];

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
      className="w-full rounded-[2px] border border-[#1a1a1a] bg-[#070707] cursor-crosshair"
      style={{ height: 160 }}
      onMouseMove={(e) => {
        if (dragging.current === null || !svgRef.current) return;
        const r = svgRef.current.getBoundingClientRect();
        const { ny } = toNorm(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H);
        setNodes((prev) => prev.map((n, i) => i === dragging.current ? { ...n, y: ny } : n));
      }}
      onMouseUp={() => { dragging.current = null; }}
      onMouseLeave={() => { dragging.current = null; }}
    >
      <defs>
        <linearGradient id="cf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.18" />
          <stop offset="100%" stopColor={accent} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <line key={t} x1={PAD.l} y1={PAD.t + t * chartH} x2={W - PAD.r} y2={PAD.t + t * chartH} stroke="#181818" strokeWidth={1} />
      ))}
      {Array.from({ length: 9 }, (_, i) => (
        <line key={i} x1={PAD.l + (i / 8) * chartW} y1={PAD.t} x2={PAD.l + (i / 8) * chartW} y2={PAD.t + chartH} stroke="#131313" strokeWidth={1} />
      ))}
      {/* 1× reference */}
      {(() => {
        const oneY = PAD.t + (1 - (1 - minSpeed) / (maxSpeed - minSpeed)) * chartH;
        return <line x1={PAD.l} y1={oneY} x2={W - PAD.r} y2={oneY} stroke={`${accent}44`} strokeWidth={1} strokeDasharray="4 4" />;
      })()}
      <path d={fillPath()} fill="url(#cf)" />
      <path d={catmullPath()} fill="none" stroke={accent} strokeWidth={2.5} />
      {nodes.map((n, i) => {
        const { sx, sy } = toScreen(n.x, n.y);
        return (
          <g key={i}>
            <circle cx={sx} cy={sy} r={10} fill="transparent" className="cursor-grab" onMouseDown={(e) => { e.preventDefault(); dragging.current = i; }} />
            <circle cx={sx} cy={sy} r={4} fill="#111" stroke={accent} strokeWidth={1.5} className="cursor-grab" onMouseDown={(e) => { e.preventDefault(); dragging.current = i; }} />
          </g>
        );
      })}
      {yLabels.map((v, i) => (
        <text key={i} x={PAD.l - 5} y={PAD.t + (i / (yLabels.length - 1)) * chartH + 4} textAnchor="end" fontSize={9} fill="#444" fontFamily="monospace">{v.toFixed(1)}×</text>
      ))}
      {["1-1","2-1","3-1","4-1","5-1","6-1","7-1","8-1","END"].map((t, i) => (
        <text key={i} x={PAD.l + (i / 8) * chartW} y={H - 8} textAnchor="middle" fontSize={8} fill="#383838" fontFamily="monospace">{t}</text>
      ))}
    </svg>
  );
}

// ─── Sidebar nav ─────────────────────────────────────────────────────────────
const NAV: { key: Tab; label: string; sub: string }[] = [
  { key: "split",     label: "Standard Split", sub: "GPU / CUDA" },
  { key: "beatsplit", label: "Beat Split",      sub: "BPM sync" },
  { key: "shuffle",   label: "Shuffle Modes",   sub: "5 algorithms" },
  { key: "join",      label: "Standard Join",   sub: "Concat" },
  { key: "beatjoin",  label: "Beat Join",       sub: "Energy reactive" },
  { key: "ramp",      label: "Speed Ramp",      sub: "Envelope curve" },
];

const LOG = [
  { tag: "SYSTEM", msg: "INIT_KERNEL_SUCCESS",        col: "#555" },
  { tag: "AUDIO",  msg: "FFMPEG_LISTEN_PORT: 8080",   col: "#e05c00" },
  { tag: "VIDEO",  msg: "NV_ENC_CONTEXT_READY",       col: "#555" },
  { tag: "GPU",    msg: "TEMP_STABLE_42C",             col: "#e05c00" },
  { tag: "CUDA",   msg: "SM_120 ACTIVE · 16384 CORES",col: "#555" },
];

// ─── App ─────────────────────────────────────────────────────────────────────
export default function StudioApp() {
  const [tab, setTab] = useState<Tab>("split");
  const [playhead, setPlayhead] = useState(0.08);
  const [activeClip, setActiveClip] = useState(2);

  const [gpu, setGpu] = useState(24);
  const [cpu, setCpu] = useState(11);
  const [vram, setVram] = useState(7.8);

  const [clipDur, setClipDur] = useState(5);
  const [barsPerSeg, setBarsPerSeg] = useState(2);
  const [bpm] = useState(130);
  const [sensitivity, setSensitivity] = useState(68);

  const [shuffleMode, setShuffleMode] = useState<ShuffleMode>("color");
  const [minScore, setMinScore] = useState(0.5);
  const [lookahead, setLookahead] = useState(3);
  const [keepPct, setKeepPct] = useState(70);
  const [colorGradient, setColorGradient] = useState<"Rainbow"|"Sunset"|"Ocean">("Sunset");

  const [joinClips, setJoinClips] = useState(
    Array.from({ length: 12 }, (_, i) => ({ id: i, on: true }))
  );

  const [minDur, setMinDur] = useState(0.12);
  const [maxDur, setMaxDur] = useState(0.8);
  const [energyResp, setEnergyResp] = useState(1.5);
  const [chaos, setChaos] = useState(0.35);
  const [onsetBoost, setOnsetBoost] = useState(0.6);
  const [energyReactive, setEnergyReactive] = useState(true);

  const [rampPreset, setRampPreset] = useState<RampPreset>("dynamic");
  const [minSpeed, setMinSpeed] = useState(0.5);
  const [maxSpeed, setMaxSpeed] = useState(2.0);
  const [rampDur, setRampDur] = useState(0.5);
  const [energyThresh, setEnergyThresh] = useState(0.4);
  const [buildBoost, setBuildBoost] = useState(1.3);
  const [dropSlowdown, setDropSlowdown] = useState(0.6);

  const [progress, setProgress] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [done, setDone] = useState(false);

  // Playhead animation
  useEffect(() => {
    const id = setInterval(() => setPlayhead((p) => (p >= 0.97 ? 0.02 : p + 0.003)), 80);
    return () => clearInterval(id);
  }, []);

  // Engine meter drift
  useEffect(() => {
    const id = setInterval(() => {
      setGpu((g) => Math.max(10, Math.min(48, g + (Math.random() - 0.5) * 3)));
      setCpu((c) => Math.max(5, Math.min(28, c + (Math.random() - 0.5) * 2)));
      setVram((v) => Math.max(5, Math.min(14, v + (Math.random() - 0.5) * 0.15)));
    }, 1400);
    return () => clearInterval(id);
  }, []);

  function runProcess() {
    if (isRunning) return;
    setIsRunning(true); setDone(false); setProgress(0);
    let p = 0;
    const id = setInterval(() => {
      p += Math.random() * 7 + 2;
      setProgress(Math.min(p, 100));
      if (p >= 100) { clearInterval(id); setIsRunning(false); setDone(true); }
    }, 160);
  }

  const tabLabel = NAV.find((n) => n.key === tab)?.label ?? "";
  const tabSub   = NAV.find((n) => n.key === tab)?.sub ?? "";

  // Color sort gradient direction
  const gradientColors: Record<string, string[]> = {
    Rainbow: ["#e03030","#e07030","#d0d030","#30c030","#3080e0","#8030c0"],
    Sunset:  ["#e04020","#e06030","#d08040","#c07060","#a05080","#603090"],
    Ocean:   ["#20a0d0","#2080c0","#1860a0","#104080","#082060","#041030"],
  };

  // Readout values per tab
  const readout: [string, string | number][] =
    tab === "split"     ? [["Clip Dur", `${clipDur}s`],["Est Clips", Math.floor(300/clipDur)],["GPU", `${gpu.toFixed(0)}%`],["Codec","H.264"]]
    : tab === "beatsplit" ? [["BPM", bpm],["Bars/Seg",barsPerSeg],["Segments",Math.floor(16/barsPerSeg)],["Confidence","94%"]]
    : tab === "shuffle"   ? [["Mode",shuffleMode],["Clips",12],["Min Score",minScore.toFixed(2)],["Lookahead",lookahead]]
    : tab === "join"      ? [["Active",joinClips.filter(c=>c.on).length],["Duration",fmt(joinClips.filter(c=>c.on).reduce((a,c)=>a+sv(c.id+1)*8+1,0))],["Format","MP4"],["Output","/output/"]]
    : tab === "beatjoin"  ? [["Min Dur",`${minDur.toFixed(2)}s`],["Max Dur",`${maxDur.toFixed(2)}s`],["Chaos",chaos.toFixed(2)],["Onset",onsetBoost.toFixed(2)]]
    : [["Preset",rampPreset],["Min Spd",`${minSpeed}×`],["Max Spd",`${maxSpeed}×`],["Ramp",`${rampDur}s`]];

  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0a0a] text-[#c0c0c0] antialiased select-none"
      style={{ fontFamily: "'Inter','SF Pro Display',system-ui,sans-serif" }}>

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-[#181818] bg-[#0c0c0c]">
        <div className="flex items-center gap-2 border-b border-[#181818] px-3 py-[10px]">
          <div className="grid grid-cols-2 gap-[2px] shrink-0">
            <div className="h-[7px] w-[7px] bg-[#e05c00]" />
            <div className="h-[7px] w-[7px] bg-[#2a2a2a]" />
            <div className="h-[7px] w-[7px] bg-[#2a2a2a]" />
            <div className="h-[7px] w-[7px] bg-[#e05c00]" />
          </div>
          <div>
            <div className="text-[13px] font-semibold tracking-wide text-[#e0e0e0]">SVS Studio</div>
            <div className="text-[9px] uppercase tracking-[0.22em] text-[#3a3a3a]">Video Process Engine</div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          <div className="mb-1 px-3 pt-1 text-[9px] uppercase tracking-[0.22em] text-[#343434]">Module Selection</div>
          {NAV.map((item) => (
            <button key={item.key}
              onClick={() => { setTab(item.key); setDone(false); setProgress(0); }}
              className={`flex w-full items-center gap-0 px-0 py-0 text-left transition-colors ${tab===item.key ? "bg-[#131313] text-[#e0e0e0]" : "text-[#585858] hover:bg-[#0f0f0f] hover:text-[#999]"}`}
            >
              <div className="w-[2px] self-stretch shrink-0 mr-3" style={{ background: tab===item.key ? "#e05c00" : "transparent", minHeight: 32 }} />
              <div className="py-[7px]">
                <div className="text-[12px] font-medium leading-tight">{item.label}</div>
                <div className="text-[10px] text-[#3a3a3a]">{item.sub}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Engine stats */}
        <div className="border-t border-[#181818] p-3 space-y-[6px]">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] uppercase tracking-[0.2em] text-[#353535]">Engine</span>
            <span className="flex items-center gap-1 text-[9px] text-[#3a8a3a]">
              <span className="h-[5px] w-[5px] rounded-full bg-[#3a8a3a] animate-pulse" />LIVE
            </span>
          </div>
          {[
            { label: "RTX 5090", val: gpu, unit: "%", max: 100, color: "#e05c00" },
            { label: "CPU",      val: cpu, unit: "%", max: 100, color: "#454545" },
            { label: "VRAM",     val: vram,unit: " GB",max: 24, color: "#6a5000" },
          ].map((m) => (
            <div key={m.label}>
              <div className="flex justify-between text-[10px] mb-[3px]">
                <span className="text-[#3a3a3a]">{m.label}</span>
                <span className="font-mono" style={{ color: m.color }}>
                  {m.val.toFixed(m.unit === " GB" ? 1 : 0)}{m.unit}
                </span>
              </div>
              <div className="h-[2px] bg-[#181818] rounded-full">
                <div className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${(m.val / m.max) * 100}%`, background: m.color }} />
              </div>
            </div>
          ))}
          <div className="pt-1 text-[9px] font-mono text-[#2a2a2a]">FFmpeg 7.1 · CUDA 12.8</div>
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* Header */}
        <header className="flex items-center justify-between border-b border-[#181818] bg-[#0c0c0c] px-5 py-[8px] shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-[10px] uppercase tracking-[0.22em] text-[#363636]">SVS</span>
            <span className="text-[#222]">/</span>
            <span className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#d0d0d0]">{tabLabel}</span>
            <span className="text-[10px] text-[#3a3a3a] border-l border-[#222] pl-3 ml-1">{tabSub}</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-2 text-[10px] text-[#3a8a3a] uppercase tracking-[0.18em]">
              <span className="h-[5px] w-[5px] rounded-full bg-[#3a8a3a] animate-pulse" />Engine Ready
            </span>
            <span className="font-mono text-[11px] text-[#383838]">{fmt(playhead * (8 * 4 * (60 / bpm)))}</span>
          </div>
        </header>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 overflow-y-auto p-4 space-y-3">

            {/* ──────────────────────────── STANDARD SPLIT ──────────────────── */}
            {tab === "split" && (<>
              {/* Main waveform — the primary timeline */}
              <SolidWaveform points={WAVE_MAIN} playhead={playhead} bpm={bpm} totalBars={8} beatsPerBar={4}
                label="SOURCE · CLIP_001.MP4 · 5:00" height={120} />

              {/* Clip output preview strip */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-[#404040]">
                    Output Segments — {Math.floor(300/clipDur)} clips @ {clipDur}s
                  </span>
                  <span className="text-[10px] font-mono text-[#e05c00]">/output/split/</span>
                </div>
                {/* Proportional clip strip */}
                <div className="relative h-10 bg-[#070707] border border-[#1a1a1a] rounded-[2px] flex overflow-hidden">
                  {Array.from({ length: Math.min(Math.floor(300/clipDur), 30) }, (_, i) => (
                    <div key={i}
                      className={`relative border-r border-[#0d0d0d] cursor-pointer flex-shrink-0 transition-colors ${i===activeClip ? "bg-[#e05c0030]" : i%2===0 ? "bg-[#111]" : "bg-[#0e0e0e]"}`}
                      style={{ width: `${100/Math.min(Math.floor(300/clipDur),30)}%` }}
                      onClick={() => setActiveClip(i)}
                    >
                      {i===activeClip && <div className="absolute top-0 left-0 right-0 h-[2px] bg-[#e05c00]" />}
                      <span className="absolute bottom-[2px] left-[2px] text-[7px] font-mono text-[#333]">{i+1}</span>
                    </div>
                  ))}
                  <div className="absolute inset-y-0 w-[1px] bg-[#e05c00]" style={{ left:`${playhead*100}%` }} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
                  <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-[#404040]">Segment Parameters</div>
                  <ParamSlider label="Duration" value={clipDur} min={1} max={30} step={0.5} unit="s" onChange={setClipDur} />
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {(["H.264","H.265","AV1"] as const).map((e) => (
                      <button key={e} className="py-1 text-[11px] font-mono border border-[#1e1e1e] rounded-[2px] text-[#555] hover:border-[#2a2a2a]">{e}</button>
                    ))}
                  </div>
                </div>
                <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
                  <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-[#404040]">Hardware Target</div>
                  <div className="border border-[#e05c0033] bg-[#e05c000d] rounded-[2px] px-3 py-2 text-[11px] font-mono text-[#e05c00] mb-2">
                    NVIDIA CUDA (SM_120) — RTX 5090
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {[["Cores","16384"],["VRAM","24 GB"],["Est.",`${(clipDur*0.3).toFixed(1)}s`],["Output","/output/"]].map(([k,v])=>(
                      <div key={k} className="flex justify-between text-[10px]">
                        <span className="text-[#3a3a3a]">{k}</span>
                        <span className="font-mono text-[#666]">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>)}

            {/* ──────────────────────────── BEAT SPLIT ──────────────────────── */}
            {tab === "beatsplit" && (<>
              {/* Single main audio waveform as timeline */}
              <SolidWaveform points={WAVE_AUDIO} playhead={playhead} bpm={bpm} totalBars={8} beatsPerBar={4}
                accent="#c8900a" label="AUDIO TRACK · TRACK_01.WAV" height={120} />

              {/* Beat segment grid */}
              <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] overflow-hidden">
                <div className="flex items-center gap-4 px-3 py-2 border-b border-[#181818] text-[10px]">
                  <span className="uppercase tracking-[0.18em] text-[#404040]">Beat Segments</span>
                  <span className="font-mono text-[#555]">BPM <span className="text-[#e05c00]">{bpm}</span></span>
                  <span className="font-mono text-[#555]">BARS/SEG <span className="text-[#e05c00]">{barsPerSeg}</span></span>
                  <span className="font-mono text-[#555]">SEGS <span className="text-[#666]">{Math.floor(16/barsPerSeg)}</span></span>
                </div>
                {/* Segment blocks */}
                <div className="relative h-12 bg-[#070707] flex">
                  {Array.from({ length: Math.floor(16/barsPerSeg) }, (_, i) => (
                    <div key={i}
                      className={`relative border-r border-[#0d0d0d] cursor-pointer flex-1 transition-colors ${i===activeClip ? "bg-[#e05c0025]" : i%2===0 ? "bg-[#0f0f0f]" : "bg-[#0b0b0b]"}`}
                      onClick={() => setActiveClip(i)}
                    >
                      {i===activeClip && <div className="absolute top-0 left-0 right-0 h-[2px] bg-[#e05c00]" />}
                      <span className="absolute top-[4px] left-[4px] text-[8px] font-mono text-[#555]">
                        {i+1}-1
                      </span>
                      <span className="absolute bottom-[3px] right-[3px] text-[7px] font-mono text-[#383838]">
                        {barsPerSeg}bar
                      </span>
                    </div>
                  ))}
                  <div className="absolute inset-y-0 w-[1px] bg-[#e05c00]" style={{ left:`${playhead*100}%` }} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
                  <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[#404040]">Detection Params</div>
                  <ParamSlider label="Bars / Segment" value={barsPerSeg} min={1} max={8} step={1} onChange={setBarsPerSeg} />
                  <ParamSlider label="Sensitivity" value={sensitivity} min={0} max={100} step={1} unit="%" onChange={setSensitivity} />
                </div>
                <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
                  <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[#404040]">Analysis Result</div>
                  <div className="space-y-[4px]">
                    {[["Detected BPM",bpm],["Beat confidence","94.2%"],["Total bars",16],["Segments",Math.floor(16/barsPerSeg)]].map(([k,v])=>(
                      <div key={String(k)} className="flex justify-between text-[11px] border-b border-[#141414] pb-1">
                        <span className="text-[#484848]">{k}</span>
                        <span className="font-mono text-[#e05c00]">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>)}

            {/* ──────────────────────────── SHUFFLE ─────────────────────────── */}
            {tab === "shuffle" && (<>
              {/* Main waveform timeline at top */}
              <SolidWaveform points={WAVE_MAIN} playhead={playhead} bpm={bpm} totalBars={8} beatsPerBar={4}
                label="SOURCE · 12 CLIPS LOADED" height={90} />

              {/* Mode selector */}
              <div className="grid grid-cols-4 gap-2">
                {(["simple","size","color","motion"] as ShuffleMode[]).map((m)=>(
                  <button key={m} onClick={()=>setShuffleMode(m)}
                    className={`border rounded-[2px] py-[6px] text-[11px] uppercase tracking-[0.14em] font-medium transition-colors ${
                      shuffleMode===m ? "border-[#e05c00] bg-[#e05c0012] text-[#e05c00]" : "border-[#1a1a1a] bg-[#0c0c0c] text-[#484848] hover:border-[#272727] hover:text-[#777]"
                    }`}>
                    {m==="simple"?"Simple":m==="size"?"Size Reward":m==="color"?"Color Sort":"Motion Eye"}
                  </button>
                ))}
              </div>

              {/* Clip grid — VISUAL clips only */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-[#404040]">
                    Input Clips — 12 segments
                    {shuffleMode==="color" && <span className="ml-2 text-[#e05c0088]">· color palette tags</span>}
                    {shuffleMode==="motion" && <span className="ml-2 text-[#e05c0088]">· motion direction tagged</span>}
                  </span>
                  {shuffleMode==="color" && (
                    <div className="flex gap-1">
                      {(["Rainbow","Sunset","Ocean"] as const).map((g)=>(
                        <button key={g} onClick={()=>setColorGradient(g)}
                          className={`text-[9px] px-2 py-[2px] border rounded-[2px] transition-colors ${colorGradient===g ? "border-[#e05c00] text-[#e05c00]" : "border-[#1e1e1e] text-[#444] hover:border-[#2a2a2a]"}`}>
                          {g}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Color gradient order preview */}
                {shuffleMode==="color" && (
                  <div className="mb-2 border border-[#1a1a1a] rounded-[2px] bg-[#080808] overflow-hidden">
                    <div className="px-2 py-[4px] text-[9px] uppercase tracking-[0.18em] text-[#383838] border-b border-[#161616]">
                      Gradient Sort Order — {colorGradient}
                    </div>
                    <div className="flex h-8">
                      {gradientColors[colorGradient].map((c, i) => (
                        <div key={i} className="flex-1 flex items-center justify-center" style={{ background: c }}>
                          <span className="text-[7px] font-mono text-[#ffffff66]">{i+1}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-6 gap-2">
                  {Array.from({ length: 12 }, (_, i) => (
                    <VideoClip key={i} idx={i} active={i===activeClip} mode={shuffleMode}
                      showColorBars={shuffleMode==="color"}
                      matchScore={0.4 + sv(i*3+activeClip*0.7)*0.55}
                      onClick={()=>setActiveClip(i)}
                    />
                  ))}
                </div>
              </div>

              {/* Mode-specific controls */}
              <div className="grid grid-cols-2 gap-3">
                <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
                  <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[#404040]">
                    {shuffleMode==="motion"?"Motion Analysis":shuffleMode==="size"?"Size Reward":shuffleMode==="color"?"Color Matching":"Shuffle Options"}
                  </div>
                  {shuffleMode==="motion" && (<>
                    <ParamSlider label="Min Score" value={minScore} min={0} max={1} step={0.01} onChange={setMinScore} />
                    <ParamSlider label="Lookahead" value={lookahead} min={1} max={5} step={1} onChange={setLookahead} />
                  </>)}
                  {shuffleMode==="size" && (
                    <ParamSlider label="Keep %" value={keepPct} min={10} max={100} step={5} unit="%" onChange={setKeepPct} />
                  )}
                  {shuffleMode==="color" && (
                    <div className="space-y-[4px] text-[10px]">
                      {[["Match threshold","0.62"],["Sort mode","Gradient"],["Direction","Forward"],["Transition","Smooth"]].map(([k,v])=>(
                        <div key={k} className="flex justify-between border-b border-[#141414] pb-1">
                          <span className="text-[#454545]">{k}</span>
                          <span className="font-mono text-[#e05c00]">{v}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {shuffleMode==="simple" && (
                    <div className="text-[11px] text-[#454545] mt-1">Random order with hex-based naming. No analysis required.</div>
                  )}
                </div>

                {/* Transition scores / color match details */}
                <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
                  <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-[#404040]">
                    {shuffleMode==="color" ? "Color Match Scores" : shuffleMode==="motion" ? "Motion Transition Scores" : "Clip Scores"}
                  </div>
                  <div className="space-y-[4px]">
                    {Array.from({ length: 6 }, (_, i) => {
                      const score = 0.4 + sv(i * 3 + activeClip) * 0.55;
                      const good = score > minScore;
                      const startPalette = getClipPalette(i);
                      const endPalette = getClipPalette(i+1);
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <span className="w-14 text-[9px] font-mono text-[#383838]">C{i+1}→C{i+2}</span>
                          {shuffleMode==="color" && (
                            <>
                              <div className="flex gap-px">
                                {startPalette.slice(0,2).map((c,j)=>(
                                  <div key={j} className="w-3 h-3 rounded-[1px]" style={{background:c}} />
                                ))}
                              </div>
                              <div className="flex-1 h-[3px] bg-[#141414] rounded-full">
                                <div className="h-full rounded-full" style={{ width:`${score*100}%`, background: good?"#e05c00":"#252525" }} />
                              </div>
                              <div className="flex gap-px">
                                {endPalette.slice(0,2).map((c,j)=>(
                                  <div key={j} className="w-3 h-3 rounded-[1px]" style={{background:c}} />
                                ))}
                              </div>
                            </>
                          )}
                          {shuffleMode!=="color" && (
                            <div className="flex-1 h-[3px] bg-[#141414] rounded-full">
                              <div className="h-full rounded-full" style={{ width:`${score*100}%`, background: good?"#e05c00":"#252525" }} />
                            </div>
                          )}
                          <span className={`w-8 text-right text-[9px] font-mono ${good?"text-[#e05c00]":"text-[#2e2e2e]"}`}>{score.toFixed(2)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>)}

            {/* ──────────────────────────── JOIN ────────────────────────────── */}
            {tab === "join" && (<>
              {/* Output timeline waveform */}
              <SolidWaveform points={WAVE_MAIN} playhead={playhead} bpm={bpm} totalBars={8} beatsPerBar={4}
                label="OUTPUT TIMELINE — CONCATENATED" height={100} />

              {/* Proportional clip timeline */}
              <div className="border border-[#1a1a1a] rounded-[2px] bg-[#080808] overflow-hidden">
                <div className="flex items-center gap-3 px-3 py-2 border-b border-[#181818] text-[10px]">
                  <span className="uppercase tracking-[0.18em] text-[#404040]">Clip Queue</span>
                  <span className="font-mono text-[#555]">
                    {joinClips.filter(c=>c.on).length} clips · <span className="text-[#e05c00]">
                      {fmt(joinClips.filter(c=>c.on).reduce((a,c)=>a+sv(c.id+1)*8+1,0))}
                    </span>
                  </span>
                </div>
                <div className="relative h-12 flex">
                  {joinClips.filter(c=>c.on).map((c,i)=>{
                    const w = sv(c.id+1)*8+1;
                    const total = joinClips.filter(cc=>cc.on).reduce((a,cc)=>a+sv(cc.id+1)*8+1,0);
                    return (
                      <div key={c.id}
                        className={`relative border-r border-[#0a0a0a] cursor-pointer ${c.id===activeClip?"bg-[#e05c0020]":i%2===0?"bg-[#0e0e0e]":"bg-[#0b0b0b]"}`}
                        style={{ width:`${(w/total)*100}%` }}
                        onClick={()=>setActiveClip(c.id)}
                      >
                        {c.id===activeClip && <div className="absolute top-0 left-0 right-0 h-[2px] bg-[#e05c00]" />}
                        <span className="absolute left-[2px] top-[3px] text-[7px] font-mono text-[#444]">C{c.id+1}</span>
                      </div>
                    );
                  })}
                  <div className="absolute inset-y-0 w-[1px] bg-[#e05c00]" style={{ left:`${playhead*100}%` }} />
                </div>
              </div>

              {/* Visual clip grid */}
              <div>
                <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[#404040]">Clip Queue — click to toggle on/off</div>
                <div className="grid grid-cols-6 gap-2">
                  {joinClips.map((c)=>(
                    <div key={c.id} className="relative" onClick={()=>{
                      setJoinClips(prev=>prev.map(cc=>cc.id===c.id?{...cc,on:!cc.on}:cc));
                      setActiveClip(c.id);
                    }}>
                      <VideoClip idx={c.id} active={c.id===activeClip} mode="simple" />
                      {!c.on && (
                        <div className="absolute inset-0 bg-[#00000099] flex items-center justify-center rounded-[2px]">
                          <span className="text-[9px] font-mono text-[#383838]">SKIP</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>)}

            {/* ──────────────────────────── BEAT JOIN ───────────────────────── */}
            {tab === "beatjoin" && (<>
              {/* Main audio waveform as master timeline */}
              <SolidWaveform points={WAVE_AUDIO} playhead={playhead} bpm={bpm} totalBars={8} beatsPerBar={4}
                accent="#c8900a" label="AUDIO TRACK · TRACK_01.WAV — MASTER TIMELINE" height={110} />

              {/* Energy reactive arrangement */}
              <div className="border border-[#1a1a1a] rounded-[2px] bg-[#080808] overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-[#181818]">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-[#404040]">
                    Arrangement · Energy Reactive
                  </span>
                  <button onClick={()=>setEnergyReactive(!energyReactive)}
                    className={`text-[10px] uppercase tracking-[0.12em] px-2 py-[2px] border rounded-[2px] ${energyReactive?"border-[#e05c00] text-[#e05c00] bg-[#e05c0012]":"border-[#1e1e1e] text-[#484848]"}`}>
                    {energyReactive?"ON":"OFF"}
                  </button>
                </div>

                {/* Energy bar row — directly under waveform, visually connected */}
                <div className="flex h-10 border-b border-[#161616] items-end gap-px px-1 pt-1 bg-[#060606]">
                  {Array.from({ length: 32 }, (_, i) => {
                    // energy derived from the audio waveform sample points
                    const waveIdx = Math.floor((i/32)*WAVE_AUDIO.length);
                    const e = WAVE_AUDIO[waveIdx] ?? sv(i*3+1);
                    const isHigh = e > 0.6;
                    return (
                      <div key={i} className="flex-1 rounded-t-[1px]"
                        style={{ height:`${e*100}%`, background: isHigh?"#e05c00":energyReactive?"#2e2e2e":"#1e1e1e" }} />
                    );
                  })}
                </div>

                {/* Clip arrangement driven by energy */}
                <div className="relative h-14 flex items-stretch px-1 gap-px py-1 bg-[#090909]">
                  {Array.from({ length: 24 }, (_, i) => {
                    const waveIdx = Math.floor((i/24)*WAVE_AUDIO.length);
                    const e = WAVE_AUDIO[waveIdx] ?? sv(i*3+1);
                    const dur = energyReactive ? minDur+(1-e)*(maxDur-minDur) : (minDur+maxDur)/2;
                    const totalDur = 24*((minDur+maxDur)/2);
                    const widthPct = (dur/totalDur)*100;
                    // color intensity tied to energy
                    const lightness = energyReactive ? 8 + e*20 : 14;
                    return (
                      <div key={i}
                        className={`relative border border-[#161616] cursor-pointer rounded-[1px] ${i===activeClip?"border-[#e05c00]":""}`}
                        style={{ width:`${widthPct}%`, background:`hsl(25 70% ${lightness}%)`, minWidth:2 }}
                        onClick={()=>setActiveClip(i)}
                      >
                        <span className="absolute bottom-[1px] left-[1px] text-[6px] font-mono text-[#ffffff33]">{dur.toFixed(2)}</span>
                      </div>
                    );
                  })}
                  <div className="absolute inset-y-0 w-[1px] bg-[#e05c00]" style={{ left:`${playhead*100}%` }} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
                  <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[#404040]">Duration Control</div>
                  <ParamSlider label="Min Duration" value={minDur} min={0.05} max={1} step={0.01} unit="s" onChange={setMinDur} />
                  <ParamSlider label="Max Duration" value={maxDur} min={0.1} max={3} step={0.05} unit="s" onChange={setMaxDur} />
                  <ParamSlider label="Energy Response" value={energyResp} min={0.5} max={3} step={0.1} onChange={setEnergyResp} />
                </div>
                <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
                  <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[#404040]">Variation</div>
                  <ParamSlider label="Chaos" value={chaos} min={0} max={1} step={0.01} onChange={setChaos} />
                  <ParamSlider label="Onset Boost" value={onsetBoost} min={0} max={1} step={0.01} onChange={setOnsetBoost} />
                </div>
              </div>
            </>)}

            {/* ──────────────────────────── SPEED RAMP ─────────────────────── */}
            {tab === "ramp" && (<>
              {/* Main waveform timeline */}
              <SolidWaveform points={WAVE_MAIN} playhead={playhead} bpm={bpm} totalBars={8} beatsPerBar={4}
                label="SOURCE VIDEO · CLIP_001.MP4" height={100} />

              {/* Speed curve */}
              <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c]">
                <div className="flex items-center justify-between px-3 py-2 border-b border-[#181818]">
                  <span className="text-[10px] uppercase tracking-[0.2em] text-[#404040]">Speed Envelope — drag nodes</span>
                  <span className="text-[10px] font-mono text-[#e05c00] uppercase">{rampPreset}</span>
                </div>
                <div className="p-2">
                  <SpeedCurve minSpeed={minSpeed} maxSpeed={maxSpeed} preset={rampPreset} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
                  <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[#404040]">Parameters</div>
                  <ParamSlider label="Min Speed" value={minSpeed} min={0.1} max={1} step={0.05} unit="×" onChange={setMinSpeed} />
                  <ParamSlider label="Max Speed" value={maxSpeed} min={1} max={8} step={0.1} unit="×" onChange={setMaxSpeed} />
                  <ParamSlider label="Ramp Duration" value={rampDur} min={0.1} max={2} step={0.05} unit="s" onChange={setRampDur} />
                  <ParamSlider label="Energy Thresh" value={energyThresh} min={0} max={1} step={0.01} onChange={setEnergyThresh} />
                  <ParamSlider label="Buildup Boost" value={buildBoost} min={1} max={3} step={0.05} unit="×" onChange={setBuildBoost} />
                  <ParamSlider label="Drop Slowdown" value={dropSlowdown} min={0.1} max={1} step={0.05} unit="×" onChange={setDropSlowdown} />
                </div>
                <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
                  <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[#404040]">Preset</div>
                  {(["subtle","dynamic","extreme","cinematic"] as RampPreset[]).map((p)=>{
                    const meta = {subtle:["0.8–1.2×","Professional, minor"],dynamic:["0.5–2.0×","Music video style"],extreme:["0.25–4×","Action / maximum"],cinematic:["0.5–1.5×","Smooth, emotional"]}[p];
                    return (
                      <button key={p} onClick={()=>setRampPreset(p)}
                        className={`flex w-full items-center justify-between px-2 py-[7px] mb-1 border rounded-[2px] text-left transition-colors ${rampPreset===p?"border-[#e05c00] bg-[#e05c0012]":"border-[#1a1a1a] bg-[#090909] hover:border-[#272727]"}`}>
                        <div>
                          <div className={`text-[12px] capitalize font-medium ${rampPreset===p?"text-[#e05c00]":"text-[#777]"}`}>{p}</div>
                          <div className="text-[10px] text-[#404040]">{meta[1]}</div>
                        </div>
                        <span className="font-mono text-[10px] text-[#484848]">{meta[0]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>)}

            {/* ── Action / progress ─────────────────────────────────────────── */}
            <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
              {done ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[#3a8a3a]" />
                    <span className="text-[12px] text-[#3a8a3a]">Complete — /output/processed/</span>
                  </div>
                  <button onClick={()=>setDone(false)} className="text-[10px] text-[#404040] hover:text-[#888]">RESET</button>
                </div>
              ) : isRunning ? (
                <div>
                  <div className="flex justify-between text-[11px] mb-2">
                    <span className="text-[#484848] uppercase tracking-[0.14em]">Processing…</span>
                    <span className="font-mono text-[#e05c00]">{Math.floor(progress)}%</span>
                  </div>
                  <div className="h-[3px] bg-[#1a1a1a] rounded-full">
                    <div className="h-full bg-[#e05c00] rounded-full transition-all duration-200" style={{ width:`${progress}%` }} />
                  </div>
                </div>
              ) : (
                <button onClick={runProcess}
                  className="w-full py-[10px] bg-[#e05c00] text-[#fff] text-[12px] font-semibold uppercase tracking-[0.22em] rounded-[2px] hover:bg-[#c95200] active:bg-[#b34800] transition-colors">
                  {tab==="split"?"Initialize Segments":tab==="beatsplit"?"Detect & Split Beats":tab==="shuffle"?"Execute Shuffle":tab==="join"?"Concatenate Clips":tab==="beatjoin"?"Render Beat Join":"Render Speed Ramp"}
                </button>
              )}
            </div>

          </main>

          {/* ── Right Panel ─────────────────────────────────────────────────── */}
          <aside className="w-52 shrink-0 border-l border-[#181818] bg-[#0c0c0c] flex flex-col overflow-y-auto">
            {/* Live readout */}
            <div className="border-b border-[#181818] p-3">
              <div className="mb-2 text-[9px] uppercase tracking-[0.22em] text-[#343434]">Live Readout</div>
              <div className="space-y-[5px]">
                {readout.map(([k,v])=>(
                  <div key={String(k)} className="flex justify-between items-center">
                    <span className="text-[10px] text-[#434343]">{k}</span>
                    <span className="font-mono text-[11px] text-[#e05c00]">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Output pipeline */}
            <div className="border-b border-[#181818] p-3">
              <div className="mb-2 text-[9px] uppercase tracking-[0.22em] text-[#343434]">Output Pipeline</div>
              <div className="border border-[#181818] bg-[#080808] rounded-[2px] px-2 py-[5px] font-mono text-[10px] text-[#484848] mb-2">
                /output/processed_v1/
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[["QUEUE","00:00"],["CORES","16384"]].map(([k,v])=>(
                  <div key={k} className="border border-[#181818] bg-[#090909] rounded-[2px] p-2">
                    <div className="text-[9px] text-[#303030] mb-[2px]">{k}</div>
                    <div className={`font-mono text-[12px] ${k==="CORES"?"text-[#e05c00]":"text-[#777]"}`}>{v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Terminal */}
            <div className="border-b border-[#181818] p-3 flex-1">
              <div className="mb-2 text-[9px] uppercase tracking-[0.22em] text-[#343434]">Terminal</div>
              <div className="space-y-[4px]">
                {LOG.map((l,i)=>(
                  <div key={i} className="font-mono text-[9px] leading-tight">
                    <span className="text-[#e05c0099]">[{l.tag}]</span>{" "}
                    <span style={{ color: l.col }}>{l.msg}</span>
                  </div>
                ))}
                <div className="font-mono text-[9px] text-[#2e2e2e] mt-1 animate-pulse">&gt; WAITING_FOR_OPERATOR_INPUT_</div>
              </div>
            </div>

            {/* Tip */}
            <div className="p-3">
              <div className="mb-1 text-[9px] uppercase tracking-[0.22em] text-[#343434]">Tip</div>
              <p className="text-[10px] leading-relaxed text-[#383838]">
                {tab==="shuffle"&&shuffleMode==="motion" ? <><span className="text-[#e05c00]">Lookahead 4–5</span> yields best motion continuity. Use Precise analysis for final render.</>
                : tab==="shuffle"&&shuffleMode==="color" ? <><span className="text-[#e05c00]">Sunset</span> gradient works best on warm-toned footage. Match end/start palette for seamless cuts.</>
                : tab==="ramp" ? <>Use <span className="text-[#e05c00]">Dynamic</span> with drop slowdown &lt;0.5 for cinematic music video pacing.</>
                : tab==="beatjoin" ? <>Set <span className="text-[#e05c00]">Onset Boost</span> above 0.6 for punchy drum-reactive cuts on EDM.</>
                : <>Enable <span className="text-[#e05c00]">CUDA SM_120</span> for 4× faster encode than CPU on RTX 5090.</>}
              </p>
            </div>
          </aside>
        </div>

        {/* ── Status Bar ───────────────────────────────────────────────────── */}
        <footer className="flex items-center justify-between border-t border-[#181818] bg-[#0b0b0b] px-4 py-[5px] shrink-0">
          <div className="flex items-center gap-3">
            <span className="h-[5px] w-[5px] rounded-full bg-[#3a8a3a]" />
            <span className="text-[10px] uppercase tracking-[0.18em] text-[#3a8a3a]">Ready</span>
            <span className="text-[#1e1e1e]">·</span>
            <span className="font-mono text-[10px] text-[#343434]">RTX 5090 · {gpu.toFixed(0)}% · 42°C</span>
          </div>
          <div className="flex items-center gap-4 font-mono text-[10px] text-[#343434]">
            <span>FFmpeg 7.1 · CUDA 12.8</span>
            <span>·</span>
            <span>{new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
