"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Surface } from "./ui";
import { reviewBackfillActive, reviewBackfillCounts, type ReviewBackfillInput, type ReviewBackfillSnapshot } from "./reviewBackfill";
import { publishReviewPoster } from "./reviewPosterArrivals";

type Intent = { intentId: string; sources: ReviewBackfillInput[] };
const storageKey = (projectId: string) => `review-preparation-v1:${projectId}`;
function savedIntent(projectId: string): Intent | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey(projectId)) ?? "null");
    return value && /^[a-f0-9-]{36}$/i.test(value.intentId) && Array.isArray(value.sources) && value.sources.length <= 256 ? value : null;
  } catch { return null; }
}

/** Independent job receipts: never polls, saves or replaces the open film draft. */
export function ReviewPreparationPanel({ projectId, sources }: { projectId: string; sources: ReviewBackfillInput[] }) {
  const [job, setJob] = useState<ReviewBackfillSnapshot | null>(null), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [refresh, setRefresh] = useState(0);
  const pending = useRef<Intent | null>(null), submit = useRef<AbortController | null>(null);
  const endpoint = `/api/studio/projects/${encodeURIComponent(projectId)}/review-preparation`;
  const arrived = useRef({ jobId: "", keys: new Set<string>() });
  function accept(next: ReviewBackfillSnapshot | null) {
    if (next && next.projectId !== projectId) throw new Error("Preparation belongs to another project.");
    setJob(next);
    if (!next) return;
    if (arrived.current.jobId !== next.id) arrived.current = { jobId: next.id, keys: new Set() };
    for (const row of next.rows) if (row.state === "ready" && row.posterKey && !arrived.current.keys.has(`${row.id}:${row.posterKey}`)) {
      arrived.current.keys.add(`${row.id}:${row.posterKey}`);
      publishReviewPoster({ ...row.source, posterKey: row.posterKey });
    }
    if (next.status !== "dispatch_unknown") {
      pending.current = null; setUncertain(false);
      try { sessionStorage.removeItem(storageKey(projectId)); } catch { /* The durable receipt remains authoritative. */ }
    } else { pending.current = { intentId: next.id, sources: next.rows.map(row => row.source) }; setUncertain(true); }
  }
  useEffect(() => {
    pending.current = savedIntent(projectId); setUncertain(Boolean(pending.current));
    let disposed = false, timer: ReturnType<typeof setTimeout> | undefined, running = false, revision = "";
    const controller = new AbortController(); let requestController: AbortController | undefined;
    async function poll() {
      if (disposed || document.hidden || running) return;
      running = true; let again = false;
      try {
        requestController = new AbortController();
        const id = pending.current?.intentId;
        const response = await fetch(`${endpoint}${id ? `?jobId=${encodeURIComponent(id)}` : ""}`, { cache: "no-store",
          headers: revision ? { "if-none-match": revision } : {}, signal: AbortSignal.any([controller.signal, requestController.signal, AbortSignal.timeout(20_000)]) });
        if (disposed) return;
        if (response.status === 304) again = true;
        else {
          if (!response.ok) throw new Error("Review preparation updates are unavailable. Reconnect to check the same request.");
          const body = await response.json(); if (disposed) return;
          accept(body.preparation); revision = response.headers.get("etag") ?? "";
          again = body.preparation && reviewBackfillActive(body.preparation.status) && body.preparation.status !== "dispatch_unknown";
        }
        setError("");
      } catch (failure) { if (!disposed && !document.hidden) setError((failure as Error).message); }
      finally { running = false; if (!disposed && again) timer = setTimeout(() => void poll(), 2500); }
    }
    function resume() { clearTimeout(timer); if (document.hidden) { requestController?.abort(); return; } revision = ""; void poll(); }
    void poll(); document.addEventListener("visibilitychange", resume);
    return () => { disposed = true; controller.abort(); submit.current?.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", resume); };
    // A remount/explicit reconnect starts compact observation; changing the cut does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, endpoint, refresh]);

  async function prepare() {
    if (busy) return;
    const intent = pending.current ?? { intentId: crypto.randomUUID(), sources };
    if (!intent.sources.length || intent.sources.length > 256) return;
    pending.current = intent;
    try { sessionStorage.setItem(storageKey(projectId), JSON.stringify(intent)); } catch { /* In-memory request still retains exact intent and sources. */ }
    const controller = new AbortController(); submit.current = controller;
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(intent),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
      if (!response.ok) throw new Error("Preparation dispatch is not confirmed. Reconnect the same request.");
      const body = await response.json(); if (controller.signal.aborted) return;
      accept(body.preparation); setRefresh(value => value + 1);
    } catch (failure) { if (!controller.signal.aborted) { setUncertain(true); setError((failure as Error).message); } }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const counts = job ? reviewBackfillCounts(job.rows) : null, active = Boolean(job && reviewBackfillActive(job.status));
  return <Surface className="space-y-2" aria-label="Review media preparation">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><p className="text-sm text-fg-1">Lightweight review copies</p>
        <p role="status" className="text-xs text-fg-3">{counts ? `${counts.ready}/${counts.total} ready · ${counts.active} preparing · ${counts.waiting} waiting${counts.failed ? ` · ${counts.failed} unavailable` : ""}` : `${sources.length} stored videos`}</p></div>
      <div className="flex gap-2"><Button disabled={busy || (active && !uncertain) || (!uncertain && (!sources.length || sources.length > 256))} onClick={() => void prepare()}>
        {busy ? "Connecting…" : uncertain ? "Reconnect same request" : active ? "Preparing review copies…" : job && job.status !== "ready" ? "Retry unfinished copies" : "Prepare review copies"}</Button>
        {error && !uncertain ? <Button onClick={() => setRefresh(value => value + 1)}>Reconnect updates</Button> : null}</div>
    </div>
    <p className="text-xs text-fg-3">Silent proxies, posters and scrub sheets. Originals and cut approval stay unchanged.{counts?.failed ? " Unavailable copies keep the explicit original inspection path." : ""}</p>
    {sources.length > 256 ? <p className="text-xs text-warn">This film exceeds the 256-video preparation limit. Individual clip preview remains available.</p> : null}
    {job?.status === "ready" ? <p className="text-xs text-ok">Review copies stored.</p> : null}
    {job && ["failed", "cancelled", "partial"].includes(job.status) ? <p className="text-xs text-warn">Preparation finished with unavailable copies. Retry unfinished copies or inspect the originals.</p> : null}
    {error ? <p role="alert" className="text-xs text-warn">{error}</p> : null}
  </Surface>;
}
