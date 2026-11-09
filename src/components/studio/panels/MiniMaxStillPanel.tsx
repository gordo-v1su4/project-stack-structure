"use client";
/* eslint-disable @next/next/no-img-element -- Review the actual stored pixels through the authenticated media route, without image optimization. */
import { useEffect, useRef, useState } from "react";
import type { H3GenerationRequest } from "../h3Generation";
import type { H3FirstFrameChoice } from "../h3FirstFrame";
import type { H3StillJob } from "@/lib/h3StillJobStore";
import { acknowledgeStillClientRecord, releaseRejectedStillRecord, buildStillContinuation, canCreateStill, isStillTerminal, parseStillClientRecord, sameStillFutureCreative, StillClientAdmissionError, stillClientRequest, stillClientStorageKey, stillMediaUrl, type StillClientRecord } from "../h3StillClient";
import { Button, StatusDot } from "../ui";

export function MiniMaxStillPanel({ projectId, context, disabled, prepareShot, onUse }: {
  projectId: string | null; context: string; disabled: boolean;
  prepareShot: () => Promise<H3GenerationRequest>;
  onUse: (selection: { shot: H3GenerationRequest; conditioning: H3FirstFrameChoice }) => void;
}) {
  const [prose, setProse] = useState("");
  const [record, setRecord] = useState<StillClientRecord | null>(null);
  const [job, setJob] = useState<H3StillJob | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const live = useRef({ projectId, context, disabled }); live.current = { projectId, context, disabled };
  const serial = useRef(0);
  const activeRequest = useRef(false);
  const pollFailures = useRef(0), [pollTick, setPollTick] = useState(0);
  useEffect(() => {
    const generation = ++serial.current;
    setRecord(null); setJob(null); setError(null); setBusy(false);
    activeRequest.current = false; pollFailures.current = 0;
    try {
      const saved = projectId ? parseStillClientRecord(JSON.parse(localStorage.getItem(stillClientStorageKey(projectId)) ?? "null"), projectId) : null;
      if (saved) {
        setRecord(saved);
        void stillClientRequest("GET", saved).then(value => {
          const acknowledged = { ...saved, jobId: value.id };
          const accepted = acknowledgeStillClientRecord(localStorage, acknowledged);
          if (accepted && serial.current === generation) { setRecord(acknowledged); setJob(value); }
        }).catch(failure => { if (serial.current === generation) {
          if (failure instanceof StillClientAdmissionError && releaseRejectedStillRecord(localStorage, saved)) { setRecord(null); setJob(null); }
          setError((failure as Error).message);
        } });
      }
    } catch { setError("The saved still could not be restored."); }
    return () => { serial.current = generation + 1; };
  }, [projectId]);
  useEffect(() => {
    if (!record?.jobId || !job || isStillTerminal(job.state)) return;
    const generation = serial.current;
    const timer = setTimeout(() => {
      if (activeRequest.current) { setPollTick(value => value + 1); return; }
      void stillClientRequest("GET", record).then(value => { if (acknowledgeStillClientRecord(localStorage, { ...record, jobId: value.id }) && serial.current === generation) setJob(value); })
        .catch(failure => { if (serial.current === generation) { setError((failure as Error).message); if (++pollFailures.current < 5) setPollTick(value => value + 1); } });
    }, 5000);
    return () => clearTimeout(timer);
  }, [record, job, pollTick]);
  const save = (next: StillClientRecord) => { localStorage.setItem(stillClientStorageKey(next.projectId), JSON.stringify(next)); setRecord(next); };
  const current = record?.projectId === projectId && record.context === context;
  async function generate() {
    if (activeRequest.current || busy || disabled || !projectId || !prose.trim() || !canCreateStill(record, job)) return;
    activeRequest.current = true;
    setBusy(true); setError(null); const start = live.current, generation = serial.current;
    let pending: StillClientRecord | null = null;
    try {
      const proposed = await prepareShot();
      if (live.current.context !== start.context || live.current.projectId !== start.projectId || live.current.disabled) throw new Error("The shot changed before still submission.");
      const retry = current && record && job && isStillTerminal(job.state) && record.request.attempt < 2 && sameStillFutureCreative(record.request.shot, proposed);
      const shot = retry ? record.request.shot : proposed;
      const next: StillClientRecord = { version: 1, projectId: shot.projectId, context: start.context,
        request: { shot, creativePrompt: prose.trim(), seed: crypto.getRandomValues(new Uint32Array(1))[0],
          requestIntentId: retry ? record.request.requestIntentId : crypto.randomUUID(), attempt: retry ? record.request.attempt + 1 : 0 } };
      pending = next;
      setJob(null); save(next); // New intent invalidates the old preview before one POST; lost ACK cannot expose another attempt.
      const value = await stillClientRequest("POST", next);
      const acknowledged = { ...next, jobId: value.id };
      const accepted = acknowledgeStillClientRecord(localStorage, acknowledged);
      if (accepted && serial.current === generation) { setRecord(acknowledged); setJob(value); }
    } catch (failure) {
      if (serial.current === generation) {
        if (failure instanceof StillClientAdmissionError && pending && releaseRejectedStillRecord(localStorage, pending)) { setRecord(null); setJob(null); }
        setError((failure as Error).message);
      }
    }
    finally { if (serial.current === generation) { activeRequest.current = false; setBusy(false); } }
  }
  async function observe(method: "GET" | "PATCH" | "DELETE") {
    if (!record || busy || activeRequest.current) return;
    activeRequest.current = true;
    pollFailures.current = 0;
    setBusy(true); setError(null); const generation = serial.current;
    try { const value = await stillClientRequest(method, record); const acknowledged = { ...record, jobId: value.id };
      if (acknowledgeStillClientRecord(localStorage, acknowledged) && serial.current === generation) { setRecord(acknowledged); setJob(value); } }
    catch (failure) { if (serial.current === generation) {
      if (failure instanceof StillClientAdmissionError && releaseRejectedStillRecord(localStorage, record)) { setRecord(null); setJob(null); }
      setError((failure as Error).message);
    } }
    finally { if (serial.current === generation) { activeRequest.current = false; setBusy(false); } }
  }
  return <details className="rounded-md border border-line bg-ink-1 p-3">
    <summary className="cursor-pointer text-sm text-fg-1">Prepare a MiniMax first frame</summary>
    <div className="mt-3 space-y-3">
      <p className="text-xs text-fg-3">Describe the opening image separately from the video motion. Named character and environment references guide the still. Shot/style references require a later continuation update.</p>
      <label className="block text-xs text-fg-3">Opening image<input aria-label="MiniMax still opening image" value={prose} onChange={event => setProse(event.target.value)} maxLength={6000} disabled={busy || disabled} className="mt-1 block w-full rounded-md border border-line bg-ink-0 p-2 text-sm text-fg-1" /></label>
      <Button size="sm" disabled={busy || disabled || !projectId || !prose.trim() || !canCreateStill(record, job)} onClick={() => void generate()}>{job && isStillTerminal(job.state) ? "Generate another still" : "Generate still"}</Button>
      {record ? <div className="space-y-2 text-xs text-fg-3">
        <p><StatusDot tone={job?.state === "ready" ? "review" : job?.state === "failed" ? "failed" : "processing"} /> {job?.state ?? "Submission unconfirmed"} · still attempt {record.request.attempt + 1}/3</p>
        <p>Frozen opening image: {record.request.creativePrompt}</p>
        <p>Frozen video: {record.request.shot.songStart.toFixed(3)}–{record.request.shot.songEnd.toFixed(3)}s · {record.request.shot.prompt}</p>
        {!current ? <p role="status">This saved still belongs to an earlier shot context. Review or cancel it; it cannot be applied here.</p> : null}
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" disabled={busy} onClick={() => void observe("GET")}>Refresh status</Button>
          {record.jobId && job && !isStillTerminal(job.state) ? <><Button size="sm" variant="ghost" disabled={busy} onClick={() => void observe("PATCH")}>Reconcile existing render</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void observe("DELETE")}>Cancel this still</Button></> : null}</div>
        {job?.state === "ready" && job.result ? <><div className="grid gap-2 sm:grid-cols-2">{([['Master', job.result.master], ['Video input', job.result.native]] as const).map(([label, image]) => <a key={label} href={stillMediaUrl(image)} target="_blank" rel="noreferrer" className="block"><span>{label}</span><img src={stillMediaUrl(image)} alt={`${label} MiniMax still for this shot`} className="mt-1 w-full rounded-sm" /></a>)}</div>
          <p>Review both images. Using this frame prepares the frozen video request; identity screening and video generation remain separate.</p>
          <Button size="sm" disabled={disabled || busy || !current} onClick={() => { try { onUse(buildStillContinuation(record, job, context)); } catch (failure) { setError((failure as Error).message); } }}>Use for this shot</Button></> : null}
      </div> : null}
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
    </div>
  </details>;
}
