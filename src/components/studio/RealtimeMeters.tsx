"use client";

import { useEffect, useRef } from "react";

const METER_EVENT_NAME = "svs-audio-meter";
const BIN_COUNT = 10;

export function RealtimeMeters() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const levelsRef = useRef<number[]>(Array.from({ length: BIN_COUNT }, () => 0));
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasElement = canvas;

    const context = canvasElement.getContext("2d");
    if (!context) return;
    const ctx = context;

    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = canvasElement.clientWidth || 184;
      const height = canvasElement.clientHeight || 104;
      canvasElement.width = Math.floor(width * dpr);
      canvasElement.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw() {
      const width = canvasElement.clientWidth || 184;
      const height = canvasElement.clientHeight || 104;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#090909";
      ctx.fillRect(0, 0, width, height);

      const inset = 10;
      const meterWidth = (width - inset * 2) / BIN_COUNT;
      const meterGap = 6;
      const usableWidth = meterWidth - meterGap;
      const segmentCount = 10;
      const segmentGap = 3;
      const segmentHeight = (height - inset * 2 - segmentGap * (segmentCount - 1)) / segmentCount;

      levelsRef.current = levelsRef.current.map((level) => Math.max(0, level * 0.92 - 0.01));

      for (let binIndex = 0; binIndex < BIN_COUNT; binIndex += 1) {
        const level = levelsRef.current[binIndex] ?? 0;
        const x = inset + binIndex * meterWidth;
        const activeSegments = Math.round(level * segmentCount);

        for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
          const y = height - inset - (segmentIndex + 1) * segmentHeight - segmentIndex * segmentGap;
          const isActive = segmentIndex < activeSegments;
          ctx.fillStyle = isActive
            ? segmentIndex >= 7
              ? "#7dff9c"
              : segmentIndex >= 4
                ? "#41f07b"
                : "#d8fbe1"
            : "#262626";
          ctx.fillRect(x, y, usableWidth, segmentHeight);
        }
      }

      frameRef.current = window.requestAnimationFrame(draw);
    }

    function handleMeter(event: Event) {
      const customEvent = event as CustomEvent<{ bins?: number[] }>;
      const bins = Array.isArray(customEvent.detail?.bins) ? customEvent.detail.bins : [];
      levelsRef.current = Array.from({ length: BIN_COUNT }, (_, index) => {
        const next = bins[index] ?? 0;
        return Math.max(next, levelsRef.current[index] ?? 0);
      });
    }

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener(METER_EVENT_NAME, handleMeter as EventListener);
    frameRef.current = window.requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener(METER_EVENT_NAME, handleMeter as EventListener);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  return (
    <div className="border-b border-[#181818] p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[9px] uppercase tracking-[0.22em] text-[#343434]">Live Meters</div>
        <div className="font-mono text-[9px] text-[#3f3f3f]">31 62 125 250 500 1k 2k 4k 8k 16k</div>
      </div>
      <div className="border border-[#181818] bg-[#080808] rounded-[2px] px-2 py-2">
        <canvas ref={canvasRef} className="block h-[104px] w-full" />
      </div>
    </div>
  );
}

export const AUDIO_METER_EVENT = METER_EVENT_NAME;
