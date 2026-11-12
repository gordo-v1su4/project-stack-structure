"use client";
import { useEffect, useRef, useState } from "react";
import type { ReplacementOperation, ReplacementReviewSnapshot, ReplacementTarget } from "./replacementReview";
import type { SongRange } from "./reviewSelection";
import { Button, Surface } from "./ui";

/** Separate review metadata; marking never saves the cut or submits generation. */
export function ReplacementReviewPanel({ projectId, targets, ranges }: { projectId: string; targets: ReplacementTarget[]; ranges: SongRange[] }) {
  const [snapshot, setSnapshot] = useState<ReplacementReviewSnapshot | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false), [limit, setLimit] = useState(40);
  const alive = useRef(true), controller = useRef<AbortController | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  const selected = targets.filter(target => ranges.some(range => target.end > range.start && target.start < range.end));
  const savedKeys = snapshot ? new Set(snapshot.targets.map(target => target.key)) : null;
  const currentKeys = new Set(targets.filter(target => !savedKeys || savedKeys.has(target.key)).map(target => target.key));
  const selectionStale = selected.some(target => !currentKeys.has(target.key));
  const currentMarks = snapshot?.marks.filter(mark => currentKeys.has(mark.key)) ?? [];
  async function request(operation?: ReplacementOperation) {
    if (busy) return;
    setBusy(true); setError("");
    const abort = new AbortController(); controller.current = abort;
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]);
    const url = `/api/studio/projects/${encodeURIComponent(projectId)}/replacement-review`;
    async function read(response: Response) {
      let body;
      try { body = await response.json(); } catch { throw new Error("Review marks are unavailable. Refresh marks before retrying."); }
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status) && alive.current) setSnapshot(null);
        throw new Error(typeof body.error === "string" ? body.error : "Review marks are unavailable.");
      }
      if (body.projectId !== projectId || !Array.isArray(body.marks) || !Array.isArray(body.targets)) throw new Error("Review marks belong to another project.");
      return body as ReplacementReviewSnapshot;
    }
    try {
      const starting = operation && snapshot ? snapshot : await read(await fetch(url, { cache: "no-store", signal }));
      const next = operation ? await read(await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: starting.revision, operation }), signal })) : starting;
      if (alive.current) {
        setSnapshot(next);
        if (operation) setNotes(current => {
          const next = { ...current };
          for (const key of operation.keys) if (operation.action === "unmark" || (operation.action === "note" && current[key] === operation.note)) delete next[key];
          return next;
        });
      }
    } catch (failure) { if (alive.current) setError((failure as Error).message); }
    finally { if (alive.current) setBusy(false); }
  }
  return <Surface className="space-y-2" aria-label="Replacement review">
    <div className="flex flex-wrap items-center gap-2"><Button size="sm" disabled={busy || !selected.length || selectionStale} onClick={() => void request({ action: "mark", keys: selected.map(target => target.key) })}>
      Mark selected for replacement{selected.length ? ` (${selected.length})` : ""}</Button>
      <Button size="sm" disabled={busy || !selected.length} onClick={() => void request({ action: "unmark", keys: selected.map(target => target.key) })}>Unmark selected</Button>
      <span role="status" className="text-xs text-fg-3">{busy ? "Updating review marks…" : snapshot ? `${currentMarks.length} current · ${snapshot.marks.length - currentMarks.length} stale marks` : "Marks load when requested"}</span>
    </div>
    <p className="text-xs text-fg-3">Marks and notes are saved separately from your cut. Marking does not render, reject or replace footage.</p>
    {selectionStale ? <p className="text-xs text-warn">This view and the saved shot plan differ. Save or reload the current plan before marking this selection.</p> : null}
    {error ? <p role="alert" className="text-xs text-warn">{error}</p> : null}
    <details open={open} onToggle={event => { setOpen(event.currentTarget.open); if (event.currentTarget.open && !snapshot && !busy) void request(); }}>
      <summary className="cursor-pointer text-sm text-fg-2">Review marked shots{snapshot ? ` (${snapshot.marks.length})` : ""}</summary>
      {open ? <div className="mt-2 space-y-2"><Button size="sm" disabled={busy} onClick={() => void request()}>Refresh marks</Button>
        <Button size="sm" disabled={busy || !snapshot?.marks.some(mark => !currentKeys.has(mark.key))}
          onClick={() => void request({ action: "unmark", keys: snapshot?.marks.filter(mark => !currentKeys.has(mark.key)).map(mark => mark.key) ?? [] })}>Clear stale marks</Button>
        {snapshot && !snapshot.marks.length ? <p className="text-xs text-fg-3">No shots marked. Select cuts or sections, then mark them above.</p> : null}
        <ol className="max-h-96 space-y-2 overflow-y-auto" aria-label="Marked shots">{snapshot?.marks.slice(0, limit).map(mark => <li key={mark.key} className="space-y-2 rounded-sm border border-line p-2 text-xs">
          <p className={currentKeys.has(mark.key) ? "text-fg-1" : "text-warn"}>{mark.shotId ?? mark.label} · {mark.start.toFixed(2)}–{mark.end.toFixed(2)}s · {currentKeys.has(mark.key) ? "Current shot" : "Plan or references changed · review again"}</p>
          <label className="block text-fg-3">Replacement notes<textarea aria-label={`Replacement notes for ${mark.shotId ?? mark.label}`} maxLength={2000}
            value={notes[mark.key] ?? mark.note} onChange={event => setNotes(current => ({ ...current, [mark.key]: event.target.value }))}
            className="mt-1 w-full rounded-sm border border-line bg-ink-1 p-2 text-fg-1" /></label>
          <div className="flex gap-2"><Button size="sm" disabled={busy || (notes[mark.key] ?? mark.note) === mark.note}
            onClick={() => void request({ action: "note", keys: [mark.key], note: notes[mark.key] ?? mark.note })}>Save notes</Button>
            <Button size="sm" disabled={busy} onClick={() => void request({ action: "unmark", keys: [mark.key] })}>Unmark shot</Button></div>
        </li>)}</ol>
        {snapshot && snapshot.marks.length > limit ? <Button size="sm" onClick={() => setLimit(n => n + 40)}>Show more marked shots</Button> : null}
      </div> : null}
    </details>
  </Surface>;
}
