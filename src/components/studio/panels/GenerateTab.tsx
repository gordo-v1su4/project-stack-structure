"use client";

import { useMemo, useState } from "react";
import { fmt } from "../math";
import { buildGenerationReferenceInputs, type GenerationReferenceSelection, type ReferenceAsset } from "../referenceAssets";
import type { BeatJoinAnalysis, ColorPaletteSwatch, MotionDescriptor } from "../types";
import { buildAdaptiveCueMap } from "../adaptiveCueMap";
import type { MusicVideoProject, TimelineItem, VideoMoment } from "../musicVideoProject";

type GenerateTabProps = {
  project: MusicVideoProject | null;
  analysis: BeatJoinAnalysis | null;
  storyGenerated: boolean;
  onSelectMatch: () => void;
  onSelectJoin: () => void;
  onsetDensity: number;
  lyricCueBlend: number;
  lyricMergeWindow: number;
  referenceAssets: ReferenceAsset[];
};

type SlotStatus = "filled" | "weak" | "short" | "missing";
type GenerationNeed = "b-roll" | "alt-angle" | "extend-start" | "extend-end" | "bridge" | "reroll-match";
type TimelineZoomMode = "fit" | "section" | "selected";

type CoverageSlot = {
  item: TimelineItem;
  moment?: VideoMoment;
  requiredDuration: number;
  usableDuration: number;
  missingDuration: number;
  score: number;
  status: SlotStatus;
  needs: GenerationNeed[];
};

const STATUS_LABELS: Record<SlotStatus, string> = {
  filled: "filled",
  weak: "weak match",
  short: "needs extension",
  missing: "missing",
};

const STATUS_STYLES: Record<SlotStatus, { border: string; bg: string; text: string; fill: string }> = {
  filled: { border: "border-[#245c2c]", bg: "bg-[#071107]", text: "text-[#78c878]", fill: "#255f34" },
  weak: { border: "border-[#695019]", bg: "bg-[#120e04]", text: "text-[#d3a236]", fill: "#b38422" },
  short: { border: "border-[#5b356f]", bg: "bg-[#100817]", text: "text-[#c37bea]", fill: "#7a3aa0" },
  missing: { border: "border-[#743029]", bg: "bg-[#120706]", text: "text-[#dc6257]", fill: "#8e332a" },
};

const NEED_LABELS: Record<GenerationNeed, string> = {
  "b-roll": "Generate B-roll",
  "alt-angle": "Generate Alt Angle / Camera B",
  "extend-start": "Extend From First Frame",
  "extend-end": "Extend From Last Frame",
  bridge: "Bridge A→B",
  "reroll-match": "Reroll Match",
};

export function GenerateTab({ project, analysis, storyGenerated, onSelectMatch, onSelectJoin, onsetDensity, lyricCueBlend, lyricMergeWindow, referenceAssets }: GenerateTabProps) {
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [timelineZoomMode, setTimelineZoomMode] = useState<TimelineZoomMode>("fit");
  const [referenceSelection, setReferenceSelection] = useState<GenerationReferenceSelection>({});
  const cueMap = useMemo(() => buildAdaptiveCueMap({
    analysis,
    project,
    density: onsetDensity / 100,
    lyricBlend: lyricCueBlend / 100,
    lyricMergeWindowSeconds: lyricMergeWindow,
  }), [analysis, lyricCueBlend, lyricMergeWindow, onsetDensity, project]);
  const slots = useMemo(() => buildCoverageSlots(project, cueMap.chunks), [cueMap.chunks, project]);
  const coverage = useMemo(() => summarizeCoverage(slots, cueMap.duration), [cueMap.duration, slots]);
  const focusSlot = slots.find((slot) => slot.item.id === selectedSlotId) ?? slots.find((slot) => slot.status !== "filled") ?? slots[0];
  const frameMoment = focusSlot?.moment ?? project?.videoMoments.find((moment) => moment.firstFrameUrl || moment.thumbnailUrl);
  const effectiveReferenceSelection = useMemo(() => fillDefaultReferenceSelection(referenceSelection, referenceAssets), [referenceAssets, referenceSelection]);
  const hasRequiredInputs = storyGenerated && Boolean(project?.editPlan.timelineItems.length);
  const missingSlots = slots.filter((slot) => slot.status === "missing");
  const weakSlots = slots.filter((slot) => slot.status === "weak");
  const shortSlots = slots.filter((slot) => slot.status === "short");


  return (
    <div className="space-y-3">
      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Generate missing footage / extensions</div>
            <div className="mt-1 max-w-5xl text-[11px] leading-5 text-[#6d6d6d]">
              This page sits between Match and Join. Match exposes holes and weak candidates; Generate turns selected source frames into new B-roll, alt angles, bridges, or clip extensions; Join only assembles approved real/generated shots.
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onSelectMatch} className="rounded-[2px] border border-[#242424] px-3 py-2 text-[9px] uppercase tracking-[0.14em] text-[#9a9a9a] hover:border-[#e05c00] hover:text-[#e05c00]">Back to Match</button>
            <button type="button" onClick={onSelectJoin} className="rounded-[2px] border border-[#242424] px-3 py-2 text-[9px] uppercase tracking-[0.14em] text-[#9a9a9a] hover:border-[#e05c00] hover:text-[#e05c00]">Join Approved</button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-5">
          <MetricCard label="Required" value={coverage.requiredDuration > 0 ? fmt(coverage.requiredDuration) : "Waiting"} ready={coverage.requiredDuration > 0} />
          <MetricCard label="Matched usable" value={fmt(coverage.usableDuration)} ready={coverage.usableDuration > 0} />
          <MetricCard label="Missing" value={fmt(coverage.missingDuration)} ready={coverage.missingDuration === 0 && coverage.requiredDuration > 0} alert={coverage.missingDuration > 0} />
          <MetricCard label="Coverage" value={`${coverage.coveragePct}%`} ready={coverage.coveragePct >= 92} alert={coverage.coveragePct < 70 && coverage.requiredDuration > 0} />
          <MetricCard label="Generate queue" value={`${missingSlots.length + weakSlots.length + shortSlots.length} needs`} ready={missingSlots.length + weakSlots.length + shortSlots.length === 0 && slots.length > 0} alert={missingSlots.length > 0} />
        </div>
      </section>

      {!hasRequiredInputs ? (
        <section className="rounded-[2px] border border-dashed border-[#252525] bg-[#080808] p-6 text-center">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#d24b3f]">Generate is locked</div>
          <div className="mx-auto mt-3 max-w-3xl text-[11px] leading-5 text-[#777]">
            Generate needs Story edit slots and Match assignments first. It will not invent fallback shots here; missing inputs stay visible as errors/locked states until the upstream pages return real data.
          </div>
        </section>
      ) : null}

      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Coverage timeline + generation lanes</div>
            <div className="mt-1 text-[11px] text-[#6d6d6d]">Blocks are song-length aligned. Red gaps become generate tasks; purple gaps become source-frame extensions; yellow blocks need match approval or reroll.</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-[2px] border border-[#202020] bg-[#070707] p-1">
              {(["fit", "section", "selected"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setTimelineZoomMode(mode)}
                  className={`px-2 py-1 text-[8px] uppercase tracking-[0.12em] ${timelineZoomMode === mode ? "bg-[#e05c00] text-white" : "text-[#666] hover:text-[#d0d0d0]"}`}
                >
                  {mode === "fit" ? "Fit song" : mode === "section" ? "Section zoom" : "Chunk zoom"}
                </button>
              ))}
            </div>
            <div className="font-mono text-[10px] text-[#777]">{slots.length} adaptive chunks · {cueMap.activeCount} active cues · {analysis?.sourceLabel ?? "no song"}</div>
          </div>
        </div>
        <CoverageTimeline slots={slots} duration={coverage.duration} selectedSlotId={focusSlot?.item.id ?? null} zoomMode={timelineZoomMode} onSelectSlot={setSelectedSlotId} />
      </section>

      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Adaptive clip queue</div>
            <div className="mt-1 text-[11px] text-[#6d6d6d]">This brings back the dense thumbnail layout: every card is one Match chunk, scaled from the same adaptive cue map. Click a card to load its frames and generation prompt below.</div>
          </div>
          <div className="font-mono text-[10px] text-[#777]">selected {focusSlot?.item.label ?? "none"}</div>
        </div>
        <AdaptiveClipQueue slots={slots} selectedSlotId={focusSlot?.item.id ?? null} onSelectSlot={setSelectedSlotId} />
      </section>

      <div className="grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Missing shot board</div>
              <div className="mt-1 text-[11px] text-[#6d6d6d]">Each row explains why a slot cannot go straight to Join and which generation action would fill it.</div>
            </div>
            <div className="font-mono text-[10px] text-[#777]">{coverage.blockerCount} blockers</div>
          </div>
          {slots.length ? (
            <div className="space-y-2">
              {slots.map((slot) => <ShotNeedCard key={slot.item.id} slot={slot} selected={slot.item.id === focusSlot?.item.id} onSelect={() => setSelectedSlotId(slot.item.id)} />)}
            </div>
          ) : (
            <EmptyState label="No edit slots" detail="Generate Story and run Match to populate this board." />
          )}
        </section>

        <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3 xl:sticky xl:top-3 xl:max-h-[calc(100vh-190px)] xl:self-start xl:overflow-y-auto">
          <div className="mb-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Source-frame extension lab</div>
            <div className="mt-1 text-[11px] text-[#6d6d6d]">Start/middle/end frames are retained so generation can extend an intro/outro, bridge between clips, or create a related Camera B angle.</div>
          </div>
          <FrameExtensionPanel
            slot={focusSlot}
            moment={frameMoment}
            referenceAssets={referenceAssets}
            referenceSelection={effectiveReferenceSelection}
            onReferenceSelection={setReferenceSelection}
          />
        </section>
      </div>

      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Generated shot bank / approval queue</div>
            <div className="mt-1 text-[11px] text-[#6d6d6d]">This is the UI shell for the upcoming image/video endpoints. Nothing is faked: generated assets stay pending until a real endpoint returns frames, clips, storage paths, and captions.</div>
          </div>
          <span className="rounded-[2px] border border-[#6e3425] bg-[#160905] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[#d26c42]">API not connected yet</span>
        </div>
        <GeneratedShotBank slots={slots} />
      </section>

      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Track lanes for live intercut target</div>
          <div className="mt-1 text-[11px] text-[#6d6d6d]">Long-term target: Track A real matched footage, Track B generated B-roll/alt angles, Track C extensions/bridges, Track D GLSL/effects. These lanes show where clips would shift when shuffle/match modes change.</div>
        </div>
        <TrackLaneBoard slots={slots} duration={coverage.duration} />
      </section>
    </div>
  );
}

function buildCoverageSlots(project: MusicVideoProject | null, chunks: Array<{ id: string; sectionId: string; sectionLabel: string; start: number; end: number; strength: number; cueCount: number }>): CoverageSlot[] {
  if (!project) return [];
  const momentsById = new Map(project.videoMoments.map((moment) => [moment.id, moment]));
  const itemsBySection = new Map(project.editPlan.timelineItems.map((item) => [item.sectionId, item]));
  const sourceItems = chunks.length
    ? chunks.map((chunk, index) => {
        const base = itemsBySection.get(chunk.sectionId) ?? project.editPlan.timelineItems.find((item) => item.start <= chunk.start && item.end >= chunk.end) ?? project.editPlan.timelineItems[0];
        return {
          ...(base ?? { id: `chunk-${chunk.id}`, sectionId: chunk.sectionId, lyricChunkIds: [], videoMomentId: null, start: chunk.start, end: chunk.end, label: chunk.sectionLabel, prompt: "No story prompt is attached to this adaptive chunk." }),
          id: `chunk-${chunk.id}`,
          sectionId: chunk.sectionId,
          start: chunk.start,
          end: chunk.end,
          label: `${chunk.sectionLabel} · C${String(index + 1).padStart(2, "0")}`,
        } satisfies TimelineItem;
      })
    : project.editPlan.timelineItems;

  return sourceItems.map((item) => {
    const moment = item.videoMomentId ? momentsById.get(item.videoMomentId) : undefined;
    const requiredDuration = Math.max(0, item.end - item.start);
    const score = item.semanticMatch?.score ?? 0;
    const availableDuration = moment?.duration ?? 0;
    const trusted = Boolean(moment && score >= 0.45);
    const usableDuration = trusted ? Math.min(requiredDuration, availableDuration) : 0;
    const missingDuration = Math.max(0, requiredDuration - usableDuration);
    const status: SlotStatus = !moment ? "missing" : score < 0.45 ? "weak" : missingDuration > 0.5 ? "short" : "filled";
    const needs = deriveGenerationNeeds(status, requiredDuration, availableDuration);

    return { item, moment, requiredDuration, usableDuration, missingDuration, score, status, needs };
  });
}

function deriveGenerationNeeds(status: SlotStatus, requiredDuration: number, availableDuration: number): GenerationNeed[] {
  if (status === "missing") return ["b-roll", "alt-angle"];
  if (status === "weak") return ["reroll-match", "alt-angle"];
  if (status === "short") {
    const needs: GenerationNeed[] = ["extend-end"];
    if (requiredDuration - availableDuration > 4) needs.push("extend-start", "bridge");
    return needs;
  }
  if (requiredDuration > 8) return ["alt-angle"];
  return [];
}

function summarizeCoverage(slots: CoverageSlot[], cueDuration = 0) {
  const requiredDuration = slots.reduce((total, slot) => total + slot.requiredDuration, 0);
  const usableDuration = slots.reduce((total, slot) => total + slot.usableDuration, 0);
  const missingDuration = Math.max(0, requiredDuration - usableDuration);
  const coveragePct = requiredDuration > 0 ? Math.round((usableDuration / requiredDuration) * 100) : 0;
  const duration = Math.max(cueDuration, slots[slots.length - 1]?.item.end ?? 0, requiredDuration, 1);
  const blockerCount = slots.filter((slot) => slot.status !== "filled").length;
  return { requiredDuration, usableDuration, missingDuration, coveragePct, duration, blockerCount };
}

function MetricCard({ label, value, ready, alert = false }: { label: string; value: string; ready: boolean; alert?: boolean }) {
  return (
    <div className={`rounded-[2px] border px-3 py-2 ${ready ? "border-[#245c2c] bg-[#081108]" : alert ? "border-[#743029] bg-[#120706]" : "border-[#252525] bg-[#080808]"}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[8px] uppercase tracking-[0.16em] text-[#5c5c5c]">{label}</span>
        <span className={`h-2 w-2 rounded-full ${ready ? "bg-[#3a8a3a]" : alert ? "bg-[#d24b3f]" : "bg-[#454545]"}`} />
      </div>
      <div className={`font-mono text-[10px] ${ready ? "text-[#79c779]" : alert ? "text-[#d24b3f]" : "text-[#777]"}`}>{value}</div>
    </div>
  );
}

function CoverageTimeline({
  slots,
  duration,
  selectedSlotId,
  zoomMode,
  onSelectSlot,
}: {
  slots: CoverageSlot[];
  duration: number;
  selectedSlotId: string | null;
  zoomMode: TimelineZoomMode;
  onSelectSlot: (id: string) => void;
}) {
  if (!slots.length) return <EmptyState label="No timeline" detail="Story and Match slots will appear here." />;
  const selectedSlot = slots.find((slot) => slot.item.id === selectedSlotId) ?? slots[0];
  const view = getCoverageTimelineView({ slots, duration, selectedSlot, zoomMode });
  const viewDuration = Math.max(0.001, view.end - view.start);
  const visibleSlots = slots.filter((slot) => slot.item.end > view.start && slot.item.start < view.end);

  return (
    <div className="rounded-[2px] border border-[#151515] bg-[#060606] p-2">
      <div className="mb-2 flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.12em] text-[#555]">
        <span>{view.label}</span>
        <span>{visibleSlots.length}/{slots.length} chunks visible</span>
      </div>
      <div className="relative h-32 overflow-hidden border border-[#101010] bg-[#040404]">
        {visibleSlots.map((slot) => {
          const clippedStart = Math.max(view.start, slot.item.start);
          const clippedEnd = Math.min(view.end, slot.item.end);
          const left = clamp01((clippedStart - view.start) / viewDuration) * 100;
          const width = Math.max(0.7, clamp01((clippedEnd - clippedStart) / viewDuration) * 100);
          const style = STATUS_STYLES[slot.status];
          return (
            <button
              type="button"
              key={slot.item.id}
              onClick={() => onSelectSlot(slot.item.id)}
              className={`absolute inset-y-0 border-r text-left transition-colors ${selectedSlotId === slot.item.id ? "border-[#e05c00] bg-[#e05c0018]" : "border-[#181818] bg-[#ffffff05] hover:bg-[#ffffff0a]"}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${slot.item.label} · ${STATUS_LABELS[slot.status]} · ${fmt(slot.item.start)}–${fmt(slot.item.end)}`}
            >
              <div className="absolute left-1 top-1 max-w-[130px] truncate text-[8px] uppercase tracking-[0.12em] text-[#8a4b20]">{slot.item.label}</div>
              <div className="absolute bottom-2 left-1 right-1 h-16 rounded-[1px] border border-[#111] bg-[#0a0a0a]">
                <div className="h-full rounded-[1px]" style={{ width: `${Math.max(5, (slot.usableDuration / Math.max(slot.requiredDuration, 0.01)) * 100)}%`, background: style.fill, opacity: slot.status === "missing" ? 0.24 : 0.82 }} />
                {slot.status !== "filled" ? <div className="absolute inset-y-0 right-0 min-w-[10px] bg-[#d24b3f22]" style={{ width: `${Math.max(12, (slot.missingDuration / Math.max(slot.requiredDuration, 0.01)) * 100)}%` }} /> : null}
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between font-mono text-[9px] text-[#555]">
        <span>{fmt(view.start)}</span>
        <span>green usable · yellow weak · purple extend · red missing</span>
        <span>{fmt(view.end)}</span>
      </div>
    </div>
  );
}

function getCoverageTimelineView({
  slots,
  duration,
  selectedSlot,
  zoomMode,
}: {
  slots: CoverageSlot[];
  duration: number;
  selectedSlot?: CoverageSlot;
  zoomMode: TimelineZoomMode;
}) {
  const fullDuration = Math.max(0.001, duration);
  if (!selectedSlot || zoomMode === "fit") {
    return { start: 0, end: fullDuration, label: "Fit song" };
  }

  if (zoomMode === "section") {
    const sectionSlots = slots.filter((slot) => slot.item.sectionId === selectedSlot.item.sectionId);
    const start = Math.min(...sectionSlots.map((slot) => slot.item.start));
    const end = Math.max(...sectionSlots.map((slot) => slot.item.end));
    const pad = Math.max(0.5, (end - start) * 0.08);
    return {
      start: clamp(start - pad, 0, fullDuration),
      end: clamp(end + pad, 0.001, fullDuration),
      label: `${selectedSlot.item.label.split(" · ")[0]} section zoom`,
    };
  }

  const center = (selectedSlot.item.start + selectedSlot.item.end) / 2;
  const selectedDuration = Math.max(0.25, selectedSlot.requiredDuration);
  const span = Math.max(8, selectedDuration * 8);
  const start = clamp(center - span / 2, 0, fullDuration);
  const end = clamp(start + span, 0.001, fullDuration);
  const adjustedStart = end >= fullDuration ? clamp(fullDuration - span, 0, fullDuration) : start;
  return {
    start: adjustedStart,
    end,
    label: `${selectedSlot.item.label} chunk zoom`,
  };
}

function AdaptiveClipQueue({ slots, selectedSlotId, onSelectSlot }: { slots: CoverageSlot[]; selectedSlotId: string | null; onSelectSlot: (id: string) => void }) {
  if (!slots.length) return <EmptyState label="No adaptive chunks" detail="Match cue chunks will appear here after Story and song analysis are ready." />;
  const duration = Math.max(slots[slots.length - 1]?.item.end ?? 0, 0.001);

  return (
    <div className="space-y-2">
      <div className="relative h-12 overflow-hidden rounded-[2px] border border-[#151515] bg-[#050505]">
        {slots.map((slot) => {
          const left = clamp01(slot.item.start / duration) * 100;
          const width = Math.max(0.35, clamp01(slot.requiredDuration / duration) * 100);
          const style = STATUS_STYLES[slot.status];
          return (
            <button
              key={`mini-${slot.item.id}`}
              type="button"
              onClick={() => onSelectSlot(slot.item.id)}
              className={`absolute inset-y-1 rounded-[1px] border transition-colors ${selectedSlotId === slot.item.id ? "border-[#ff8a2a]" : "border-[#050505] hover:border-[#e05c00]"}`}
              style={{ left: `${left}%`, width: `${width}%`, background: style.fill, opacity: slot.status === "missing" ? 0.32 : 0.82 }}
              title={`${slot.item.label} · ${fmt(slot.item.start)}-${fmt(slot.item.end)}`}
            />
          );
        })}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6">
        {slots.map((slot, index) => {
          const style = STATUS_STYLES[slot.status];
          const thumb = slot.moment?.firstFrameUrl ?? slot.moment?.thumbnailUrl;
          const selected = selectedSlotId === slot.item.id;
          return (
            <button
              key={slot.item.id}
              type="button"
              onClick={() => onSelectSlot(slot.item.id)}
              className={`group overflow-hidden rounded-[2px] border bg-[#070707] text-left transition-colors ${selected ? "border-[#e05c00]" : "border-[#202020] hover:border-[#6a3218]"}`}
            >
              <div className="relative aspect-video bg-[#030303]">
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt={slot.item.label} className={`h-full w-full object-cover ${slot.status === "missing" ? "opacity-30 grayscale" : "opacity-75 group-hover:opacity-100"}`} loading="lazy" decoding="async" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[8px] uppercase tracking-[0.12em] text-[#444]">No frame</div>
                )}
                <div className="absolute left-1 top-1 rounded-[1px] bg-[#000000c0] px-1.5 py-0.5 font-mono text-[7px] text-[#aaa]">S{String(index + 1).padStart(2, "0")}</div>
                <div className={`absolute right-1 top-1 rounded-[1px] border px-1.5 py-0.5 font-mono text-[7px] uppercase ${style.border} ${style.text}`}>{STATUS_LABELS[slot.status]}</div>
                <div className="absolute bottom-1 right-1 rounded-[1px] bg-[#000000c0] px-1.5 py-0.5 font-mono text-[7px] text-[#aaa]">{slot.requiredDuration.toFixed(1)}s</div>
                {slot.status !== "filled" ? <div className="absolute inset-0 flex items-center justify-center bg-[#00000055] text-[9px] uppercase tracking-[0.16em] text-[#b96c43]">needs work</div> : null}
              </div>
              <div className="border-t border-[#151515] px-2 py-1.5">
                <div className="truncate font-mono text-[8px] uppercase tracking-[0.1em] text-[#8a8a8a]">{slot.item.label}</div>
                <div className="mt-1 flex justify-between font-mono text-[7px] text-[#555]">
                  <span>{fmt(slot.item.start)}-{fmt(slot.item.end)}</span>
                  <span>{Math.round(slot.score * 100)}%</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ShotNeedCard({ slot, selected, onSelect }: { slot: CoverageSlot; selected: boolean; onSelect: () => void }) {
  const style = STATUS_STYLES[slot.status];
  const palette = getPalette(slot.moment);
  const motion = describeMotion(slot.moment?.motionDescriptor ?? slot.moment?.visualAnalysis?.motion);
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={`block w-full cursor-pointer rounded-[2px] border text-left transition-colors ${selected ? "border-[#e05c00]" : style.border} ${style.bg} p-2 hover:border-[#e05c00]`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#d0d0d0]">{slot.item.label}</div>
          <div className="mt-1 text-[10px] text-[#777]">{fmt(slot.item.start)}–{fmt(slot.item.end)} · need {slot.requiredDuration.toFixed(1)}s · have {slot.usableDuration.toFixed(1)}s usable</div>
        </div>
        <span className={`rounded-[2px] border ${style.border} px-2 py-1 font-mono text-[8px] uppercase tracking-[0.12em] ${style.text}`}>{STATUS_LABELS[slot.status]}</span>
      </div>
      <div className="mt-2 grid gap-2 lg:grid-cols-[120px_1fr]">
        <FrameThumb moment={slot.moment} label={slot.moment?.sourceRefLabel ?? "no source"} />
        <div className="space-y-2">
          <div className="rounded-[2px] border border-[#181818] bg-[#070707] p-2 text-[10px] leading-5 text-[#9a9a9a]">
            <span className="text-[#e05c00]">Prompt:</span> {slot.item.prompt}
            <br />
            <span className="text-[#e05c00]">Caption:</span> {getMomentCaption(slot.moment) ?? "No captioned source assigned."}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {slot.needs.length ? slot.needs.map((need) => <NeedPill key={need} need={need} />) : <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#555]">No generation required</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[9px] uppercase tracking-[0.12em] text-[#555]">
            <span>score <span className={style.text}>{Math.round(slot.score * 100)}%</span></span>
            <span>motion <span className="text-[#888]">{motion}</span></span>
            <div className="flex h-3 min-w-[90px] overflow-hidden rounded-[1px] border border-[#111]">
              {palette.map((color, index) => <span key={`${slot.item.id}-${color}-${index}`} className="flex-1" style={{ background: color }} />)}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function NeedPill({ need }: { need: GenerationNeed }) {
  return (
    <button
      type="button"
      disabled
      title="Generation endpoint is not connected in this UI slice yet."
      className="cursor-not-allowed rounded-[2px] border border-[#2a2a2a] bg-[#0b0b0b] px-2 py-1 text-[8px] uppercase tracking-[0.12em] text-[#777] opacity-80"
    >
      {NEED_LABELS[need]}
    </button>
  );
}

function FrameExtensionPanel({
  slot,
  moment,
  referenceAssets,
  referenceSelection,
  onReferenceSelection,
}: {
  slot?: CoverageSlot;
  moment?: VideoMoment;
  referenceAssets: ReferenceAsset[];
  referenceSelection: GenerationReferenceSelection;
  onReferenceSelection: (selection: GenerationReferenceSelection) => void;
}) {
  const frames = [
    { label: "First / start anchor", url: moment?.firstFrameUrl ?? moment?.thumbnailUrl, action: "Extend From First Frame" },
    { label: "Middle / context", url: moment?.middleFrameUrl ?? moment?.storyboardUrl ?? moment?.thumbnailUrl, action: "Generate Alt Angle" },
    { label: "Last / end anchor", url: moment?.lastFrameUrl ?? moment?.thumbnailUrl, action: "Extend From Last Frame" },
  ];
  const anchorUrl = moment?.firstFrameUrl ?? moment?.thumbnailUrl;
  const referencePlan = buildGenerationReferenceInputs({
    anchorUrl,
    anchorLabel: slot?.item.label ?? moment?.sourceRefLabel ?? "source frame",
    assets: referenceAssets,
    selection: referenceSelection,
  });
  const prompt = buildSuggestedPrompt(slot, moment, referencePlan.instructions);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {frames.map((frame) => (
          <div key={frame.label} className="overflow-hidden rounded-[2px] border border-[#202020] bg-[#070707]">
            <div className="relative aspect-video bg-[#030303]">
              {frame.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={frame.url} alt={frame.label} className="h-full w-full object-cover" loading="lazy" decoding="async" />
              ) : <div className="flex h-full items-center justify-center text-[8px] uppercase tracking-[0.12em] text-[#444]">No frame</div>}
              <span className="absolute left-1 top-1 rounded-[2px] bg-[#000000b8] px-1.5 py-1 text-[7px] uppercase tracking-[0.1em] text-[#ddd]">{frame.label}</span>
            </div>
            <button type="button" disabled className="w-full cursor-not-allowed border-t border-[#181818] px-2 py-1.5 text-[8px] uppercase tracking-[0.12em] text-[#666]" title="Generation endpoint pending">{frame.action}</button>
          </div>
        ))}
      </div>
      <div className="rounded-[2px] border border-[#1f1f1f] bg-[#070707] p-2">
        <div className="mb-1 text-[8px] uppercase tracking-[0.16em] text-[#555]">AI suggested prompt draft</div>
        <div className="text-[11px] leading-5 text-[#b0b0b0]">{prompt}</div>
      </div>
      <div className="rounded-[2px] border border-[#1f1f1f] bg-[#070707] p-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-[8px] uppercase tracking-[0.16em] text-[#555]">Nano Banana Pro reference order</div>
          <div className="font-mono text-[8px] text-[#777]">{referencePlan.imageUrls.length} image_urls</div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <ReferenceSelect label="Char 1" value={referenceSelection.character1Id ?? ""} assets={referenceAssets.filter((asset) => asset.role === "character-1")} onChange={(id) => onReferenceSelection({ ...referenceSelection, character1Id: id || undefined })} />
          <ReferenceSelect label="Char 2" value={referenceSelection.character2Id ?? ""} assets={referenceAssets.filter((asset) => asset.role === "character-2")} onChange={(id) => onReferenceSelection({ ...referenceSelection, character2Id: id || undefined })} />
          <ReferenceSelect label="Environment" value={referenceSelection.environmentId ?? ""} assets={referenceAssets.filter((asset) => asset.role === "environment")} onChange={(id) => onReferenceSelection({ ...referenceSelection, environmentId: id || undefined })} />
          <ReferenceSelect label="Custom" value={referenceSelection.customId ?? ""} assets={referenceAssets.filter((asset) => asset.role === "custom")} onChange={(id) => onReferenceSelection({ ...referenceSelection, customId: id || undefined })} />
        </div>
        {referencePlan.errors.length ? (
          <div className="mt-2 rounded-[2px] border border-[#743029] bg-[#160706] p-2 text-[9px] leading-4 text-[#d24b3f]">
            {referencePlan.errors.map((error) => <div key={error}>{error}</div>)}
          </div>
        ) : null}
        <div className="mt-2 space-y-1 font-mono text-[8px] text-[#666]">
          {referencePlan.inputs.map((input, index) => (
            <div key={`${input.role}-${input.assetId ?? input.url}`} className="truncate" title={input.url}>[{index}] {input.role} · {input.label} · {input.url}</div>
          ))}
          {!referencePlan.inputs.length ? <div>No source frame or references selected.</div> : null}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {["Create 3×3 image grid", "Split returned grid", "Send approved frames to video"].map((label, index) => (
          <div key={label} className="rounded-[2px] border border-[#202020] bg-[#080808] px-2 py-2">
            <div className="font-mono text-[9px] text-[#e05c00]">0{index + 1}</div>
            <div className="mt-1 text-[9px] uppercase tracking-[0.12em] text-[#777]">{label}</div>
            <div className="mt-1 text-[8px] uppercase tracking-[0.12em] text-[#444]">pending endpoint</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReferenceSelect({ label, value, assets, onChange }: { label: string; value: string; assets: ReferenceAsset[]; onChange: (id: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[8px] uppercase tracking-[0.14em] text-[#666]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-[2px] border border-[#202020] bg-[#050505] px-2 py-1.5 font-mono text-[9px] text-[#9a9a9a] outline-none focus:border-[#e05c00]"
      >
        <option value="">None</option>
        {assets.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.displayName} · {asset.storageStatus}
          </option>
        ))}
      </select>
    </label>
  );
}

function fillDefaultReferenceSelection(selection: GenerationReferenceSelection, assets: ReferenceAsset[]): GenerationReferenceSelection {
  const pick = (role: ReferenceAsset["role"]) => assets.find((asset) => asset.role === role)?.id;
  return {
    character1Id: selection.character1Id ?? pick("character-1"),
    character2Id: selection.character2Id ?? pick("character-2"),
    environmentId: selection.environmentId ?? pick("environment"),
    customId: selection.customId ?? pick("custom"),
  };
}

function GeneratedShotBank({ slots }: { slots: CoverageSlot[] }) {
  const candidates = slots.filter((slot) => slot.status !== "filled").slice(0, 6);
  if (!candidates.length) {
    return <EmptyState label="No generated shots needed" detail="Current match coverage has no blockers. Optional Camera B generation can still be added later." />;
  }
  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {candidates.map((slot, index) => (
        <article key={slot.item.id} className="rounded-[2px] border border-[#242424] bg-[#080808] p-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#d0d0d0]">GEN_{String(index + 1).padStart(2, "0")} · {slot.item.label}</div>
            <span className="rounded-[2px] border border-[#6e3425] px-1.5 py-0.5 text-[7px] uppercase tracking-[0.1em] text-[#d26c42]">pending</span>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {["image", "clip", "caption"].map((label) => <div key={label} className="flex aspect-video items-center justify-center rounded-[1px] border border-dashed border-[#252525] bg-[#050505] text-[7px] uppercase tracking-[0.1em] text-[#444]">{label}</div>)}
          </div>
          <div className="mt-2 flex gap-1.5">
            {(["Approve", "Reject", "Reroll"] as const).map((label) => <button key={label} type="button" disabled className="flex-1 cursor-not-allowed rounded-[2px] border border-[#202020] px-2 py-1 text-[8px] uppercase tracking-[0.1em] text-[#555]">{label}</button>)}
          </div>
        </article>
      ))}
    </div>
  );
}

function TrackLaneBoard({ slots, duration }: { slots: CoverageSlot[]; duration: number }) {
  const lanes = [
    { label: "Track A", sub: "real matched footage", color: "#255f34", filter: (slot: CoverageSlot) => slot.status === "filled" || slot.status === "short" },
    { label: "Track B", sub: "generated B-roll / alt", color: "#28657f", filter: (slot: CoverageSlot) => slot.status === "missing" || slot.status === "weak" },
    { label: "Track C", sub: "extensions / bridges", color: "#7a3aa0", filter: (slot: CoverageSlot) => slot.status === "short" || slot.needs.includes("bridge") },
    { label: "Track D", sub: "effects / texture", color: "#a85a18", filter: () => true },
  ];
  return (
    <div className="space-y-2">
      {lanes.map((lane) => (
        <div key={lane.label} className="grid grid-cols-[120px_1fr] gap-2 rounded-[2px] border border-[#161616] bg-[#070707] p-2">
          <div>
            <div className="text-[9px] uppercase tracking-[0.16em] text-[#d0d0d0]">{lane.label}</div>
            <div className="mt-1 text-[9px] text-[#555]">{lane.sub}</div>
          </div>
          <div className="relative h-8 border border-[#101010] bg-[#030303]">
            {slots.filter(lane.filter).map((slot) => {
              const left = clamp01(slot.item.start / duration) * 100;
              const width = Math.max(0.35, clamp01(slot.requiredDuration / duration) * 100);
              return <div key={`${lane.label}-${slot.item.id}`} className="absolute inset-y-1 rounded-[1px]" style={{ left: `${left}%`, width: `${width}%`, background: lane.color, opacity: slot.status === "missing" ? 0.35 : 0.82 }} title={`${lane.label} · ${slot.item.label}`} />;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function FrameThumb({ moment, label }: { moment?: VideoMoment; label: string }) {
  const url = moment?.firstFrameUrl ?? moment?.thumbnailUrl;
  return (
    <div className="overflow-hidden rounded-[2px] border border-[#202020] bg-[#050505]">
      <div className="relative aspect-video">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="h-full w-full object-cover" loading="lazy" decoding="async" />
        ) : <div className="flex h-full items-center justify-center text-[8px] uppercase tracking-[0.12em] text-[#444]">No frame</div>}
      </div>
      <div className="truncate border-t border-[#181818] px-2 py-1 font-mono text-[8px] text-[#666]">{label}</div>
    </div>
  );
}

function EmptyState({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="rounded-[2px] border border-dashed border-[#252525] bg-[#070707] px-3 py-8 text-center">
      <div className="text-[10px] uppercase tracking-[0.16em] text-[#555]">{label}</div>
      <div className="mt-2 text-[10px] text-[#666]">{detail}</div>
    </div>
  );
}

function buildSuggestedPrompt(slot?: CoverageSlot, moment?: VideoMoment, referenceInstructions: string[] = []) {
  if (!slot) return "Select a weak, short, or missing timeline slot to draft an extension prompt.";
  const action = slot.status === "missing" ? "Create a new connected music-video shot" : slot.status === "short" ? "Extend this source clip naturally" : slot.status === "weak" ? "Create an alternate angle that better matches the lyric/story intent" : "Create an optional Camera B variation";
  const motion = describeMotion(moment?.motionDescriptor ?? moment?.visualAnalysis?.motion);
  const momentCaption = getMomentCaption(moment);
  const caption = momentCaption ? ` Source caption: ${momentCaption}` : "";
  const references = referenceInstructions.length ? ` References: ${referenceInstructions.join(" ")}` : "";
  return `${action} for ${slot.item.label} (${fmt(slot.item.start)}–${fmt(slot.item.end)}). Story intent: ${slot.item.prompt}.${caption} Maintain motion continuity (${motion}), preserve the color palette, and leave handles for a music-video edit.${references}`;
}

function getMomentCaption(moment?: VideoMoment) {
  return parseCaptionText(moment?.captionMeta?.caption) ?? parseCaptionText(moment?.caption);
}

function parseCaptionText(value?: string) {
  const raw = value?.trim();
  if (!raw) return undefined;
  if (!raw.startsWith("{")) return raw;
  const normalized = raw.replace(/\\"/g, '"');
  try {
    const parsed = JSON.parse(normalized) as { caption?: unknown };
    return typeof parsed.caption === "string" && parsed.caption.trim() ? parsed.caption : raw;
  } catch {
    const captionMatch = normalized.match(/"caption"\s*:\s*"([\s\S]*?)"\s*,/);
    if (captionMatch?.[1]) {
      return captionMatch[1].replace(/\\"/g, '"');
    }
    return raw;
  }
}

function getPalette(moment?: VideoMoment): string[] {
  const swatches = moment?.visualAnalysis?.color?.palette ?? moment?.visualAnalysis?.color?.middlePalette ?? [];
  const colors = swatches.map(swatchToColor).filter((color): color is string => Boolean(color));
  return colors.length ? colors.slice(0, 5) : ["#263b35", "#617c54", "#c8923a", "#1b252a", "#4f3228"];
}

function swatchToColor(swatch: ColorPaletteSwatch): string | null {
  if (swatch.hex && /^#[0-9a-f]{6}$/i.test(swatch.hex)) return swatch.hex;
  return null;
}

function describeMotion(motion?: MotionDescriptor | null) {
  if (!motion) return "unknown";
  const type = motion.cameraMotionType ?? "unknown";
  const strength = motion.cameraMotionStrength ?? motion.dominantMagnitude ?? 0;
  const direction = typeof motion.dominantAngleDeg === "number" ? `${Math.round(motion.dominantAngleDeg)}°` : "no angle";
  return `${type} · ${strength.toFixed(2)} · ${direction}`;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
