"use client";

import { useMemo, useState } from "react";
import type { AnimaticPreviewSnapshot } from "./animaticPreviewSnapshot";
import { animaticReviewBinding } from "./animaticReview";
import { Button, Surface } from "./ui";
import type { StillAnimaticPlan } from "./stillAnimatic";

export function AnimaticReviewPanel({ snapshot, onSaved }: { snapshot: AnimaticPreviewSnapshot;
  onSaved: (revision: string, review: NonNullable<StillAnimaticPlan["review"]>, expectedRevision: string) => void }) {
  const binding = useMemo(() => snapshot.plan ? animaticReviewBinding(snapshot.plan, snapshot.contextSha256, snapshot.audioUrl) : null,
    [snapshot.plan, snapshot.contextSha256, snapshot.audioUrl]);
  return <Review key={binding ?? "incomplete"} snapshot={snapshot} binding={binding} onSaved={onSaved} />;
}

function Review({ snapshot, binding, onSaved }: Parameters<typeof AnimaticReviewPanel>[0] & { binding: string | null }) {
  const [confirmed, setConfirmed] = useState(false), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const review = snapshot.plan?.review, current = binding && review?.bindingSha256 === binding;
  async function save(status: "approved" | "revise") {
    if (!confirmed || !binding || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/studio/projects/${encodeURIComponent(snapshot.projectId)}/preview/review`, {
        method: "POST", headers: { "content-type": "application/json", "if-match": snapshot.revision },
        body: JSON.stringify({ bindingSha256: binding, status, note }), signal: AbortSignal.timeout(30_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The review could not be saved.");
      onSaved(result.revision, result.review, snapshot.revision);
      setConfirmed(false);
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <Surface className="space-y-3" aria-label="Animatic direction review">
    <h2 className="text-sm font-medium text-fg-0">Review the full-song animatic</h2>
    <p className="text-sm text-fg-3">Motion takes and the final cut have separate reviews.</p>
    {!binding ? <p className="text-sm text-fg-3">Review becomes available when every shot has a current image.</p> : <>
      {current ? <p role="status" className="text-sm text-fg-2">{review.status === "approved" ? "Still direction approved" : "Revisions requested"}{review.note ? ` · ${review.note}` : ""}</p>
        : review ? <p role="status" className="text-sm text-warn">The images or timing changed since the last review.</p> : null}
      <label className="flex items-center gap-2 text-sm text-fg-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />I have reviewed every shot with the full song.</label>
      <label className="block text-sm text-fg-2">Review notes<textarea value={note} disabled={busy} maxLength={2000} onChange={e => setNote(e.target.value)} className="mt-1 block w-full rounded-md border border-line bg-ink-0 p-2 text-fg-1" rows={2} /></label>
      <div className="flex flex-wrap gap-2"><Button disabled={!confirmed || busy} onClick={() => void save("approved")}>Approve still direction</Button>
        <Button disabled={!confirmed || busy} onClick={() => void save("revise")}>Request revisions</Button></div>
    </>}
    {error ? <p role="alert" className="text-sm text-warn">{error}</p> : null}
  </Surface>;
}
