"use client";
/* eslint-disable @next/next/no-img-element -- Review the actual stored pixels through the authenticated media route, without image optimization. */
import { useEffect, useRef, useState } from "react";
import type { H3GenerationRequest } from "../h3Generation";
import type { H3FirstFrameChoice } from "../h3FirstFrame";
import type { H3StillJob } from "@/lib/h3StillJobStore";
import { acknowledgeStillClientRecord, releaseRejectedStillRecord, buildStillContinuation, canCreateStill, isStillTerminal, parseStillClientRecord, sameStillFutureCreative, StillClientAdmissionError, stillClientRequest, stillClientStorageKey, stillClientRecordBinding, submitStillClientIntent, stillMediaUrl, type StillClientRecord } from "../h3StillClient";
import { Button, StatusDot } from "../ui";
import type { SceneProofBinding } from "../sceneProofs";

export type MiniMaxStillPanelProps = {
  projectId: string | null; context: string; disabled: boolean;
  prepareShot: () => Promise<H3GenerationRequest>;
  onUse?: (selection: { shot: H3GenerationRequest; conditioning: H3FirstFrameChoice }) => void;
  /** Omit for backwards-compatible one-shot storage. Use a stable scene/moment ID for proofs. */
  storageScope?: string;
  sceneProof?: SceneProofBinding;
  /** Supplied durable authority, including null for an explicitly empty moment. */
  suppliedRecord?: StillClientRecord | null;
  creativePrompt?: string; initialCreativePrompt?: string;
  /** Compile the visible form with current scene direction without rewriting the form. */
  compileCreativePrompt?: (prose: string) => string;
  onCreativePromptChange?: (value: string) => void;
  /** Awaited before POST and before installing an acknowledged job. Rejection fails closed. */
  onRecord?: (record: StillClientRecord | null) => void | Promise<void>;
  onJob?: (job: H3StillJob, record: StillClientRecord) => void | Promise<void>;
  hideVideoAction?: boolean;
  labels?: { heading?: string; description?: string; prompt?: string; generate?: string; regenerate?: string; use?: string };
};

export function MiniMaxStillPanel(props: MiniMaxStillPanelProps) {
  const { projectId, context, disabled, prepareShot, onUse, storageScope, suppliedRecord, labels } = props;
  const [localProse, setProse] = useState(props.initialCreativePrompt ?? "");
  const prose = props.creativePrompt ?? localProse;
  const [record, setRecord] = useState<StillClientRecord | null>(null);
  const [job, setJob] = useState<H3StillJob | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const live = useRef(props); live.current = props;
  const serial = useRef(0), recordRef = useRef<StillClientRecord | null>(null);
  const activeRequest = useRef(false), pendingPersistence = useRef<StillClientRecord | null>(null);
  const pollFailures = useRef(0), [pollTick, setPollTick] = useState(0);
  const mountedScope = useRef<string | null>(null);
  const mountedContext = useRef<string | null>(null);
  const scope = JSON.stringify([projectId, storageScope ?? null]);
  const suppliedKey = suppliedRecord === undefined ? undefined : JSON.stringify(suppliedRecord);
  function installRecord(next: StillClientRecord | null) { recordRef.current = next; setRecord(next); }
  function current(generation: number, start: MiniMaxStillPanelProps) {
    return serial.current === generation && live.current.projectId === start.projectId
      && live.current.storageScope === start.storageScope && live.current.context === start.context;
  }
  async function accept(value: H3StillJob, saved: StillClientRecord, generation: number, start: MiniMaxStillPanelProps) {
    if (!current(generation, start)) return;
    const acknowledged = { ...saved, jobId: value.id };
    // Guard the owning record before and after any asynchronous project save.
    const matches = () => recordRef.current && stillClientRecordBinding(recordRef.current) === stillClientRecordBinding(saved)
      && (!recordRef.current.jobId || recordRef.current.jobId === value.id);
    if (!matches()) return;
    pendingPersistence.current = acknowledged;
    try {
      if (recordRef.current?.jobId !== value.id) await start.onRecord?.(acknowledged);
      if (!current(generation, start) || !matches()) return;
      if (!acknowledgeStillClientRecord(localStorage, acknowledged, start.storageScope)) return;
      installRecord(acknowledged); setJob(value);
      await start.onJob?.(value, acknowledged);
    } finally { if (pendingPersistence.current === acknowledged) pendingPersistence.current = null; }
  }
  async function releaseRejected(saved: StillClientRecord, generation: number, start: MiniMaxStillPanelProps) {
    if (!current(generation, start) || !releaseRejectedStillRecord(localStorage, saved, start.storageScope)) return;
    await start.onRecord?.(null);
    if (current(generation, start)) { installRecord(null); setJob(null); }
  }
  useEffect(() => {
    const start = live.current;
    // A parent echo of our awaited durable save is not a new mounted request.
    const supplied = suppliedRecord === undefined ? undefined : projectId ? parseStillClientRecord(suppliedRecord, projectId) : null;
    const existing = recordRef.current, pending = pendingPersistence.current;
    if (mountedScope.current === scope && mountedContext.current === context) {
      if (supplied === undefined) return;
      if (supplied && existing && stillClientRecordBinding(existing) === stillClientRecordBinding(supplied) && existing.jobId === supplied.jobId) return;
      if (supplied && pending && stillClientRecordBinding(pending) === stillClientRecordBinding(supplied)
        && (!supplied.jobId || !pending.jobId || supplied.jobId === pending.jobId)) return;
      if (!supplied && !existing && !pending) return;
    }
    mountedScope.current = scope;
    mountedContext.current = context;
    const generation = ++serial.current;
    installRecord(null); setJob(null); setError(null); setBusy(false);
    activeRequest.current = false; pollFailures.current = 0;
    try {
      const saved = supplied !== undefined ? supplied : projectId
        ? parseStillClientRecord(JSON.parse(localStorage.getItem(stillClientStorageKey(projectId, storageScope)) ?? "null"), projectId) : null;
      if (suppliedRecord !== undefined && suppliedRecord !== null && !supplied) throw new Error("The supplied still record is invalid for this project.");
      if (saved) {
        localStorage.setItem(stillClientStorageKey(saved.projectId, storageScope), JSON.stringify(saved));
        installRecord(saved);
        void stillClientRequest("GET", saved).then(value => accept(value, saved, generation, start))
          .catch(async failure => { if (current(generation, start)) {
            try { if (failure instanceof StillClientAdmissionError) await releaseRejected(saved, generation, start); }
            catch (saveFailure) { setError((saveFailure as Error).message); return; }
            setError((failure as Error).message);
          } });
      } else if (projectId && suppliedRecord !== undefined) {
        localStorage.removeItem(stillClientStorageKey(projectId, storageScope));
      }
    } catch (failure) { setError((failure as Error).message); }
    // accept reads the current generation/props through refs; callback identity changes must not restart recovery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, storageScope, scope, context, suppliedKey]);
  useEffect(() => () => { ++serial.current; mountedScope.current = null; }, []);
  useEffect(() => {
    if (!record?.jobId || !job || isStillTerminal(job.state)) return;
    const generation = serial.current, start = live.current;
    const timer = setTimeout(() => {
      if (activeRequest.current) { setPollTick(value => value + 1); return; }
      void stillClientRequest("GET", record).then(value => accept(value, record, generation, start))
        .catch(failure => { if (current(generation, start)) { setError((failure as Error).message); if (++pollFailures.current < 5) setPollTick(value => value + 1); } });
    }, 5000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, job, pollTick, context, storageScope]);
  const isCurrentRecord = record?.projectId === projectId && record.context === context;
  async function generate() {
    if (activeRequest.current || busy || disabled || !projectId || !prose.trim() || !canCreateStill(record, job)) return;
    activeRequest.current = true;
    setBusy(true); setError(null); const start = live.current, generation = serial.current;
    let pending: StillClientRecord | null = null;
    try {
      const proposed = await prepareShot();
      if (!current(generation, start) || live.current.disabled) throw new Error("The shot changed before still submission.");
      const creativePrompt = start.compileCreativePrompt?.(prose) ?? prose.trim();
      const retry = isCurrentRecord && record && job && isStillTerminal(job.state) && record.request.attempt < 2 && sameStillFutureCreative(record.request.shot, proposed);
      const shot = retry ? record.request.shot : proposed;
      const next: StillClientRecord = { version: 1, projectId: shot.projectId, context: start.context,
        request: { shot, creativePrompt, seed: crypto.getRandomValues(new Uint32Array(1))[0],
          ...(start.sceneProof ? { sceneProof: start.sceneProof } : {}),
          requestIntentId: retry ? record.request.requestIntentId : crypto.randomUUID(), attempt: retry ? record.request.attempt + 1 : 0 } };
      pending = next; pendingPersistence.current = next;
      // Invalidate the ready preview before the durable write. Uncertain save/POST cannot enable a second attempt.
      installRecord(next); setJob(null);
      const value = await submitStillClientIntent(next, { storage: localStorage, storageScope: start.storageScope,
        onRecord: start.onRecord, isCurrent: () => current(generation, start) && !live.current.disabled });
      await accept(value, next, generation, start);
    } catch (failure) {
      if (current(generation, start)) {
        try { if (failure instanceof StillClientAdmissionError && pending) await releaseRejected(pending, generation, start); }
        catch (saveFailure) { setError((saveFailure as Error).message); return; }
        setError((failure as Error).message);
      }
    } finally {
      if (pendingPersistence.current === pending) pendingPersistence.current = null;
      if (current(generation, start)) { activeRequest.current = false; setBusy(false); }
    }
  }
  async function observe(method: "GET" | "PATCH" | "DELETE") {
    if (!record || busy || activeRequest.current) return;
    activeRequest.current = true; pollFailures.current = 0;
    setBusy(true); setError(null); const generation = serial.current, start = live.current;
    try { await accept(await stillClientRequest(method, record), record, generation, start); }
    catch (failure) { if (current(generation, start)) {
      try { if (failure instanceof StillClientAdmissionError) await releaseRejected(record, generation, start); }
      catch (saveFailure) { setError((saveFailure as Error).message); return; }
      setError((failure as Error).message);
    } } finally { if (current(generation, start)) { activeRequest.current = false; setBusy(false); } }
  }
  return <details className="rounded-md border border-line bg-ink-1 p-3">
    <summary className="cursor-pointer text-sm text-fg-1">{labels?.heading ?? "Prepare a MiniMax first frame"}</summary>
    <div className="mt-3 space-y-3">
      <p className="text-xs text-fg-3">{labels?.description ?? "Describe the opening image separately from the video motion. Named character and environment references guide the still. Shot/style references require a later continuation update."}</p>
      <label className="block text-xs text-fg-3">{labels?.prompt ?? "Opening image"}<input aria-label={labels?.prompt ?? "MiniMax still opening image"} value={prose} onChange={event => { setProse(event.target.value); props.onCreativePromptChange?.(event.target.value); }} maxLength={6000} disabled={busy || disabled} className="mt-1 block w-full rounded-md border border-line bg-ink-0 p-2 text-sm text-fg-1" /></label>
      <Button size="sm" disabled={busy || disabled || !projectId || !prose.trim() || !canCreateStill(record, job)} onClick={() => void generate()}>{job && isStillTerminal(job.state) ? labels?.regenerate ?? "Generate another still" : labels?.generate ?? "Generate still"}</Button>
      {record ? <div className="space-y-2 text-xs text-fg-3">
        <p><StatusDot tone={job?.state === "ready" ? "review" : job?.state === "failed" ? "failed" : "processing"} /> {job?.state ?? "Submission unconfirmed"} · still attempt {record.request.attempt + 1}/3</p>
        <p>Frozen opening image: {record.request.creativePrompt}</p>
        <p>Frozen video: {record.request.shot.songStart.toFixed(3)}–{record.request.shot.songEnd.toFixed(3)}s · {record.request.shot.prompt}</p>
        {!isCurrentRecord ? <p role="status">This saved still belongs to an earlier shot context. Review or cancel it; it cannot be applied here.</p> : null}
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" disabled={busy} onClick={() => void observe("GET")}>Refresh status</Button>
          {record.jobId && job && !isStillTerminal(job.state) ? <><Button size="sm" variant="ghost" disabled={busy} onClick={() => void observe("PATCH")}>Reconcile existing render</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void observe("DELETE")}>Cancel this still</Button></> : null}</div>
        {job?.state === "ready" && job.result ? <><div className="grid gap-2 sm:grid-cols-2">{([['Master', job.result.master], ['Video input', job.result.native]] as const).map(([label, image]) => <a key={label} href={stillMediaUrl(image)} target="_blank" rel="noreferrer" className="block"><span>{label}</span><img src={stillMediaUrl(image)} alt={`${label} MiniMax still for this shot`} className="mt-1 w-full rounded-sm" /></a>)}</div>
          {!props.hideVideoAction && onUse ? <><p>Review both images. Using this frame prepares the frozen video request; identity screening and video generation remain separate.</p>
          <Button size="sm" disabled={disabled || busy || !isCurrentRecord} onClick={() => { try { onUse(buildStillContinuation(record, job, context)); } catch (failure) { setError((failure as Error).message); } }}>{labels?.use ?? "Use for this shot"}</Button></> : null}</> : null}
      </div> : null}
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
    </div>
  </details>;
}
