"use client";
import { useRef, useState, useEffect } from "react";
import type { ReplacementReviewSnapshot } from "./replacementReview";
import { readReplacementMarks } from "./replacementBatch";
import { Button, Surface } from "./ui";

export function ReplacementBatchPanel({ projectId, blocked, onPrepare, onSubmit }: {
  projectId: string; blocked: boolean; onPrepare: (snapshot: ReplacementReviewSnapshot) => void;
  onSubmit: (snapshot: ReplacementReviewSnapshot) => Promise<void>;
}) {
  const [prepared, setPrepared] = useState<ReplacementReviewSnapshot | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [confirmed, setConfirmed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), alive = useRef(true), lock = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (prepared) dialog.current?.showModal(); else dialog.current?.close(); }, [prepared]);
  async function prepare() {
    if (lock.current || blocked) return;
    lock.current = true; setBusy(true); setError(""); setConfirmed(false);
    try { const snapshot = await readReplacementMarks(projectId); onPrepare(snapshot); if (alive.current) setPrepared(snapshot); }
    catch (failure) { if (alive.current) setError((failure as Error).message); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  async function submit() {
    if (lock.current || blocked || !prepared || !confirmed) return;
    lock.current = true; setBusy(true); setError("");
    try { await onSubmit(prepared); if (alive.current) setPrepared(null); }
    catch (failure) { if (alive.current) { setError((failure as Error).message); setPrepared(null); } }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return <Surface aria-label="Replacement batch" className="space-y-2">
    <h3 className="text-sm font-semibold">Replace marked shots</h3>
    <p className="text-xs text-fg-3">Prepare refreshes saved marks and checks exact destinations. It creates no footage. Replacement takes keep prior takes and require explicit selection and separate approval.</p>
    <Button disabled={blocked || busy} onClick={() => void prepare()}>Prepare marked replacements</Button>
    {blocked ? <p className="text-xs text-fg-3">Confirm Story and finish or clear existing requests before preparing replacements.</p> : null}
    {error ? <p role="alert" className="text-xs text-warn">{error}</p> : null}
    <dialog ref={dialog} onCancel={event => { if (busy) event.preventDefault(); else setPrepared(null); }} className="m-auto max-h-[80vh] w-full max-w-xl overflow-y-auto rounded-md border border-line bg-ink-2 p-4 text-fg-1 backdrop:bg-black/70">
      {prepared ? <div className="space-y-3"><h3 className="text-lg">Review replacement batch</h3>
        <p className="text-sm">{prepared.marks.length} exact shots · local MiniMax H3. Submission uses the existing authenticated generation and current Story/reference review gates. Marks and the current cut stay unchanged.</p>
        <p className="text-xs text-fg-3">Uses confirmed Story directions and reviewed images. Replacement notes remain review notes; revise Story first to change motion direction.</p>
        <ol className="max-h-64 space-y-2 overflow-y-auto text-xs">{prepared.marks.map(mark => <li key={mark.key}>{mark.shotId ?? mark.label} · {mark.start.toFixed(2)}–{mark.end.toFixed(2)}s{mark.note ? ` · ${mark.note}` : ""}</li>)}</ol>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />I authorize generation of these replacement shots; selection and approval remain separate.</label>
        <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => setPrepared(null)}>Cancel replacement batch</Button>
          <Button variant="primary" disabled={busy || blocked || !confirmed} onClick={() => void submit()}>Submit {prepared.marks.length} replacement shots</Button></div>
      </div> : null}
    </dialog>
  </Surface>;
}
