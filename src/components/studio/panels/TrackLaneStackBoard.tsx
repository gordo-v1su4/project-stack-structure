"use client";

import { useMemo, useState } from "react";
import { fmt } from "../math";
import {
  deriveVisibleTrackLaneRows,
  TRACK_LANE_DEFINITIONS,
  type FootageLaneRole,
  type TrackLaneBlock,
  type TrackLaneRow,
  type TrackLaneSection,
  type TrackLaneStack,
} from "../trackLaneStack";

type TrackLaneStackBoardProps = {
  stack: TrackLaneStack;
  onSelectCandidate: (sectionId: string, momentId: string) => void;
};

type ZoomMode = "fit" | "focus" | "detail";

export function TrackLaneStackBoard({ stack, onSelectCandidate }: TrackLaneStackBoardProps) {
  const [mutedRoles, setMutedRoles] = useState<Set<FootageLaneRole>>(() => new Set());
  const [collapsedRoles, setCollapsedRoles] = useState<Set<FootageLaneRole>>(() => new Set(["effects", "unsorted"]));
  const [soloRole, setSoloRole] = useState<FootageLaneRole | null>(null);
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);
  const [zoomMode, setZoomMode] = useState<ZoomMode>("fit");

  const visibleRows = useMemo(
    () => deriveVisibleTrackLaneRows({ rows: stack.rows, mutedRoles, soloRole, collapsedRoles }),
    [collapsedRoles, mutedRoles, soloRole, stack.rows],
  );
  const sections = useMemo(() => selectVisibleSections(stack.sections, focusedSectionId, zoomMode), [focusedSectionId, stack.sections, zoomMode]);
  const hasBlocks = stack.summary.blockCount > 0;

  const toggleMuted = (role: FootageLaneRole) => {
    setMutedRoles((current) => toggleSetValue(current, role));
    if (soloRole === role) setSoloRole(null);
  };
  const toggleCollapsed = (role: FootageLaneRole) => setCollapsedRoles((current) => toggleSetValue(current, role));
  const toggleSolo = (role: FootageLaneRole) => {
    setSoloRole((current) => (current === role ? null : role));
    setMutedRoles(new Set());
  };

  return (
    <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-5xl">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Smart track stack · how the edit chooses footage</div>
          <div className="mt-1 text-[11px] leading-5 text-[#777]">
            Columns are song/story sections. Rows are footage roles. Click a block to promote that alternate into the live Match choice; mute/solo only changes this view, so Join/export stay tied to the selected orange block.
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[#777] sm:min-w-[360px]">
          <Metric label="slots" value={String(stack.summary.sectionCount)} />
          <Metric label="lanes" value={String(stack.summary.activeLaneCount)} />
          <Metric label="alts" value={String(stack.summary.backupCount)} />
          <Metric label="check" value={String(stack.summary.lowConfidenceCount)} tone={stack.summary.lowConfidenceCount ? "warn" : "ok"} />
        </div>
      </div>

      <div className="mb-3 grid gap-2 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-[2px] border border-[#171717] bg-[#060606] p-2">
          <div className="mb-2 text-[8px] uppercase tracking-[0.16em] text-[#555]">Workflow logic</div>
          <div className="grid gap-1 text-[10px] leading-4 text-[#8a8a8a] md:grid-cols-3">
            <LogicStep n="1" title="Caption + search" text="Every scene remains searchable by source, caption, role, score, and section." />
            <LogicStep n="2" title="Lane-aware shuffle" text="Performance anchors vocals; Camera B/B-roll/generated cover repeats, gaps, and weak matches." />
            <LogicStep n="3" title="One live choice" text="The orange block is the clip Join/export will use; other blocks stay visible as alternates." />
          </div>
        </div>
        <div className="rounded-[2px] border border-[#171717] bg-[#060606] p-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[8px] uppercase tracking-[0.16em] text-[#555]">View controls</span>
            <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#666]">{stack.guidance}</span>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {(["fit", "focus", "detail"] as const).map((mode) => (
              <button key={mode} type="button" onClick={() => setZoomMode(mode)} className={`rounded-[2px] border px-2 py-1.5 text-[8px] uppercase tracking-[0.12em] ${zoomMode === mode ? "border-[#e05c00] bg-[#160905] text-[#e05c00]" : "border-[#202020] text-[#666] hover:text-[#aaa]"}`}>
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      {stack.sections.length ? (
        <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
          <button type="button" onClick={() => setFocusedSectionId(null)} className={`shrink-0 rounded-[2px] border px-2 py-1 text-[8px] uppercase tracking-[0.12em] ${focusedSectionId === null ? "border-[#e05c00] text-[#e05c00]" : "border-[#202020] text-[#666]"}`}>All sections</button>
          {stack.sections.map((section) => (
            <button key={section.id} type="button" onClick={() => setFocusedSectionId(section.id)} className={`shrink-0 rounded-[2px] border px-2 py-1 text-left ${focusedSectionId === section.id ? "border-[#e05c00] bg-[#120905]" : "border-[#202020] bg-[#070707] hover:border-[#333]"}`}>
              <span className="block text-[8px] uppercase tracking-[0.12em] text-[#aaa]">{section.label}</span>
              <span className="font-mono text-[8px] text-[#666]">{fmt(section.start)}-{fmt(section.end)}</span>
            </button>
          ))}
        </div>
      ) : null}

      {!hasBlocks ? <EmptyLaneState sectionCount={stack.summary.sectionCount} /> : <LaneGrid rows={visibleRows} sections={sections} zoomMode={zoomMode} onSelectCandidate={onSelectCandidate} onToggleMuted={toggleMuted} onToggleSolo={toggleSolo} onToggleCollapsed={toggleCollapsed} />}
    </section>
  );
}

function LaneGrid({
  rows,
  sections,
  zoomMode,
  onSelectCandidate,
  onToggleMuted,
  onToggleSolo,
  onToggleCollapsed,
}: {
  rows: TrackLaneRow[];
  sections: TrackLaneSection[];
  zoomMode: ZoomMode;
  onSelectCandidate: (sectionId: string, momentId: string) => void;
  onToggleMuted: (role: FootageLaneRole) => void;
  onToggleSolo: (role: FootageLaneRole) => void;
  onToggleCollapsed: (role: FootageLaneRole) => void;
}) {
  const templateColumns = `132px repeat(${Math.max(1, sections.length)}, minmax(${zoomMode === "detail" ? "210px" : "150px"}, 1fr))`;
  return (
    <div className="overflow-x-auto rounded-[2px] border border-[#151515] bg-[#050505]">
      <div className="min-w-[820px]" style={{ display: "grid", gridTemplateColumns: templateColumns }}>
        <div className="sticky left-0 z-10 border-b border-r border-[#151515] bg-[#080808] p-2 text-[8px] uppercase tracking-[0.16em] text-[#555]">Tracks</div>
        {sections.map((section) => (
          <div key={section.id} className="border-b border-r border-[#151515] bg-[#080808] p-2">
            <div className="truncate text-[9px] uppercase tracking-[0.14em] text-[#d0d0d0]">{section.label}</div>
            <div className="font-mono text-[8px] text-[#666]">{fmt(section.start)}-{fmt(section.end)} · {section.lyricCount} lyrics</div>
          </div>
        ))}
        {rows.map((row) => <LaneRow key={row.definition.role} row={row} sections={sections} zoomMode={zoomMode} onSelectCandidate={onSelectCandidate} onToggleMuted={onToggleMuted} onToggleSolo={onToggleSolo} onToggleCollapsed={onToggleCollapsed} />)}
      </div>
    </div>
  );
}

function LaneRow({ row, sections, zoomMode, onSelectCandidate, onToggleMuted, onToggleSolo, onToggleCollapsed }: {
  row: TrackLaneRow;
  sections: TrackLaneSection[];
  zoomMode: ZoomMode;
  onSelectCandidate: (sectionId: string, momentId: string) => void;
  onToggleMuted: (role: FootageLaneRole) => void;
  onToggleSolo: (role: FootageLaneRole) => void;
  onToggleCollapsed: (role: FootageLaneRole) => void;
}) {
  return (
    <>
      <div className={`sticky left-0 z-10 border-r border-t border-[#151515] bg-[#070707] p-2 ${row.muted ? "opacity-45" : ""}`}>
        <div className="mb-1 flex items-center justify-between gap-2">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-[0.12em]" style={{ color: row.definition.color }}>{row.definition.shortLabel}</div>
            <div className="mt-0.5 text-[8px] uppercase tracking-[0.1em] text-[#777]">{row.selectedCount} live · {row.backupCount} alt</div>
          </div>
          <span className="h-2 w-2 rounded-full" style={{ background: row.blocks.length ? row.definition.color : "#333" }} />
        </div>
        <div className="mb-2 line-clamp-2 text-[8px] leading-3 text-[#666]">{row.definition.description}</div>
        <div className="grid grid-cols-3 gap-1">
          <TinyToggle active={Boolean(row.soloed)} label="S" title="Solo this lane" onClick={() => onToggleSolo(row.definition.role)} />
          <TinyToggle active={Boolean(row.muted)} label="M" title="Mute this lane visually" onClick={() => onToggleMuted(row.definition.role)} />
          <TinyToggle active={Boolean(row.collapsed)} label="C" title="Collapse this lane" onClick={() => onToggleCollapsed(row.definition.role)} />
        </div>
      </div>
      {sections.map((section) => {
        const blocks = row.blocks.filter((block) => block.sectionId === section.id);
        return (
          <div key={`${row.definition.role}-${section.id}`} className={`min-h-[94px] border-r border-t border-[#111] p-1.5 ${row.muted ? "opacity-35 grayscale" : ""}`}>
            {blocks.length ? (
              <div className="space-y-1">
                {blocks.slice(0, zoomMode === "fit" ? 2 : 4).map((block) => <LaneBlock key={block.id} block={block} color={row.definition.color} onSelectCandidate={onSelectCandidate} />)}
                {blocks.length > (zoomMode === "fit" ? 2 : 4) ? <div className="rounded-[2px] border border-[#191919] px-2 py-1 text-center font-mono text-[8px] text-[#555]">+{blocks.length - (zoomMode === "fit" ? 2 : 4)} more</div> : null}
              </div>
            ) : <div className="flex h-full min-h-[74px] items-center justify-center rounded-[2px] border border-dashed border-[#151515] text-[8px] uppercase tracking-[0.12em] text-[#333]">empty</div>}
          </div>
        );
      })}
    </>
  );
}

function LaneBlock({ block, color, onSelectCandidate }: { block: TrackLaneBlock; color: string; onSelectCandidate: (sectionId: string, momentId: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelectCandidate(block.sectionId, block.momentId)}
      aria-pressed={block.selected}
      title={block.shuffleHint}
      className={`group w-full overflow-hidden rounded-[2px] border text-left transition-colors ${block.selected ? "border-[#e05c00] bg-[#120905]" : "border-[#202020] bg-[#080808] hover:border-[#6e3425]"}`}
    >
      <div className="flex gap-2 p-1.5">
        <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded-[1px] border border-[#191919] bg-[#040404]">
          {block.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={block.thumbnailUrl} alt={`${block.sectionLabel} ${block.sourceLabel}`} className="h-full w-full object-cover" loading="lazy" decoding="async" />
          ) : <div className="flex h-full items-center justify-center text-[7px] uppercase tracking-[0.1em] text-[#444]">No frame</div>}
          <div className="absolute left-0 top-0 px-1 py-0.5 font-mono text-[7px] text-white" style={{ background: `${color}dd` }}>#{block.rank}</div>
          {block.selected ? <div className="absolute bottom-0 left-0 right-0 bg-[#e05c00] px-1 py-0.5 text-center text-[7px] uppercase tracking-[0.1em] text-white">live</div> : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-[8px] uppercase tracking-[0.1em] text-[#aaa]">{block.sourceLabel}</span>
            <span className="font-mono text-[8px] text-[#e05c00]">{Math.round(block.score * 100)}%</span>
          </div>
          <div className="mt-0.5 line-clamp-2 text-[9px] leading-3 text-[#c0c0c0]">{block.caption}</div>
          <div className="mt-1 grid grid-cols-2 gap-1 font-mono text-[7px] uppercase tracking-[0.08em] text-[#666]">
            <span>H {block.headHandle}</span>
            <span>T {block.tailHandle}</span>
          </div>
          <div className="mt-1 flex items-center gap-1 text-[7px] uppercase tracking-[0.08em]">
            <span className="rounded-[1px] border border-[#242424] bg-[#050505] px-1 font-mono text-[#888]">Lane {Math.round(block.laneConfidence * 100)}%</span>
            <span className="min-w-0 truncate text-[#666]">{block.laneReasons[0] ?? "verify role"}</span>
          </div>
          <div className="mt-1 line-clamp-1 text-[8px] text-[#6d6d6d]">{block.shuffleHint}</div>
        </div>
      </div>
    </button>
  );
}

function EmptyLaneState({ sectionCount }: { sectionCount: number }) {
  return (
    <div className="rounded-[2px] border border-dashed border-[#252525] bg-[#070707] px-4 py-8 text-center">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[#d24b3f]">Lane stack waiting for captioned candidates</div>
      <div className="mx-auto mt-3 max-w-2xl text-[11px] leading-5 text-[#777]">
        {sectionCount ? "Story sections exist, but Match has no ranked clip candidates yet. Finish clip ingest, scene detection, and captions so the board can group takes into performance, camera, B-roll, generated, and effects lanes." : "Start from Ingest: upload a master song, create Story sections, upload/caption clips, then this board becomes the compact track-stack view for the edit."}
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div className="rounded-[2px] border border-[#202020] bg-[#070707] px-2 py-1.5">
      <div className="text-[7px] text-[#555]">{label}</div>
      <div className={tone === "warn" ? "text-[#d3a236]" : tone === "ok" ? "text-[#79c779]" : "text-[#aaa]"}>{value}</div>
    </div>
  );
}

function LogicStep({ n, title, text }: { n: string; title: string; text: string }) {
  return (
    <div className="rounded-[2px] border border-[#151515] bg-[#050505] p-2">
      <div className="mb-1 font-mono text-[8px] uppercase tracking-[0.12em] text-[#e05c00]">{n}. {title}</div>
      <div>{text}</div>
    </div>
  );
}

function TinyToggle({ active, label, title, onClick }: { active: boolean; label: string; title: string; onClick: () => void }) {
  return (
    <button type="button" title={title} onClick={onClick} className={`rounded-[1px] border px-1 py-0.5 font-mono text-[8px] ${active ? "border-[#e05c00] bg-[#160905] text-[#e05c00]" : "border-[#1d1d1d] text-[#555] hover:text-[#aaa]"}`}>
      {label}
    </button>
  );
}

function selectVisibleSections(sections: TrackLaneSection[], focusedSectionId: string | null, zoomMode: ZoomMode) {
  if (!focusedSectionId || zoomMode !== "focus") return sections;
  const focusedIndex = sections.findIndex((section) => section.id === focusedSectionId);
  if (focusedIndex < 0) return sections;
  return sections.slice(Math.max(0, focusedIndex - 1), Math.min(sections.length, focusedIndex + 2));
}

function toggleSetValue<T>(current: Set<T>, value: T) {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function TrackLaneLegend() {
  return TRACK_LANE_DEFINITIONS.map((definition) => `${definition.shortLabel}: ${definition.label}`).join(" · ");
}
