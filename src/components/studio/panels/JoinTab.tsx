"use client";

import { useState } from "react";
import { buildRoughCutSections, type ReviewSelection } from "../songSectionReview";
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
  selection?: ReviewSelection | null;
  onPlaySelection: (startIndex: number, endIndex: number) => void;
  onFillGap: (index: number) => void;
  onReviewAlternates: (index: number, momentId: string) => void;
  onSwap: (firstIndex: number, secondIndex: number) => void;
  onRemove: (index: number) => void;
  proposalSummary: string | null;
  editMessage: string | null;
  onApplyProposal: () => void;
  onCancelProposal: () => void;
  onUndo: () => void;
  canUndo: boolean;
  busy: boolean;
};

export function JoinTab({ previewSegments, sectionLabels, existingFootage, activeClip, onActiveClip, onPlayWhole, selection, onPlaySelection,
  onFillGap, onReviewAlternates, onSwap, onRemove, proposalSummary, editMessage, onApplyProposal,
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
  const sections = buildRoughCutSections(previewSegments, sectionLabels);
  const currentSection = sections.find(section => section.sectionIds.includes(selected.sectionId))!;
  const cuts = selection && previewSegments[selection.startIndex] && previewSegments[selection.endIndex]
    ? previewSegments.flatMap((segment, index) => index >= selection.startIndex && index <= selection.endIndex ? [{ segment, index }] : [])
    : currentSection.cuts;
  const visibleSections = sections.filter(section => cuts.some(cut => section.sectionIds.includes(cut.segment.sectionId)));
  const selectionLabel = visibleSections.length === 1 ? visibleSections[0]!.label : `${visibleSections[0]!.label} – ${visibleSections.at(-1)!.label}`;
  const canArrange = (segment: EditPlanPreviewSegment) => Boolean(segment.placementId)
    && !previewSegments.some(other => other !== segment && other.placementId === segment.placementId)
    && (segment.kind === "gap" || segment.sourceClipId !== undefined);

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="text-sm font-medium text-fg-0">Whole-song rough cut</h2>
        <p className="text-xs text-fg-3">{fmt(totalDuration)} · {gapSeconds > 0 ? `${gapSeconds.toFixed(1)}s missing footage` : "All song windows have footage"} · Select above; Shift-click to extend.</p></div>
      <Button size="sm" onClick={onPlayWhole} disabled={busy}>Play whole song</Button>
    </div>

    <div className="space-y-3" aria-label="Song sections and footage">
      <Surface>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div><h3 className="text-sm font-medium text-fg-1">{selectionLabel}</h3>
            <p className="mt-1 text-xs text-fg-3">{time(cuts[0]!.segment.musicStart)}–{time(cuts.at(-1)!.segment.musicEnd)} · {cuts.length} {cuts.length === 1 ? "shot" : "shots"}</p></div>
          <Button size="sm" disabled={busy} onClick={() => onPlaySelection(cuts[0]!.index, cuts.at(-1)!.index)}>Play selection</Button>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {cuts.map(({ segment, index }) => <button key={`${segment.placementId}:${index}`} type="button" aria-pressed={index === selectedIndex}
            onClick={() => onActiveClip(index)} aria-label={`Review shot ${index + 1}: ${segment.label}`}
            className={`w-40 shrink-0 overflow-hidden rounded-md border text-left ${index === selectedIndex ? "border-accent bg-accent-tint" : segment.kind === "gap" ? "border-dashed border-warn-lo bg-warn-tint" : "border-line bg-ink-1 hover:border-line-3"}`}>
            <div className="relative aspect-video bg-ink-0">
              {segment.kind !== "gap" && segment.thumbnailUrl ?
                // eslint-disable-next-line @next/next/no-img-element
                <img src={segment.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                : <span className="flex h-full items-center justify-center text-xs text-warn">Missing footage</span>}
              <span className="absolute left-1 top-1 rounded-sm bg-ink-0/80 px-1 text-xs text-fg-1">{index + 1}</span>
            </div>
            <div className="p-2"><p className="line-clamp-2 text-xs text-fg-2">{segment.kind === "gap" ? "Hole to fill" : segment.storyDirection ?? segment.sourceRefLabel ?? "Supplied shot"}</p>
              <p className="mt-1 font-mono text-xs text-fg-3">{(segment.musicEnd - segment.musicStart).toFixed(1)}s · {time(segment.musicStart)}</p></div>
          </button>)}
        </div>
      </Surface>
    </div>

    <Surface aria-label="Selected rough-cut placement">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="text-sm font-medium text-fg-0">{currentSection.label} · Selected shot</h3>
          <p className="mt-1 text-xs text-fg-3">Song {time(selected.musicStart)}–{time(selected.musicEnd)}</p>
          <p className="mt-2 text-sm text-fg-2">{selected.storyDirection ?? selected.gapReason ?? "Review this shot in the surrounding sequence."}</p></div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onFillGap(selectedIndex)} disabled={busy}>{selected.kind === "gap" ? "Fill this hole" : "Supply another shot"}</Button>
        </div>
      </div>
      {selected.kind === "gap" ? <p className="mt-2 text-xs text-warn">{selected.gapReason} · This window stays in the preview.</p> : null}
      <details className="mt-4" key={selected.placementId ?? selectedIndex}><summary className="cursor-pointer text-sm text-fg-2">Edit selected shot · replace, swap or remove</summary>
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
        <Button size="sm" disabled={busy || !canArrange(selected) || selected.kind === "gap"} onClick={() => onRemove(selectedIndex)}>Remove from cut</Button>
        <Button size="sm" disabled={busy || !canUndo} onClick={onUndo}>Undo arrangement</Button>
      </div>
      <p className="mt-2 text-xs text-fg-3">Song timing stays fixed. Story fit is advisory. Any trim or remaining hole is shown before applying a swap. Removing a clip leaves a hole and keeps the original in your library.</p>
      {!canArrange(selected) ? <p className="mt-2 text-xs text-fg-3">Review this supplied-shot approval in Generate before moving its window.</p> : null}
      </details>
      {selected.kind !== "gap" && selected.musicEnd - selected.musicStart < 3.999 ? <p className="mt-3 text-xs text-warn">This saved piece is shorter than the new four-second minimum. It has been kept for your review; changing cut pace does not silently replace accepted footage.</p> : null}
      {editMessage ? <p role="status" className="mt-3 text-sm text-fg-2">{editMessage}</p> : null}
      {proposalSummary ? <div className="mt-3 rounded-md border border-review-lo bg-review-tint p-3">
        <p className="text-sm text-fg-1">{proposalSummary}</p>
        <div className="mt-3 flex gap-2"><Button size="sm" disabled={busy} onClick={onApplyProposal}>Apply arrangement</Button><Button size="sm" onClick={onCancelProposal}>Cancel change</Button></div>
      </div> : null}
    </Surface>


  </div>;
}

function time(value: number) {
  const safe = Math.max(0, value);
  return `${Math.floor(safe / 60)}:${(safe % 60).toFixed(1).padStart(4, "0")}`;
}
