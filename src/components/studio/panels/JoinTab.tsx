"use client";

import { useState } from "react";
import { fmt } from "../math";
import type { EditPlanPreviewSegment } from "../musicVideoProject";
import { Button, Surface } from "../ui";

type JoinTabProps = {
  previewSegments: EditPlanPreviewSegment[];
  sectionLabels: Record<string, string>;
  existingFootage: { id: string; label: string; caption?: string }[];
  activeClip: number;
  onActiveClip: (index: number) => void;
  onPlayWhole: () => void;
  onPlaySection: (sectionId: string) => void;
  onFillGap: (index: number) => void;
  onReviewAlternates: (index: number, momentId: string) => void;
  onSwap: (firstIndex: number, secondIndex: number) => void;
  proposalSummary: string | null;
  editMessage: string | null;
  onApplyProposal: () => void;
  onCancelProposal: () => void;
  onUndo: () => void;
  canUndo: boolean;
  busy: boolean;
};

export function JoinTab({ previewSegments, sectionLabels, existingFootage, activeClip, onActiveClip, onPlayWhole, onPlaySection,
  onFillGap, onReviewAlternates, onSwap, proposalSummary, editMessage, onApplyProposal,
  onCancelProposal, onUndo, canUndo, busy }: JoinTabProps) {
  const [swapTarget, setSwapTarget] = useState("");
  const [replacement, setReplacement] = useState("");
  if (!previewSegments.length) return <Surface>
    <p className="text-sm text-fg-1">Your rough cut will appear here after Story and Split.</p>
    <p className="mt-2 text-sm text-fg-3">Missing shots can stay as holes while you review the whole song.</p>
  </Surface>;

  const totalDuration = Math.max(...previewSegments.map(segment => segment.musicEnd), 0.001);
  const gapSeconds = previewSegments.filter(segment => segment.kind === "gap")
    .reduce((sum, segment) => sum + segment.musicEnd - segment.musicStart, 0);
  const selectedIndex = Math.min(activeClip, previewSegments.length - 1);
  const selected = previewSegments[selectedIndex]!;
  const sections = [...new Set(previewSegments.map(segment => segment.sectionId))].map(id => ({
    id, cuts: previewSegments.map((segment, index) => ({ segment, index })).filter(({ segment }) => segment.sectionId === id),
  }));
  const canArrange = (segment: EditPlanPreviewSegment) => Boolean(segment.placementId)
    && !previewSegments.some(other => other !== segment && other.placementId === segment.placementId)
    && (segment.kind === "gap" || segment.sourceClipId !== undefined);

  return <div className="space-y-4">
    <Surface>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-medium text-fg-0">Whole-song rough cut</h2>
          <p className="mt-1 text-sm text-fg-2">Play every section together, try a different order, and fill the holes as you go.</p></div>
        <Button onClick={onPlayWhole} disabled={busy}>Play whole song</Button>
      </div>
      <p className="mt-3 text-xs text-fg-3">{sections.length} sections · {fmt(totalDuration)} · {gapSeconds > 0 ? `${gapSeconds.toFixed(1)}s still need footage. The song keeps playing through those holes.` : "All song windows have footage. Review the sequence before final effects and export."}</p>
      <div aria-label="Whole-song arrangement" className="relative mt-3 h-14 overflow-hidden rounded-sm bg-ink-0">
        {previewSegments.map((segment, index) => <button key={`${segment.placementId ?? segment.sectionId}:${index}`}
          type="button" aria-label={`Select cut ${index + 1}: ${segment.kind === "gap" ? "Missing footage" : segment.sourceRefLabel ?? segment.label}`}
          aria-pressed={index === selectedIndex} onClick={() => onActiveClip(index)}
          title={`${segment.label} · ${time(segment.musicStart)}–${time(segment.musicEnd)}`}
          className={`absolute inset-y-1 overflow-hidden rounded-sm border ${index === selectedIndex ? "z-10 border-accent bg-accent-tint" : segment.kind === "gap" ? "border-dashed border-warn-lo bg-warn-tint" : "border-line-2 bg-ink-3 hover:border-accent"}`}
          style={{ left: `${segment.musicStart / totalDuration * 100}%`, width: `${Math.max(0.3, (segment.musicEnd - segment.musicStart) / totalDuration * 100)}%` }}>
          <span className="text-xs text-fg-2">{index + 1}</span>
        </button>)}
      </div>
    </Surface>

    <Surface aria-label="Selected rough-cut placement">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="text-sm font-medium text-fg-0">Cut {selectedIndex + 1} · {selected.label}</h3>
          <p className="mt-1 text-xs text-fg-3">Song {time(selected.musicStart)}–{time(selected.musicEnd)}</p>
          <p className="mt-2 text-sm text-fg-2">{selected.storyDirection ?? selected.gapReason ?? "Review this shot in the surrounding sequence."}</p></div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onPlaySection(selected.sectionId)} disabled={busy}>Play this section</Button>
          <Button size="sm" onClick={() => onFillGap(selectedIndex)} disabled={busy}>{selected.kind === "gap" ? "Fill this hole" : "Supply another shot"}</Button>
        </div>
      </div>
      {selected.kind === "gap" ? <p className="mt-2 text-xs text-warn">{selected.gapReason} · This window stays in the preview.</p> : null}
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="min-w-48 flex-1 text-xs text-fg-2">Existing footage
          <select aria-label="Existing footage for selected cut" value={replacement} onChange={event => setReplacement(event.target.value)}
            disabled={busy || !canArrange(selected)} className="mt-1 block w-full rounded-md border border-line bg-ink-1 px-2 py-2 text-sm text-fg-1">
            <option value="">Choose a source moment</option>
            {existingFootage.map(moment => <option key={moment.id} value={moment.id}>{moment.label} · {moment.caption?.slice(0, 120) ?? "Uncaptioned"}</option>)}
          </select>
        </label>
        <Button size="sm" disabled={busy || !canArrange(selected) || !replacement}
          onClick={() => onReviewAlternates(selectedIndex, replacement)}>Review replacement</Button>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="min-w-48 flex-1 text-xs text-fg-2">Swap with
          <select aria-label="Swap with cut" value={swapTarget} onChange={event => setSwapTarget(event.target.value)}
            disabled={busy || !canArrange(selected)} className="mt-1 block w-full rounded-md border border-line bg-ink-1 px-2 py-2 text-sm text-fg-1">
            <option value="">Choose another position</option>
            {previewSegments.map((segment, index) => index !== selectedIndex && canArrange(segment)
              ? <option key={index} value={index}>Cut {index + 1} · {segment.label} · {time(segment.musicStart)}</option> : null)}
          </select>
        </label>
        <Button size="sm" disabled={busy || !canArrange(selected) || swapTarget === "" || Number(swapTarget) === selectedIndex}
          onClick={() => onSwap(selectedIndex, Number(swapTarget))}>Review swap</Button>
        <Button size="sm" disabled={busy || !canUndo} onClick={onUndo}>Undo arrangement</Button>
      </div>
      <p className="mt-2 text-xs text-fg-3">Song timing stays fixed. A swap must still fit the destination story moment; any trim or remaining hole is shown before applying it.</p>
      {!canArrange(selected) ? <p className="mt-2 text-xs text-fg-3">Review this supplied-shot approval in Generate before moving its window.</p> : null}
      {editMessage ? <p role="status" className="mt-3 text-sm text-fg-2">{editMessage}</p> : null}
      {proposalSummary ? <div className="mt-3 rounded-md border border-review-lo bg-review-tint p-3">
        <p className="text-sm text-fg-1">{proposalSummary}</p>
        <div className="mt-3 flex gap-2"><Button size="sm" disabled={busy} onClick={onApplyProposal}>Apply arrangement</Button><Button size="sm" onClick={onCancelProposal}>Cancel change</Button></div>
      </div> : null}
    </Surface>

    <div className="space-y-3" aria-label="Song sections and footage">
      {sections.map(({ id, cuts }, sectionIndex) => <Surface key={id}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div><h3 className="text-sm font-medium text-fg-1">Section {sectionIndex + 1} · {sectionLabels[id] ?? cuts[0]!.segment.label.replace(/^Missing footage · /, "")}</h3>
            <p className="mt-1 text-xs text-fg-3">{time(cuts[0]!.segment.musicStart)}–{time(cuts.at(-1)!.segment.musicEnd)}</p></div>
          <Button size="sm" disabled={busy} onClick={() => onPlaySection(id)}>Play section {sectionIndex + 1}</Button>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {cuts.map(({ segment, index }) => <button key={`${segment.placementId}:${index}`} type="button" aria-pressed={index === selectedIndex}
            onClick={() => onActiveClip(index)} aria-label={`Review cut ${index + 1}: ${segment.label}`}
            className={`w-40 shrink-0 overflow-hidden rounded-md border text-left ${index === selectedIndex ? "border-accent bg-accent-tint" : segment.kind === "gap" ? "border-dashed border-warn-lo bg-warn-tint" : "border-line bg-ink-1 hover:border-line-3"}`}>
            <div className="relative aspect-video bg-ink-0">
              {segment.kind !== "gap" && segment.thumbnailUrl ?
                // eslint-disable-next-line @next/next/no-img-element
                <img src={segment.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                : <span className="flex h-full items-center justify-center text-xs text-warn">Missing footage</span>}
              <span className="absolute left-1 top-1 rounded-sm bg-ink-0/80 px-1 text-xs text-fg-1">{index + 1}</span>
            </div>
            <div className="p-2"><p className="truncate text-xs text-fg-2">{segment.kind === "gap" ? "Hole to fill" : segment.sourceRefLabel ?? "Supplied shot"}</p>
              <p className="mt-1 font-mono text-xs text-fg-3">{(segment.musicEnd - segment.musicStart).toFixed(1)}s · {time(segment.musicStart)}</p></div>
          </button>)}
        </div>
      </Surface>)}
    </div>
  </div>;
}

function time(value: number) {
  const safe = Math.max(0, value);
  return `${Math.floor(safe / 60)}:${(safe % 60).toFixed(1).padStart(4, "0")}`;
}
