"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { generatedAssetIdentityBlockReason, type GeneratedStudioAsset } from "../generatedAssets";
import type { GeneratedDraftReview, GeneratedDraftSelection } from "../generatedDraft";
import { createH3PickupWindow, enqueueH3DraftRequest, findH3TargetSegment, h3DraftBatchStorageKey, h3RequestWindowKey, h3WindowKey, nextH3Attempt, parseH3DraftBatch, planH3DraftWindows, selectH3PickupWindow, selectH3ReferenceAssetIds, type H3DraftBatch } from "../h3DraftPlan";
import { isH3JobTerminal, type H3GenerationJob, type H3GenerationRequest } from "../h3Generation";
import type { EditPlanPreviewSegment } from "../musicVideoProject";
import type { ReferenceAsset } from "../referenceAssets";
import { Button, StatusDot, Surface } from "../ui";

type Props = {
  projectId: string | null;
  segments: EditPlanPreviewSegment[];
  assets: GeneratedStudioAsset[];
  draft: GeneratedDraftSelection | null;
  referenceAssets: ReferenceAsset[];
  onEnsureSavedProject: () => Promise<string>;
  onGeneratedAsset: (asset: GeneratedStudioAsset, expectedRevision?: number) => void;
  onReviewDraft: () => Promise<GeneratedDraftReview>;
  onAcceptDraft: (review: GeneratedDraftReview) => Promise<void>;
  onRejectAsset: (assetId: string) => void;
  onSelectAsset: (asset: GeneratedStudioAsset) => void;
};

const STATE_LABELS: Record<H3GenerationJob["state"], string> = {
  queued: "Queued", preparing: "Preparing references", submitting: "Starting render",
  submission_unknown: "Checking submitted render", rendering: "Rendering", persisting: "Saving video",
  ready: "Ready for review", failed: "Needs retry", cancel_requested: "Stopping", cancelled: "Stopped",
};

export function MiniMaxDraftPanel(props: Props) {
  const [jobs, setJobs] = useState<H3GenerationJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<GeneratedDraftReview | null>(null);
  const [revisionText, setRevisionText] = useState<Record<string, string>>({});
  const [batch, setBatch] = useState<H3DraftBatch | null>(null);
  const [pickupKey, setPickupKey] = useState("");
  const [pickupEdits, setPickupEdits] = useState<Record<string, { direction?: string; duration?: string }>>({});
  const latest = useRef(props);
  const mounted = useRef(true);
  const delivered = useRef(new Set<string>());
  const batchRef = useRef<H3DraftBatch | null>(null);
  const running = useRef(false);
  const preparingPickup = useRef(false);
  const continueBatch = useRef<(() => Promise<void>) | null>(null);
  const recoveryIntents = useRef(new Map<string, string>());
  useEffect(() => { latest.current = props; }, [props]);
  useEffect(() => { continueBatch.current = runBatch; });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const readJobs = useCallback(async (projectId: string) => {
    const response = await fetch(`/api/generate/h3?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
    const payload = await response.json() as { error?: string; jobs?: H3GenerationJob[] };
    if (!response.ok) throw new Error(payload.error || "Could not restore generation progress.");
    const restored = payload.jobs ?? [];
    if (!mounted.current || latest.current.projectId !== projectId) return restored;
    setJobs(restored);
    // A reload can expose several completed jobs. Preserve dispatch order so
    // each persisted revision guard is evaluated against the correct selection.
    for (const job of [...restored].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      const asset = job.result?.asset;
      if (job.state !== "ready" || !asset || delivered.current.has(job.id)) continue;
      delivered.current.add(job.id);
      if (latest.current.assets.some(candidate => candidate.id === asset.id)) continue;
      latest.current.onGeneratedAsset(asset, job.request.draftRevision);
    }
    return restored;
  }, []);

  useEffect(() => {
    if (!props.projectId) return;
    const projectId = props.projectId;
    if (batchRef.current?.projectId !== projectId) {
      try {
        const restored = parseH3DraftBatch(localStorage.getItem(h3DraftBatchStorageKey(projectId)), projectId);
        batchRef.current = restored; setBatch(restored);
      } catch { batchRef.current = null; setBatch(null); }
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        await readJobs(projectId);
        if (active && batchRef.current?.projectId === projectId && !batchRef.current.paused) void continueBatch.current?.();
      }
      catch (failure) { if (active) setError(failure instanceof Error ? failure.message : "Could not restore generation progress."); }
      if (active) timer = setTimeout(() => void refresh(), 5_000);
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [props.projectId, readJobs]);

  function persistBatch(value: H3DraftBatch | null) {
    const projectId = value?.projectId ?? batchRef.current?.projectId;
    if (projectId) {
      if (value) localStorage.setItem(h3DraftBatchStorageKey(projectId), JSON.stringify(value));
      else localStorage.removeItem(h3DraftBatchStorageKey(projectId));
    }
    batchRef.current = value;
    if (mounted.current) setBatch(value);
  }

  async function renderRequest(input: H3GenerationRequest) {
    const projectId = input.projectId;
    const restored = await readJobs(projectId);
    const job = await enqueueH3DraftRequest(input, restored);
    const jobId = job.id;
    if (!jobId) throw new Error("The queued shot did not return a durable job identity.");
    // The server owns the job after dispatch. Leaving this page never cancels it.
    while (mounted.current && latest.current.projectId === projectId) {
      const current = (await readJobs(projectId)).find(candidate => candidate.id === jobId);
      if (current && isH3JobTerminal(current)) {
        // Allow the parent to commit delivery before capturing the next revision.
        if (current.result?.asset) for (let tries = 0; tries < 30 && mounted.current && !latest.current.assets.some(asset => asset.id === current.result!.asset.id); tries++) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        return current;
      }
      if (current?.state === "submission_unknown") throw new Error("This submission needs a status check. Resume its existing job; do not create another render.");
      await new Promise(resolve => setTimeout(resolve, 4_000));
    }
    return null;
  }

  async function runBatch() {
    if (running.current || !batchRef.current || batchRef.current.paused) return;
    const batchProjectId = batchRef.current.projectId;
    running.current = true; setBusy(true); setError(null);
    try {
      while (mounted.current && batchRef.current && !batchRef.current.paused && batchRef.current.requests.length) {
        const saved = batchRef.current;
        if (latest.current.projectId !== saved.projectId) break;
        if (!latest.current.segments.length || latest.current.segments.some(segment => segment.planSignature !== saved.planSignature)) {
          persistBatch({ ...saved, paused: true });
          setError("The story plan changed. Saved generation requests are paused."); break;
        }
        let request = saved.requests[0];
        if (request.draftRevision === undefined) {
          request = { ...request, draftRevision: latest.current.draft?.revision ?? 0 };
          persistBatch({ ...saved, requests: [request, ...saved.requests.slice(1)] });
        }
        setMessage(`Creating the draft · ${saved.requests.length} shot${saved.requests.length === 1 ? "" : "s"} remaining. Progress survives leaving this page.`);
        const job = await renderRequest(request);
        if (!job || !mounted.current || latest.current.projectId !== saved.projectId) break;
        if (job.state !== "ready") {
          setError(job.error || "A shot needs attention. Completed footage is preserved.");
          persistBatch({ ...batchRef.current!, paused: true, requests: batchRef.current!.requests.slice(1) });
          break;
        }
        const effectiveAsset = latest.current.assets.find(asset => asset.id === job.result?.asset.id) ?? job.result?.asset;
        const identityBlock = effectiveAsset ? generatedAssetIdentityBlockReason(effectiveAsset) : "Needs identity check";
        if (identityBlock) {
          const remaining = batchRef.current!.requests.slice(1);
          persistBatch(remaining.length ? { ...batchRef.current!, requests: remaining, paused: true } : null);
          setMessage("The take was saved outside the draft.");
          throw new Error(`${identityBlock}. Check likeness before continuing the remaining shots.`);
        }
        persistBatch({ ...batchRef.current!, requests: batchRef.current!.requests.slice(1) });
      }
      if (mounted.current && batchRef.current?.projectId === batchProjectId && batchRef.current.requests.length === 0) { persistBatch(null); setMessage("Shot generation completed. Review the assembled draft and any remaining gaps."); }
    } catch (failure) {
      if (mounted.current && latest.current.projectId === batchProjectId) setError(failure instanceof Error ? failure.message : "Could not confirm generation progress.");
      if (batchRef.current?.projectId === batchProjectId) persistBatch({ ...batchRef.current, paused: true });
    } finally { running.current = false; if (mounted.current) setBusy(false); }
  }

  async function generateMissing() {
    setBusy(true); setError(null); setMessage("Saving the current story and references…");
    try {
      const projectId = await props.onEnsureSavedProject();
      // Allow the parent to publish the newly saved project ID before polling.
      latest.current = { ...latest.current, projectId };
      const existingJobs = await readJobs(projectId);
      await new Promise(resolve => setTimeout(resolve, 50));
      const windows = planH3DraftWindows(latest.current.segments);
      const requests = windows.map(segment => {
        const direction = segment.storyDirection?.trim() || segment.label;
        const previous = existingJobs.filter(job => h3RequestWindowKey(job.request) === h3WindowKey(segment)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        if (previous && !isH3JobTerminal(previous)) return previous.request;
        const input = previous ? nextH3Attempt(previous, existingJobs, latest.current.draft?.revision ?? 0, direction) : {
          projectId, planSignature: segment.planSignature!, requirementId: segment.requirementId, timelineItemId: segment.timelineItemId,
          sectionId: segment.sectionId, songStart: segment.musicStart, songEnd: segment.musicEnd, prompt: direction,
          requestIntentId: crypto.randomUUID(), attempt: 0, referenceAssetIds: [],
        };
        // Each request gets the current review revision just before dispatch.
        return { ...input, draftRevision: undefined, referenceAssetIds: selectH3ReferenceAssetIds(latest.current.referenceAssets, direction) };
      });
      if (!requests.length) { setMessage("Every current song window already has footage."); return; }
      persistBatch({ version: 1, projectId, planSignature: requests[0].planSignature, requests, paused: false });
      await runBatch();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not create the draft."); }
    finally { if (mounted.current && !running.current) setBusy(false); }
  }

  async function revise(asset: GeneratedStudioAsset) {
    const target = asset.target;
    if (!target) return;
    const segment = findH3TargetSegment(props.segments, target);
    if (!segment) { setError("This shot belongs to an earlier plan. Use the current story."); return; }
    setBusy(true); setError(null);
    try {
      const projectId = await props.onEnsureSavedProject();
      latest.current = { ...latest.current, projectId };
      const existingJobs = await readJobs(projectId);
      const original = existingJobs.find(job => job.id === asset.jobId || job.id === asset.id)
        ?? existingJobs.filter(job => h3RequestWindowKey(job.request) === h3WindowKey(segment)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      const direction = revisionText[asset.id]?.trim() || original?.request.prompt || segment.storyDirection || segment.label;
      const input: H3GenerationRequest = original ? nextH3Attempt(original, existingJobs, latest.current.draft?.revision ?? 0, direction) : {
        projectId, planSignature: target.planSignature!, requirementId: target.requirementId, timelineItemId: target.timelineItemId,
        sectionId: target.sectionId, songStart: target.songStart, songEnd: target.songEnd, prompt: direction,
        referenceAssetIds: [], requestIntentId: crypto.randomUUID(), attempt: 0, draftRevision: latest.current.draft?.revision ?? 0,
      };
      persistBatch({ version: 1, projectId, planSignature: input.planSignature, requests: [{ ...input, referenceAssetIds: selectH3ReferenceAssetIds(latest.current.referenceAssets, direction) }], paused: false });
      setReview(null); await runBatch();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Revision failed."); }
    finally { if (mounted.current && !running.current) setBusy(false); }
  }

  async function generateOneShot() {
    if (!pickupWindow || preparingPickup.current || running.current || batchRef.current?.requests.length) return;
    preparingPickup.current = true;
    const chosenKey = h3WindowKey(pickupWindow);
    const direction = pickupDirection.trim();
    const duration = Number(pickupDuration);
    setBusy(true); setError(null); setMessage("Saving this shot's story and references…");
    try {
      if (!direction) throw new Error("Describe the visible shot before creating it.");
      // Validate before saving, then bind again to the latest current hole after the await.
      createH3PickupWindow(pickupWindow, duration);
      const projectId = await props.onEnsureSavedProject();
      latest.current = { ...latest.current, projectId };
      const existingJobs = await readJobs(projectId);
      const currentWindow = planH3DraftWindows(latest.current.segments).find(window => h3WindowKey(window) === chosenKey);
      if (!currentWindow) throw new Error("This song window changed while saving. Select its current missing window.");
      const segment = createH3PickupWindow(currentWindow, duration);
      const previous = existingJobs.filter(job => h3RequestWindowKey(job.request) === h3WindowKey(segment)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (previous && !isH3JobTerminal(previous)) throw new Error("This exact shot already has a submission. Check its existing render in Generation progress.");
      const input: H3GenerationRequest = previous ? nextH3Attempt(previous, existingJobs, latest.current.draft?.revision ?? 0, direction) : {
        projectId, planSignature: segment.planSignature!, requirementId: segment.requirementId, timelineItemId: segment.timelineItemId,
        sectionId: segment.sectionId, songStart: segment.musicStart, songEnd: segment.musicEnd, prompt: direction,
        requestIntentId: crypto.randomUUID(), attempt: 0, referenceAssetIds: [], draftRevision: latest.current.draft?.revision ?? 0,
      };
      const request = { ...input, referenceAssetIds: selectH3ReferenceAssetIds(latest.current.referenceAssets, direction) };
      persistBatch({ version: 1, projectId, planSignature: request.planSignature, requests: [request], paused: false });
      setReview(null); await runBatch();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not create this shot."); }
    finally { preparingPickup.current = false; if (mounted.current && !running.current) setBusy(false); }
  }

  async function recoverJob(job: H3GenerationJob, action: "resume" | "cancel" | "retry") {
    setBusy(true); setError(null);
    try {
      if (action === "retry") {
        if (!findH3TargetSegment(latest.current.segments, job.target)) throw new Error("This shot belongs to an earlier story plan.");
        const input = nextH3Attempt(job, await readJobs(job.projectId), latest.current.draft?.revision ?? 0);
        persistBatch({ version: 1, projectId: job.projectId, planSignature: input.planSignature, requests: [input, ...(batchRef.current?.requests ?? []).filter(request => h3RequestWindowKey(request) !== h3RequestWindowKey(input))], paused: false });
        await runBatch(); return;
      }
      if (action === "cancel" && batchRef.current) persistBatch({ ...batchRef.current, paused: true });
      const intent = recoveryIntents.current.get(job.id) ?? crypto.randomUUID();
      recoveryIntents.current.set(job.id, intent);
      const response = await fetch("/api/generate/h3", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: job.projectId, jobId: job.id, action, requestIntentId: intent }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not update this shot's job.");
      recoveryIntents.current.delete(job.id);
      await readJobs(job.projectId);
      if (action === "resume" && batchRef.current) { persistBatch({ ...batchRef.current, paused: false }); await runBatch(); }
      setMessage(action === "cancel" ? "This shot is stopping safely. Other GPU work is not interrupted." : "Checking the existing render. No replacement render was submitted.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Job recovery failed."); }
    finally { if (mounted.current && !running.current) setBusy(false); }
  }

  const missing = planH3DraftWindows(props.segments);
  const pickupWindow = selectH3PickupWindow(missing, pickupKey);
  const pickupEditKey = `${props.projectId ?? "unsaved"}:${pickupWindow ? h3WindowKey(pickupWindow) : ""}`;
  const pickupDirection = pickupEdits[pickupEditKey]?.direction ?? pickupWindow?.storyDirection?.trim() ?? pickupWindow?.label ?? "";
  const pickupMaximum = pickupWindow ? Math.min(12, pickupWindow.musicEnd - pickupWindow.musicStart) : 0;
  const pickupDuration = pickupEdits[pickupEditKey]?.duration ?? String(Math.min(3, pickupMaximum));
  const pickupDurationValid = pickupMaximum > 0 && pickupDuration.trim() !== "" && Number.isFinite(Number(pickupDuration))
    && Number(pickupDuration) >= Math.min(1, pickupMaximum) && Number(pickupDuration) <= pickupMaximum;
  const activeJobs = jobs.filter(job => !isH3JobTerminal(job));
  const attemptsLeft = (job: H3GenerationJob) => 2 - Math.max(job.request.attempt ?? 0, ...jobs.filter(candidate => candidate.request.requestIntentId === job.request.requestIntentId).map(candidate => candidate.request.attempt ?? 0));
  const selectedIds = new Set(props.draft?.assetIds ?? []);
  const selected = props.assets.filter(asset => selectedIds.has(asset.id));
  const referencesReady = props.referenceAssets.some(asset => asset.role === "character-1" && asset.storageStatus === "uploaded" && asset.storageBucket && asset.storagePath && asset.displayName?.trim())
    && props.referenceAssets.some(asset => asset.role === "environment" && asset.storageStatus === "uploaded" && asset.storageBucket && asset.storagePath && asset.displayName?.trim());
  const unavailable = !props.segments.length ? "Confirm a story first." : !referencesReady ? "Upload named character and location references in Setup." : null;

  return <div className="space-y-3">
    <Surface aria-label="Create the draft">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl space-y-1">
          <h2 className="text-lg font-semibold text-fg-0">Bring the story to life</h2>
          <p className="text-sm text-fg-2">MiniMax creates the missing shots from your references and assembles them with the footage you already have.</p>
          <p className="text-xs text-fg-3">{missing.length ? `${missing.length} unfilled shot windows` : "Every song window has footage"}{activeJobs.length ? ` · ${activeJobs.length} renders in progress` : ""}. Review the cut before accepting it for Finish.</p>
        </div>
        <Button variant="primary" disabled={busy || accepting || Boolean(unavailable) || !missing.length || activeJobs.length > 0} reason={unavailable}
          onClick={() => void generateMissing()}>{busy ? "Creating draft…" : activeJobs.length ? "Generation in progress" : "Create missing shots"}</Button>
      </div>
      {unavailable ? <p className="mt-3 text-sm text-fg-3">{unavailable}</p> : null}
      <details className="mt-3 rounded-md border border-line p-3">
        <summary className="cursor-pointer text-sm text-fg-2">Create one shot · advanced</summary>
        <div className="mt-3 space-y-3">
          <label className="block text-xs text-fg-3">Missing story window<select aria-label="One shot story window"
            value={pickupWindow ? h3WindowKey(pickupWindow) : ""} disabled={busy || accepting}
            onChange={event => setPickupKey(event.target.value)} className="mt-1 block w-full rounded-md border border-line bg-ink-1 p-2 text-sm text-fg-1">
            {!pickupWindow ? <option value="">Select a missing window</option> : null}
            {missing.map(window => <option key={h3WindowKey(window)} value={h3WindowKey(window)}>{window.label} · {preciseClock(window.musicStart)}–{preciseClock(window.musicEnd)}{window.musicEnd - window.musicStart < 1 ? " · short boundary sliver" : ""}</option>)}
          </select></label>
          {pickupWindow ? <>
            <label className="block text-xs text-fg-3">Edit duration (seconds)<input aria-label="One shot edit duration" type="number" step="any"
              min={Math.min(1, pickupMaximum)} max={pickupMaximum} value={pickupDuration} disabled={busy || accepting}
              onChange={event => setPickupEdits(current => ({ ...current, [pickupEditKey]: { ...current[pickupEditKey], duration: event.target.value } }))}
              className="mt-1 block w-32 rounded-md border border-line bg-ink-1 p-2 text-sm text-fg-1" /></label>
            <p className="text-xs text-fg-3">{pickupDurationValid ? `This shot fills ${preciseClock(pickupWindow.musicStart)}–${preciseClock(pickupWindow.musicStart + Number(pickupDuration))}.` : `Choose ${Math.min(1, pickupMaximum)}–${pickupMaximum.toFixed(3)} seconds.`} The rest of the draft stays in place.{pickupMaximum < 1 ? " This explicitly selected boundary sliver uses its full duration." : ""}</p>
            <label className="block text-xs text-fg-3">Shot direction<textarea aria-label="One shot direction" rows={4} maxLength={6000}
              value={pickupDirection} disabled={busy || accepting}
              onChange={event => setPickupEdits(current => ({ ...current, [pickupEditKey]: { ...current[pickupEditKey], direction: event.target.value } }))}
              className="mt-1 block w-full rounded-md border border-line bg-ink-1 p-2 text-sm text-fg-1" /></label>
          </> : <p className="text-xs text-fg-3">Select a short boundary sliver explicitly, or prepare a missing story window.</p>}
          {batch?.requests.length ? <p className="text-xs text-fg-3">Continue or clear the saved requests before creating one shot.</p> : null}
          <Button disabled={busy || accepting || Boolean(unavailable) || !pickupWindow || !pickupDurationValid || !pickupDirection.trim() || activeJobs.length > 0 || Boolean(batch?.requests.length)}
            reason={unavailable} onClick={() => void generateOneShot()}>Create this shot</Button>
        </div>
      </details>
      {message ? <p role="status" className="mt-3 text-sm text-fg-2">{message}</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
      {batch?.requests.length ? <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-3">
        <span>{batch.requests.length} saved shot request{batch.requests.length === 1 ? "" : "s"}{batch.paused ? " · paused" : " · continues when this project is open"}</span>
        {batch.paused ? <Button disabled={busy || accepting || batch.planSignature !== props.segments[0]?.planSignature} onClick={() => {
          persistBatch({ ...batch, paused: false }); void runBatch();
        }}>Continue saved batch</Button> : <Button disabled={!busy} onClick={() => persistBatch({ ...batch, paused: true })}>Pause remaining shots</Button>}
        {batch.paused && !busy ? <Button disabled={accepting} onClick={() => persistBatch(null)}>Clear pending requests</Button> : null}
      </div> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={!props.segments.length || busy || accepting} onClick={() => {
          setError(null); void props.onReviewDraft().then(setReview).catch(failure => setError(failure instanceof Error ? failure.message : "Preview failed."));
        }}>Review assembled draft</Button>
        <Button variant="success" disabled={!review || busy || accepting || activeJobs.length > 0 || missing.length > 0} reason="Review the complete draft first."
          onClick={() => {
            if (!review) return;
            setAccepting(true); setError(null);
            void props.onAcceptDraft(review).then(() => {
              if (mounted.current) { setReview(null); setMessage("Draft accepted and saved. Continue to Finish."); }
            }).catch(failure => {
              if (mounted.current) setError(failure instanceof Error ? failure.message : "Acceptance failed.");
            }).finally(() => { if (mounted.current) setAccepting(false); });
          }}>{accepting ? "Saving accepted draft…" : "Use this draft"}</Button>
      </div>
    </Surface>
    {jobs.length ? <Surface aria-label="Generation progress">
      <h3 className="mb-2 text-sm font-semibold">Generation progress</h3>
      <ul className="divide-y divide-line">{jobs.slice(0, 40).map(job => {
        const asset = props.assets.find(candidate => candidate.id === job.result?.asset.id) ?? job.result?.asset;
        const identityBlock = asset ? generatedAssetIdentityBlockReason(asset) : null;
        const rejected = asset?.reviewStatus === "rejected" || identityBlock === "Rejected";
        return <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
        <span className="flex items-center gap-2"><StatusDot tone={rejected || job.state === "failed" || (job.state === "ready" && Boolean(identityBlock)) ? "failed" : job.state === "ready" ? "ready" : "processing"} />{job.target.sectionLabel ?? job.request.sectionId} · {clock(job.request.songStart)}–{clock(job.request.songEnd)}</span>
        <span className="text-fg-3">{rejected ? "Rejected · excluded from draft" : job.state === "ready" && identityBlock ? identityBlock : STATE_LABELS[job.state]}{job.error ? `: ${job.error}` : ""}</span>
        <span className="flex flex-wrap gap-2">
          {(["submission_unknown", "rendering", "persisting"] as string[]).includes(job.state) ? <Button disabled={busy || accepting} onClick={() => void recoverJob(job, "resume")}>Check existing render</Button> : null}
          {job.state === "failed" || job.state === "cancelled" ? <Button disabled={busy || accepting || attemptsLeft(job) <= 0 || !findH3TargetSegment(props.segments, job.target)} onClick={() => void recoverJob(job, "retry")}>Retry shot ({attemptsLeft(job)} left)</Button> : null}
          {!isH3JobTerminal(job) && job.state !== "cancel_requested" ? <Button variant="danger" disabled={accepting} onClick={() => void recoverJob(job, "cancel")}>Cancel this shot</Button> : null}
        </span>
      </li>; })}</ul>
    </Surface> : null}
    {selected.length ? <Surface aria-label="Review generated shots">
      <h3 className="text-sm font-semibold">Revise individual shots</h3>
      <p className="mt-1 text-xs text-fg-3">Edit this shot direction while keeping the named people and location. The rest of the story stays intact.</p>
      <div className="mt-3 space-y-3">{selected.map(asset => <div key={asset.id} className="rounded-md border border-line p-3">
        <div className="mb-2 flex items-center justify-between gap-2"><span className="text-sm">{asset.title}</span><span className="text-xs text-fg-3">{clock(asset.target?.songStart ?? 0)}</span></div>
        <label className="block text-xs text-fg-3">Shot direction<textarea aria-label={`Revision for ${asset.title}`} rows={2}
          value={revisionText[asset.id] ?? jobs.find(job => job.id === asset.jobId || job.id === asset.id)?.request.prompt ?? ""} placeholder={asset.target?.sectionLabel ?? "Describe the complete revised action"}
          onChange={event => setRevisionText(previous => ({ ...previous, [asset.id]: event.target.value }))}
          className="mt-1 block w-full rounded-md border border-line bg-ink-1 p-2 text-sm text-fg-1" /></label>
        <div className="mt-2 flex gap-2"><Button disabled={busy || accepting} onClick={() => void revise(asset)}>Revise shot</Button>
          <Button variant="danger" disabled={busy || accepting} onClick={() => { props.onRejectAsset(asset.id); setReview(null); }}>Reject shot</Button></div>
      </div>)}</div>
    </Surface> : null}
    {props.assets.some(asset => !selectedIds.has(asset.id) && asset.mediaKind === "video" && asset.status === "completed" && asset.reviewStatus === "pending") ? <Surface>
      <h3 className="mb-2 text-sm font-semibold">Other takes</h3>
      {props.assets.filter(asset => !selectedIds.has(asset.id) && asset.mediaKind === "video" && asset.status === "completed" && asset.reviewStatus === "pending").map(asset => <div key={asset.id} className="flex items-center justify-between gap-2 py-1 text-sm"><span>{asset.title}{generatedAssetIdentityBlockReason(asset) ? ` · ${generatedAssetIdentityBlockReason(asset)}` : ""}</span><Button disabled={busy || accepting || Boolean(generatedAssetIdentityBlockReason(asset)) || !asset.target || !findH3TargetSegment(props.segments, asset.target)} reason={generatedAssetIdentityBlockReason(asset)} onClick={() => { props.onSelectAsset(asset); setReview(null); }}>Use in draft</Button></div>)}
    </Surface> : null}
  </div>;
}

function clock(seconds: number) { return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`; }
function preciseClock(seconds: number) { return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, "0")}`; }
