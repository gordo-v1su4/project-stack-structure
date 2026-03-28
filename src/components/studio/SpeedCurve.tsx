"use client";

import { useMemo, useRef, useState } from "react";
import { lerp } from "./math";
import type { RampPreset } from "./types";

type SpeedCurveProps = {
  minSpeed: number;
  maxSpeed: number;
  preset: RampPreset;
};

export function SpeedCurve({ minSpeed, maxSpeed, preset }: SpeedCurveProps) {
  const W = 800;
  const H = 200;
  const PAD = { t: 16, b: 28, l: 40, r: 12 };
  const chartW = W - PAD.l - PAD.r;
  const chartH = H - PAD.t - PAD.b;

  const basePoints = useMemo(() => {
    const shapes: Record<RampPreset, number[]> = {
      subtle: [0.5, 0.55, 0.52, 0.6, 0.58, 0.65, 0.6, 0.55, 0.5],
      dynamic: [0.3, 0.4, 0.55, 0.8, 1.0, 0.85, 0.7, 0.5, 0.35],
      extreme: [0.25, 0.5, 0.9, 1.0, 0.75, 1.0, 0.6, 0.9, 0.25],
      cinematic: [0.4, 0.45, 0.5, 0.6, 0.7, 0.75, 0.65, 0.55, 0.45],
    };
    return shapes[preset];
  }, [preset]);

  const [nodes, setNodes] = useState(() =>
    basePoints.map((v, i) => ({ x: i / (basePoints.length - 1), y: v }))
  );

  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<number | null>(null);
  const toScreen = (nx: number, ny: number) => ({ sx: PAD.l + nx * chartW, sy: PAD.t + (1 - ny) * chartH });
  function toNorm(sx: number, sy: number) {
    return {
      nx: Math.max(0, Math.min(1, (sx - PAD.l) / chartW)),
      ny: Math.max(0, Math.min(1, 1 - (sy - PAD.t) / chartH)),
    };
  }

  function catmullPath() {
    if (nodes.length < 2) return "";
    const pts = nodes.map((n) => toScreen(n.x, n.y));
    let d = `M ${pts[0].sx} ${pts[0].sy}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)],
        p1 = pts[i],
        p2 = pts[i + 1],
        p3 = pts[Math.min(pts.length - 1, i + 2)];
      const cp1x = p1.sx + (p2.sx - p0.sx) / 6,
        cp1y = p1.sy + (p2.sy - p0.sy) / 6;
      const cp2x = p2.sx - (p3.sx - p1.sx) / 6,
        cp2y = p2.sy - (p3.sy - p1.sy) / 6;
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
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full rounded-[2px] border border-[#1a1a1a] bg-[#070707] cursor-crosshair"
      style={{ height: 160 }}
      onMouseMove={(e) => {
        if (dragging.current === null || !svgRef.current) return;
        const r = svgRef.current.getBoundingClientRect();
        const { ny } = toNorm(
          ((e.clientX - r.left) / r.width) * W,
          ((e.clientY - r.top) / r.height) * H
        );
        setNodes((prev) => prev.map((n, i) => (i === dragging.current ? { ...n, y: ny } : n)));
      }}
      onMouseUp={() => {
        dragging.current = null;
      }}
      onMouseLeave={() => {
        dragging.current = null;
      }}
    >
      <defs>
        <linearGradient id="cf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.18" />
          <stop offset="100%" stopColor={accent} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <line
          key={t}
          x1={PAD.l}
          y1={PAD.t + t * chartH}
          x2={W - PAD.r}
          y2={PAD.t + t * chartH}
          stroke="#181818"
          strokeWidth={1}
        />
      ))}
      {Array.from({ length: 9 }, (_, i) => (
        <line
          key={i}
          x1={PAD.l + (i / 8) * chartW}
          y1={PAD.t}
          x2={PAD.l + (i / 8) * chartW}
          y2={PAD.t + chartH}
          stroke="#131313"
          strokeWidth={1}
        />
      ))}
      {(() => {
        const oneY = PAD.t + (1 - (1 - minSpeed) / (maxSpeed - minSpeed)) * chartH;
        return (
          <line
            x1={PAD.l}
            y1={oneY}
            x2={W - PAD.r}
            y2={oneY}
            stroke={`${accent}44`}
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        );
      })()}
      <path d={fillPath()} fill="url(#cf)" />
      <path d={catmullPath()} fill="none" stroke={accent} strokeWidth={2.5} />
      {nodes.map((n, i) => {
        const { sx, sy } = toScreen(n.x, n.y);
        return (
          <g key={i}>
            <circle
              cx={sx}
              cy={sy}
              r={10}
              fill="transparent"
              className="cursor-grab"
              onMouseDown={(e) => {
                e.preventDefault();
                dragging.current = i;
              }}
            />
            <circle
              cx={sx}
              cy={sy}
              r={4}
              fill="#111"
              stroke={accent}
              strokeWidth={1.5}
              className="cursor-grab"
              onMouseDown={(e) => {
                e.preventDefault();
                dragging.current = i;
              }}
            />
          </g>
        );
      })}
      {yLabels.map((v, i) => (
        <text
          key={i}
          x={PAD.l - 5}
          y={PAD.t + (i / (yLabels.length - 1)) * chartH + 4}
          textAnchor="end"
          fontSize={9}
          fill="#444"
          fontFamily="monospace"
        >
          {v.toFixed(1)}×
        </text>
      ))}
      {["1-1", "2-1", "3-1", "4-1", "5-1", "6-1", "7-1", "8-1", "END"].map((t, i) => (
        <text
          key={i}
          x={PAD.l + (i / 8) * chartW}
          y={H - 8}
          textAnchor="middle"
          fontSize={8}
          fill="#383838"
          fontFamily="monospace"
        >
          {t}
        </text>
      ))}
    </svg>
  );
}
