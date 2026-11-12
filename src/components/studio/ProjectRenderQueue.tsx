"use client";
import { useEffect, useState } from "react";
import { isProjectWorkActive, type ProjectWorkSnapshot } from "./projectWorkSnapshot";
import { WorkActivity } from "./WorkActivity";
import { Button, StatusDot, Surface, type StatusTone } from "./ui";

export function ProjectRenderQueue({ projectId, revision, shotIds, onInspectShot }: {
  projectId: string; revision: string; shotIds: string[]; onInspectShot: (id: string) => void;
}) {
  const [open, setOpen] = useState(false), [history, setHistory] = useState(false), [limit, setLimit] = useState(100);
  const [snapshot, setSnapshot] = useState<ProjectWorkSnapshot | null>(null), [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => { if (window.location.hash === "#queue") setOpen(true); }, []);
  useEffect(() => {
    if (!open) return;
    let active = true, busy = false, timer: ReturnType<typeof setTimeout>, etag = "";
    const controller = new AbortController();
    async function refresh() {
      if (!active || busy || document.hidden) return;
      busy = true;
      try {
        const response = await fetch(`/api/studio/projects/${encodeURIComponent(projectId)}/work`, {
          cache: "no-store", headers: etag ? { "if-none-match": etag } : {},
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
        });
        if (response.status !== 304) {
          if (!response.ok) {
            if ([401, 403, 404].includes(response.status) && active) setSnapshot(null);
            throw new Error("Render receipts are unavailable. Playback is unaffected; retry to check the queue.");
          }
          const next = await response.json() as ProjectWorkSnapshot;
          if (next.projectId !== projectId) throw new Error("The queue response belongs to another project.");
          etag = response.headers.get("etag") ?? "";
          if (active) { setSnapshot(next); setError(""); }
        }
        if (active) setError("");
      } catch (failure) { if (active) setError((failure as Error).message); }
      finally { busy = false; if (active) timer = setTimeout(() => void refresh(), 20_000); }
    }
    function resume() { clearTimeout(timer); void refresh(); }
    void refresh(); document.addEventListener("visibilitychange", resume);
    return () => { active = false; controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", resume); };
  }, [open, projectId, revision, refreshKey]);
  const rows = (snapshot?.projectId === projectId ? snapshot.rows : []).filter(row => history || row.currentPlan);
  const running = rows.filter(isProjectWorkActive).length;
  const completed = rows.filter(row => row.state === "ready").length;
  return <Surface className="space-y-2"><details id="queue" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-sm font-medium text-fg-0">Render queue · images and videos</summary>
    {open ? <div className="mt-3 space-y-3">
      <p className="text-xs text-fg-3">Live Trigger activity is account-wide. Shot rows below show this project&apos;s last persisted render receipts. Neither view approves footage or submits work.</p>
      <WorkActivity layout="inline" />
      <div className="flex flex-wrap items-center gap-3 text-xs text-fg-2">
        <Button size="sm" onClick={() => setRefreshKey(n => n + 1)}>Refresh receipts</Button>
        <label><input type="checkbox" checked={history} onChange={event => setHistory(event.target.checked)} /> Include earlier shot plans</label>
        <span role="status">{snapshot ? `${completed} ready · ${running} unfinished · ${rows.filter(r => r.state === "failed").length} failed` : "Reading project receipts…"}</span>
      </div>
      {snapshot ? <p className="text-xs text-fg-3">Receipts read {new Date(snapshot.checkedAt).toLocaleTimeString()} · available media, selected footage and approval are separate.</p> : null}
      {error ? <p role="alert" className="text-xs text-warn">{error}</p> : null}
      {snapshot?.partial ? <p role="status" className="text-xs text-warn">Some image receipts could not be read; their state is unavailable, not inferred complete.</p> : null}
      <ol aria-label="Project render receipts" className="max-h-[55vh] space-y-1 overflow-y-auto">
        {rows.slice(0, limit).map(row => {
          const tone: StatusTone = row.state === "ready" ? "ready" : row.state === "failed" ? "failed"
            : ["unavailable", "submission_unknown"].includes(row.state) ? "review" : row.state === "queued" ? "waiting" : "processing";
          return <li key={`${row.kind}:${row.id}`} className="flex flex-wrap items-center gap-2 rounded-sm border border-line px-2 py-2 text-xs text-fg-2">
            <StatusDot tone={tone} /><span className="w-12 text-fg-3">{row.kind}</span><span className="min-w-0 max-w-[18ch] truncate font-mono">{row.shotId}</span>
            <span>{row.state.replaceAll("_", " ")}</span><span className="text-fg-3">attempt {row.attempt + 1}</span>
            {row.selected ? <span className="text-accent">Selected in cut</span> : null}
            {shotIds.includes(row.shotId) ? <Button size="sm" onClick={() => onInspectShot(row.shotId)}>Shot image</Button> : null}
            <details className="ml-auto text-fg-3"><summary className="cursor-pointer">Receipt</summary><p className="break-all font-mono">{row.id}</p>
              {row.runId ? <p className="break-all font-mono">Trigger run: {row.runId}</p> : null}<p>{row.updatedAt || "Awaiting a durable job receipt"}</p></details>
          </li>;
        })}
      </ol>
      {rows.length > limit ? <Button size="sm" onClick={() => setLimit(n => n + 100)}>Show more receipts</Button> : null}
      {snapshot && !rows.length ? <p className="text-xs text-fg-3">No receipts for this shot plan. Include earlier plans to inspect retained work.</p> : null}
      {snapshot && snapshot.total > snapshot.rows.length ? <p className="text-xs text-fg-3">Showing {snapshot.rows.length} of {snapshot.total} retained receipts.</p> : null}
    </div> : null}
  </details></Surface>;
}
