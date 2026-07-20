"use client";

import { fmt } from "./math";
import type { StoryPlanDraft, StorySection, StorySectionDraft } from "./musicVideoProject";
import { ParamSlider } from "./ParamSlider";
import type { BeatJoinSection } from "./types";

type StoryPlanEditorProps = {
  plannedSections: StorySection[];
  templates: StoryPlanDraft[];
  activeSectionId: string;
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: Partial<StorySectionDraft>) => void;
  onInsertTemplate: (template: StoryPlanDraft) => void;
  onAddPart: () => void;
  onRemove: (id: string) => void;
  onMoveBoundary: (boundaryIndex: number, time: number) => void;
  onResetFromDetection: () => void;
};

export function StoryPlanEditor({
  plannedSections,
  templates,
  activeSectionId,
  onSelect,
  onUpdate,
  onInsertTemplate,
  onAddPart,
  onRemove,
  onMoveBoundary,
  onResetFromDetection,
}: StoryPlanEditorProps) {
  const usedTemplateIds = new Set(plannedSections.map((section) => section.id));

  return (
    <div className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Planned story structure</div>
          <div className="mt-1 text-[11px] leading-5 text-[#6d6d6d]">
            Detection creates the first timed plan. Familiar roles land in normal song order automatically; select a section only when adding a neutral Part A/B there.
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onResetFromDetection} className="rounded-[2px] border border-[#2a2a2a] px-2 py-1 text-[8px] uppercase tracking-[0.12em] text-[#777] hover:border-[#555] hover:text-[#bbb]">
            Remap detection
          </button>
          <button type="button" onClick={onAddPart} className="rounded-[2px] border border-[#2a2a2a] px-2 py-1 text-[8px] uppercase tracking-[0.12em] text-[#bdbdbd] hover:border-[#e05c00]">
            Add Part
          </button>
        </div>
      </div>

      <div className="mb-3 rounded-[2px] border border-[#171717] bg-[#070707] p-2">
        <div className="mb-2 flex items-center justify-between gap-2 text-[8px] uppercase tracking-[0.14em] text-[#555]">
          <span>Song-role palette</span>
          <span>Adds at its song position</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {templates.map((template) => {
            const used = Boolean(template.id && usedTemplateIds.has(template.id));
            return (
              <button
                key={template.id ?? template.label}
                type="button"
                disabled={used}
                onClick={() => onInsertTemplate(template)}
                className={`rounded-[2px] border px-2 py-1 text-[8px] uppercase tracking-[0.1em] ${
                  used
                    ? "border-[#244429] bg-[#0a140b] text-[#62a36c]"
                    : "border-[#242424] bg-[#0a0a0a] text-[#777] hover:border-[#e05c00] hover:text-[#d0d0d0]"
                }`}
              >
                {template.label}{used ? " · mapped" : " · add"}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        {plannedSections.map((section, index) => {
          const next = plannedSections[index + 1];
          return (
            <div key={section.id}>
              <div className={`rounded-[2px] border p-2 transition-colors ${activeSectionId === section.id ? "border-[#e05c00] bg-[#140c07]" : "border-[#171717] bg-[#080808]"}`}>
                <button type="button" onClick={() => onSelect(section.id)} className="mb-2 flex w-full items-center justify-between gap-2 text-left">
                  <span className="font-mono text-[9px] text-[#6a6a6a]">{String(index + 1).padStart(2, "0")}</span>
                  <span className="flex-1 truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-[#c9c9c9]">{section.label}</span>
                  <span className={`rounded-[2px] border px-1.5 py-0.5 text-[7px] uppercase tracking-[0.12em] ${section.source === "analysis" ? "border-[#244429] text-[#62a36c]" : "border-[#4b2d1d] text-[#c77745]"}`}>
                    {section.source === "analysis" ? "Detected" : "Adjusted"}
                  </span>
                  <span className="font-mono text-[9px] text-[#676767]">{fmt(section.start)}–{fmt(section.end)}</span>
                </button>
                <div className="grid gap-2 md:grid-cols-[132px_1fr_auto]">
                  <input
                    aria-label={`${section.label} name`}
                    value={section.label}
                    onChange={(event) => onUpdate(section.id, { label: event.target.value })}
                    className="rounded-[2px] border border-[#191919] bg-[#050505] px-2 py-2 text-[10px] text-[#bdbdbd] outline-none focus:border-[#3a3a3a]"
                  />
                  <textarea
                    aria-label={`${section.label} prompt`}
                    value={section.prompt}
                    onChange={(event) => onUpdate(section.id, { prompt: event.target.value })}
                    className="h-14 resize-none rounded-[2px] border border-[#191919] bg-[#050505] p-2 text-[11px] leading-4 text-[#bdbdbd] outline-none placeholder:text-[#3d3d3d] focus:border-[#3a3a3a]"
                  />
                  <button type="button" disabled={plannedSections.length <= 1} onClick={() => onRemove(section.id)} className="rounded-[2px] border border-[#202020] px-2 text-[9px] uppercase tracking-[0.12em] text-[#5f5f5f] hover:text-[#b96c43] disabled:opacity-30">
                    Remove
                  </button>
                </div>
              </div>
              {next ? (
                <div className="px-2">
                  <ParamSlider
                    label={`${section.label} → ${next.label}`}
                    value={section.end}
                    min={section.start + 0.5}
                    max={Math.max(section.start + 0.75, next.end - 0.5)}
                    step={0.25}
                    unit="s"
                    onChange={(time) => onMoveBoundary(index, time)}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type StoryStructureRulerProps = {
  detectedSections: BeatJoinSection[];
  plannedSections: StorySection[];
  duration: number;
  activeSectionId: string;
  onSelect: (id: string) => void;
};

export function StoryStructureRuler({ detectedSections, plannedSections, duration, activeSectionId, onSelect }: StoryStructureRulerProps) {
  return (
    <div className="mb-3 rounded-[2px] border border-[#171717] bg-[#070707] p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[9px] uppercase tracking-[0.16em] text-[#777]">Detected vs planned structure</div>
          <div className="mt-1 text-[9px] text-[#515151]">Detection stays visible as evidence. The planned row is the canonical structure sent to Match, Generate, preview, and export.</div>
        </div>
        <span className="font-mono text-[9px] text-[#555]">{fmt(duration)}</span>
      </div>
      <TimelineRail label="Detected audio" duration={duration} sections={detectedSections.map((section, index) => ({ id: `detected-${index}`, label: section.label, start: section.start, end: section.end }))} accent="detected" />
      <div className="mt-2">
        <TimelineRail label="Planned story" duration={duration} sections={plannedSections} accent="planned" activeId={activeSectionId} onSelect={onSelect} />
      </div>
    </div>
  );
}

type TimelineSection = { id: string; label: string; start: number; end: number };

function TimelineRail({ label, duration, sections, accent, activeId, onSelect }: { label: string; duration: number; sections: TimelineSection[]; accent: "detected" | "planned"; activeId?: string; onSelect?: (id: string) => void }) {
  return (
    <div className="grid gap-2 md:grid-cols-[92px_1fr] md:items-stretch">
      <div className="flex items-center text-[8px] uppercase tracking-[0.14em] text-[#555]">{label}</div>
      <div className="relative h-14 overflow-hidden rounded-[2px] border border-[#141414] bg-[#030303]">
        {sections.map((section) => {
          const left = duration > 0 ? (section.start / duration) * 100 : 0;
          const width = duration > 0 ? ((section.end - section.start) / duration) * 100 : 0;
          const className = accent === "detected"
            ? "border-[#1d3c24] bg-[#0a150c] text-[#72a97a]"
            : activeId === section.id
              ? "border-[#e05c00] bg-[#211006] text-[#f0b184]"
              : "border-[#30231b] bg-[#100b08] text-[#b78361] hover:bg-[#18100b]";
          return (
            <button
              key={section.id}
              type="button"
              disabled={!onSelect}
              onClick={() => onSelect?.(section.id)}
              className={`absolute inset-y-0 overflow-hidden border-r px-2 text-left ${className}`}
              style={{ left: `${left}%`, width: `${width}%` }}
            >
              <span className="block truncate text-[8px] font-semibold uppercase tracking-[0.1em]">{section.label}</span>
              <span className="mt-1 block truncate font-mono text-[7px] opacity-60">{fmt(section.start)}–{fmt(section.end)}</span>
            </button>
          );
        })}
        {!sections.length ? <div className="flex h-full items-center justify-center text-[8px] uppercase tracking-[0.12em] text-[#444]">No detected structure yet</div> : null}
      </div>
    </div>
  );
}
