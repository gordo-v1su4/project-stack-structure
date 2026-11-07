"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildGeneratedAssetPlaybackUrl, generatedAssetDraftIdentityBlockReason, type GeneratedStudioAsset } from "../generatedAssets";
import { canDeliverH3IdentityAssessment, h3IdentityAssessmentTrimWindow } from "../h3IdentityAssessment";
import { generatedAssetDraftSimilarityLabel, generatedAssetDraftSimilarityWarnings, normalizeGeneratedAssetIdentityVerification } from "../generatedAssetIdentity";
import { recheckH3Similarity } from "../h3SimilarityRecheck";
import { currentIdentityEvidenceSha256, identityPolicyChoiceForReferences } from "../issuedIdentityPolicy";
import { createNativeHandleAudition } from "../nativeHandleAudition";
import type { GeneratedDraftReview, GeneratedDraftSelection } from "../generatedDraft";
import { createH3PickupWindow, enqueueH3DraftRequest, findH3TargetSegment, h3DraftBatchStorageKey, h3RequestWindowKey, h3WindowKey, nextH3Attempt, parseH3DraftBatch, planH3DraftWindows, readH3DraftJobs, selectH3PickupWindow, selectH3ReferenceAssetIds, prepareH3PickupRequest, type H3DraftBatch } from "../h3DraftPlan";
import { isH3JobTerminal, type H3GenerationJob, type H3GenerationRequest } from "../h3Generation";
import type { EditPlanPreviewSegment } from "../musicVideoProject";
import type { ReferenceAsset } from "../referenceAssets";
import { Button, StatusDot, Surface } from "../ui";
import { uploadFileDirectlyToRustFs } from "../directUploadClient";
import { normalizeH3FirstFrameArtifact } from "../h3FirstFrame";
import { captureH3FirstFrame } from "../captureH3FirstFrame";
import { earlierH3FirstFrameSource } from "../h3FirstFrameSource";

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
  const [pickupEdits, setPickupEdits] = useState<Record<string, { direction?: string; duration?: string; crowdIds?: string[] }>>({});
  const [handleFrames,setHandleFrames] = useState<Record<string,number>>({});
  const [pickupMode,setPickupMode] = useState<"references"|"first-frame">("references");
  const [preparedFirstFrame,setPreparedFirstFrame] = useState<{file:File;context:string}|null>(null);
  const handleFramesRef = useRef<Record<string,number>>({});
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
    const restored = await readH3DraftJobs(projectId);
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
        const identityBlock = effectiveAsset ? generatedAssetDraftIdentityBlockReason(effectiveAsset) : "Needs identity check";
        if (identityBlock) {
          const remaining = batchRef.current!.requests.slice(1);
          persistBatch(remaining.length ? { ...batchRef.current!, requests: remaining, paused: true } : null);
          setMessage("The take was saved outside the draft.");
          throw new Error(`${identityBlock}. Review the take before continuing the remaining shots.`);
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
        const referenceAssetIds = selectH3ReferenceAssetIds(latest.current.referenceAssets, direction, previous?.references.filter(ref => ref.role === "crowd").map(ref => ref.assetId));
        return { ...input, ...(!previous ? identityPolicyChoiceForReferences(latest.current.referenceAssets, referenceAssetIds) : {}),
          draftRevision: undefined, referenceAssetIds };
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
      const referenceAssetIds = selectH3ReferenceAssetIds(latest.current.referenceAssets, direction, original?.references.filter(ref => ref.role === "crowd").map(ref => ref.assetId));
      persistBatch({ version: 1, projectId, planSignature: input.planSignature, requests: [{ ...input,
        ...(!original ? identityPolicyChoiceForReferences(latest.current.referenceAssets, referenceAssetIds) : {}), referenceAssetIds }], paused: false });
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
      const referenceAssetIds = selectH3ReferenceAssetIds(latest.current.referenceAssets, direction, pickupMode === "references" ? pickupCrowdIds : []);
      const input: H3GenerationRequest = {
        projectId, planSignature: segment.planSignature!, requirementId: segment.requirementId, timelineItemId: segment.timelineItemId,
        sectionId: segment.sectionId, songStart: segment.musicStart, songEnd: segment.musicEnd, prompt: direction,
        requestIntentId: crypto.randomUUID(), attempt: 0, referenceAssetIds, draftRevision: latest.current.draft?.revision ?? 0,
        ...identityPolicyChoiceForReferences(latest.current.referenceAssets, referenceAssetIds),
      };
      const request = prepareH3PickupRequest(input, previous, existingJobs, pickupMode);
      if(pickupMode==="first-frame"){
        if(!firstFrameFile)throw new Error("Choose a prepared native-size first-frame PNG. It will receive a CPU similarity screen before rendering.");
        if(firstFrameFile.type!=="image/png"||firstFrameFile.size>32*1024*1024)throw new Error("Choose a PNG smaller than 32 MiB.");
        if(!request.identityPolicyFamily)throw new Error("First-frame shots require one or two named character authorities.");
        setMessage("Uploading and freezing this shot's first frame…");
        const expectedSha256=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await firstFrameFile.arrayBuffer())),byte=>byte.toString(16).padStart(2,"0")).join("");
        const upload=await uploadFileDirectlyToRustFs(firstFrameFile,"media-uploads/h3-first-frames");
        const {conditioning:_,...shot}=request;void _;
        const response=await fetch("/api/generate/h3/first-frame-artifacts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({shot,upload:{bucket:upload.bucket,objectKey:upload.objectKey},expectedSha256}),signal:AbortSignal.timeout(120_000)});
        const result=await response.json();if(!response.ok)throw new Error(result.error||"Could not freeze the first frame.");
        const artifact=normalizeH3FirstFrameArtifact(result.artifact);if(!artifact||artifact.body.projectId!==projectId||artifact.body.pngSha256!==expectedSha256)throw new Error("First-frame registration returned a different image.");
        request.conditioning={kind:"first-frame",artifactId:artifact.id,expectedSha256};
      }
      persistBatch({ version: 1, projectId, planSignature: request.planSignature, requests: [request], paused: false });
      setReview(null); await runBatch();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not create this shot."); }
    finally { preparingPickup.current = false; if (mounted.current && !running.current) setBusy(false); }
  }

  async function captureEarlierFirstFrame(){
    if(!earlierFrame||!pickupWindow||busy)return;
    const projectId=props.projectId,windowKey=h3WindowKey(pickupWindow);setBusy(true);setError(null);
    try{const url=buildGeneratedAssetPlaybackUrl(earlierFrame.asset);if(!url)throw new Error("The earlier take has no playable media.");const file=await captureH3FirstFrame(url,earlierFrame.timeSeconds);
      if(!mounted.current||latest.current.projectId!==projectId||!planH3DraftWindows(latest.current.segments).some(w=>h3WindowKey(w)===windowKey))return;
      setPreparedFirstFrame({file,context:firstFrameContext});setPickupMode("first-frame");setMessage(`Prepared a native frame from ${earlierFrame.asset.title||"the earlier shot"}. It will be screened again for this new shot.`);
    }catch(failure){if(mounted.current&&latest.current.projectId===projectId)setError(failure instanceof Error?failure.message:"Could not prepare an earlier frame.");}
    finally{if(mounted.current)setBusy(false);}
  }

  async function recoverJob(job: H3GenerationJob, action: "resume" | "cancel" | "retry") {
    setBusy(true); setError(null);
    try {
      if (action === "retry") {
        if (!findH3TargetSegment(latest.current.segments, job.target)) throw new Error("This shot belongs to an earlier story plan.");
        const input = nextH3Attempt(job, await readJobs(job.projectId), latest.current.draft?.revision ?? 0);
        selectH3ReferenceAssetIds(latest.current.referenceAssets, input.prompt, job.references.filter(ref => ref.role === "crowd").map(ref => ref.assetId));
        persistBatch({ version: 1, projectId: job.projectId, planSignature: input.planSignature, requests: [input, ...(batchRef.current?.requests ?? []).filter(request => h3RequestWindowKey(request) !== h3RequestWindowKey(input))], paused: false });
        await runBatch(); return;
      }
      if (action === "cancel" && batchRef.current) persistBatch({ ...batchRef.current, paused: true });
      const intent = job.workerRecoveries?.find(recovery => !recovery.runId)?.requestIntentId
        ?? recoveryIntents.current.get(job.id) ?? crypto.randomUUID();
      recoveryIntents.current.set(job.id, intent);
      const response = await fetch("/api/generate/h3", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: job.projectId, jobId: job.id, action, requestIntentId: intent }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not update this shot's job.");
      recoveryIntents.current.delete(job.id);
      await readJobs(job.projectId);
      if (action === "resume" && batchRef.current) { persistBatch({ ...batchRef.current, paused: false }); await runBatch(); }
      setMessage(action === "cancel" ? "This shot is stopping safely. Other GPU work is not interrupted." : job.promptId || job.compiledPrompt
        ? "Checking the existing render. No replacement render was submitted." : "Resuming this shot's worker with the same saved inputs.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Job recovery failed."); }
    finally { if (mounted.current && !running.current) setBusy(false); }
  }

  async function checkSimilarity(job: H3GenerationJob) {
    if (busy || accepting) return;
    const projectId = props.projectId, expectedRevision = props.draft?.revision;
    const currentAsset = props.assets.find(asset => asset.id === job.result?.asset.id) ?? job.result?.asset;
    if (!currentAsset || currentAsset.reviewStatus === "rejected") return;
    const fingerprint = currentIdentityEvidenceSha256(currentAsset);
    const selectedFrame = handleFramesRef.current[job.id];
    const range = h3IdentityAssessmentTrimWindow(currentAsset,selectedFrame);
    setBusy(true); setError(null); setMessage("Checking the saved video with the similarity model…");
    try {
      const asset = await recheckH3Similarity(job, { requestIntentId: crypto.randomUUID(), asset: {...currentAsset,trimStart:range.trimStart} });
      if (!mounted.current || latest.current.projectId !== projectId) return;
      const latestAsset = latest.current.assets.find(candidate => candidate.id === currentAsset.id) ?? job.result?.asset;
      if (!canDeliverH3IdentityAssessment({ fingerprint,currentAsset:latestAsset,requestedRevision:expectedRevision,currentRevision:latest.current.draft?.revision,
        requestedStartFrame:selectedFrame,currentStartFrame:handleFramesRef.current[job.id] })) {
        setMessage("The trim or draft changed while checking. Its assessment is saved; check the current trim before selecting it."); return;
      }
      latest.current.onGeneratedAsset(asset);
      setReview(null);
      await readJobs(job.projectId);
      setMessage(generatedAssetDraftSimilarityLabel(asset) ?? `${generatedAssetDraftIdentityBlockReason(asset) ?? "Check completed"}. The take remains available for review.`);
    } catch (failure) {
      if (mounted.current && latest.current.projectId === projectId) setError(failure instanceof Error ? failure.message : "Similarity check failed.");
    } finally { if (mounted.current) setBusy(false); }
  }

  const missing = planH3DraftWindows(props.segments);
  const pickupWindow = selectH3PickupWindow(missing, pickupKey);
  const pickupEditKey = `${props.projectId ?? "unsaved"}:${pickupWindow ? h3WindowKey(pickupWindow) : ""}`;
  const pickupDirection = pickupEdits[pickupEditKey]?.direction ?? pickupWindow?.storyDirection?.trim() ?? pickupWindow?.label ?? "";
  const pickupMaximum = pickupWindow ? Math.min(12, pickupWindow.musicEnd - pickupWindow.musicStart) : 0;
  const pickupDuration = pickupEdits[pickupEditKey]?.duration ?? String(Math.min(3, pickupMaximum));
  const firstFrameContext=`${pickupEditKey}:${pickupWindow?.planSignature??""}:duration:${Number(pickupDuration)}`;
  const firstFrameFile=preparedFirstFrame?.context===firstFrameContext?preparedFirstFrame.file:null;
  const pickupDurationValid = pickupMaximum > 0 && pickupDuration.trim() !== "" && Number.isFinite(Number(pickupDuration))
    && Number(pickupDuration) >= Math.min(1, pickupMaximum) && Number(pickupDuration) <= pickupMaximum;
  const pickupPrevious = pickupWindow && pickupDurationValid ? jobs.filter(job => !job.request.conditioning
    && h3RequestWindowKey(job.request) === h3WindowKey(createH3PickupWindow(pickupWindow, Number(pickupDuration))))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] : undefined;
  const pickupCrowdIds = pickupEdits[pickupEditKey]?.crowdIds ?? pickupPrevious?.references.filter(ref => ref.role === "crowd").map(ref => ref.assetId) ?? [];
  const crowdAssets = props.referenceAssets.filter(ref => ref.kind === "crowd" || ref.role === "crowd");
  let pickupReferenceIds: string[] = [];
  let pickupReferenceError: string | null = null;
  try { pickupReferenceIds = selectH3ReferenceAssetIds(props.referenceAssets, pickupDirection, pickupMode === "references" ? pickupCrowdIds : []); }
  catch (failure) { pickupReferenceError = failure instanceof Error ? failure.message : "Check this shot's references."; }
  const pickupIdentityIds=props.referenceAssets.filter(ref=>pickupReferenceIds.includes(ref.id)&&(ref.kind==="character"||ref.role.startsWith("character"))).map(ref=>ref.id);
  const earlierFrame=pickupWindow?earlierH3FirstFrameSource(props.assets,props.projectId,pickupWindow.planSignature,pickupWindow.musicStart,pickupIdentityIds):undefined;
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
          <p className="text-xs text-fg-3">New character shots receive a provisional similarity screen. Identity remains unverified; review the assembled cut.</p>
          <p className="text-xs text-fg-3">{missing.length ? `${missing.length} unfilled window${missing.length === 1 ? "" : "s"}` : "Every song window has footage"}{activeJobs.length ? ` · ${activeJobs.length} renders in progress` : ""}. Review the cut before accepting it for Finish.</p>
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
            <label className="block text-xs text-fg-3">Shot input<select aria-label="One shot input mode" value={pickupMode} disabled={busy||accepting}
              onChange={event=>setPickupMode(event.target.value as "references"|"first-frame")} className="mt-1 block w-full rounded-md border border-line bg-ink-1 p-2 text-sm text-fg-1">
              <option value="references">Named reference images</option><option value="first-frame">Continue from a first frame</option>
            </select></label>
            {pickupMode==="first-frame"?<div className="space-y-2"><Button disabled={busy||accepting||!earlierFrame} onClick={()=>void captureEarlierFirstFrame()}>Use frame from earlier shot</Button>
              <p className="text-xs text-fg-3">{earlierFrame?`Uses the selected native trim of ${earlierFrame.asset.title||"the closest earlier eligible take"}.`:"An earlier eligible native take in this project and plan can supply the first frame."}</p>
              <label className="block text-xs text-fg-3">Or choose a native first frame · 1344×768 opaque PNG<input key={firstFrameContext} aria-label="Prepared first-frame PNG" type="file" accept="image/png" disabled={busy||accepting}
              onChange={event=>{const file=event.target.files?.[0];setPreparedFirstFrame(file?{file,context:firstFrameContext}:null);}} className="mt-1 block w-full text-sm text-fg-1" />
              <span className="mt-1 block">{firstFrameFile?`Prepared: ${firstFrameFile.name}. `:""}The actual image receives a provisional one-image numerical screen before GPU video generation. Every intended video frame must then pass separately. Switching input type starts a new take and keeps earlier results.</span></label></div>:null}
            <fieldset className="space-y-2 rounded-md border border-line p-3" disabled={busy || accepting || pickupMode === "first-frame"}>
              <legend className="px-1 text-xs text-fg-2">Crowd / extras for this shot</legend>
              <p className="text-xs text-fg-3">Choose only the sheets this shot needs. Extras guide variety and wardrobe range; named characters and location keep their own authorities. New batch windows use no crowd sheets.</p>
              {crowdAssets.map(ref => <label key={ref.id} className="flex items-center gap-2 text-sm text-fg-2">
                <input type="checkbox" checked={pickupCrowdIds.includes(ref.id)} onChange={event => {
                  const crowdIds = event.target.checked ? [...pickupCrowdIds, ref.id] : pickupCrowdIds.filter(id => id !== ref.id);
                  setPickupEdits(current => ({ ...current, [pickupEditKey]: { ...current[pickupEditKey], crowdIds } }));
                }} />
                {ref.displayName || ref.fileName}{ref.storageStatus !== "uploaded" || !ref.storageBucket || !ref.storagePath ? " · upload required" : ""}
              </label>)}
              {pickupCrowdIds.filter(id => !crowdAssets.some(ref => ref.id === id)).map(id => <label key={id} className="flex items-center gap-2 text-sm text-danger">
                <input type="checkbox" checked onChange={() => setPickupEdits(current => ({ ...current, [pickupEditKey]: { ...current[pickupEditKey], crowdIds: pickupCrowdIds.filter(value => value !== id) } }))} />
                Selected crowd sheet unavailable · remove selection
              </label>)}
              {!crowdAssets.length && !pickupCrowdIds.length ? <p className="text-xs text-fg-3">Add optional crowd sheets in Setup.</p> : null}
              {pickupMode === "first-frame" ? <p className="text-xs text-fg-3">First-frame video uses only the frozen PNG for visual conditioning. Crowd sheets selected here are reference-mode inputs.</p> : <p className="text-xs text-fg-3">{pickupReferenceIds.length}/9 total references for this shot.</p>}
            </fieldset>
            {pickupReferenceError ? <p role="alert" className="text-xs text-danger">{pickupReferenceError}</p> : null}
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
          <Button disabled={busy || accepting || Boolean(unavailable) || !pickupWindow || !pickupDurationValid || !pickupDirection.trim() || Boolean(pickupReferenceError) || activeJobs.length > 0 || Boolean(batch?.requests.length)}
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
        const identityBlock = asset ? generatedAssetDraftIdentityBlockReason(asset) : null;
        const rejected = asset?.reviewStatus === "rejected" || identityBlock === "Rejected";
        let range: ReturnType<typeof h3IdentityAssessmentTrimWindow> | undefined;
        try { if (asset) range=h3IdentityAssessmentTrimWindow(asset,handleFrames[job.id]); } catch { /* Incomplete metadata cannot enable a range check. */ }
        return <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
        <span className="flex items-center gap-2"><StatusDot tone={rejected || job.state === "failed" || (job.state === "ready" && Boolean(identityBlock)) ? "failed" : job.state === "ready" ? "ready" : "processing"} />{job.target.sectionLabel ?? job.request.sectionId} · {clock(job.request.songStart)}–{clock(job.request.songEnd)}</span>
        <span className="text-fg-3">{rejected ? "Rejected · excluded from draft" : job.state === "ready" && identityBlock ? identityBlock : STATE_LABELS[job.state]}{job.error ? `: ${job.error}` : ""}</span>
        <span className="flex flex-wrap gap-2">
          {job.state === "ready" && asset?.identityVerification?.status === "unverifiable" && !rejected ? <>
            <span className="text-fg-3">Source {preciseClock(range?.trimStart ?? asset.trimStart ?? 0)}–{preciseClock(range?.trimEnd ?? (asset.trimStart ?? 0) + job.target.songEnd-job.target.songStart)}</span>
            <Button disabled={busy || accepting || !range} onClick={() => void checkSimilarity(job)}>Check similarity</Button>
          </> : null}
          {(["submission_unknown", "rendering", "persisting"] as string[]).includes(job.state) && !job.workerRecoveries?.some(recovery => !recovery.runId)
            ? <Button disabled={busy || accepting} onClick={() => void recoverJob(job, "resume")}>Check existing render</Button> : null}
          {(job.state !== "cancelled" && job.workerRecoveries?.some(recovery => !recovery.runId))
            || (job.state === "failed" && job.runId && !job.promptId && !job.compiledPrompt && !job.result && !job.cancelRequestedAt)
            ? <Button disabled={busy || accepting} onClick={() => void recoverJob(job, "resume")}>Resume worker</Button>
            : job.state === "failed" || job.state === "cancelled" ? <Button disabled={busy || accepting || attemptsLeft(job) <= 0 || !findH3TargetSegment(props.segments, job.target)} onClick={() => void recoverJob(job, "retry")}>Retry shot ({attemptsLeft(job)} left)</Button> : null}
          {!isH3JobTerminal(job) && job.state !== "cancel_requested" ? <Button variant="danger" disabled={accepting} onClick={() => void recoverJob(job, "cancel")}>Cancel this shot</Button> : null}
        </span>
        {job.state === "ready" && asset?.identityVerification?.status === "unverifiable" && !rejected && range ? <NativeHandleDetails asset={asset} range={range} disabled={busy || accepting} onStartFrame={frame=>{
            handleFramesRef.current={...handleFramesRef.current,[job.id]:frame};setHandleFrames(handleFramesRef.current);setReview(null);
          }}/> : null}
        {asset ? <SimilarityFilterNote asset={asset} /> : null}
      </li>; })}</ul>
    </Surface> : null}
    {selected.length ? <Surface aria-label="Review generated shots">
      <h3 className="text-sm font-semibold">Revise individual shots</h3>
      <p className="mt-1 text-xs text-fg-3">Edit this shot direction while keeping the named people and location. The rest of the story stays intact.</p>
      <div className="mt-3 space-y-3">{selected.map(asset => <div key={asset.id} className="rounded-md border border-line p-3">
        <div className="mb-2 flex items-center justify-between gap-2"><span className="text-sm">{asset.title}</span><span className="text-xs text-fg-3">{clock(asset.target?.songStart ?? 0)}</span></div>
        {generatedAssetDraftIdentityBlockReason(asset) ? <p className="mb-2 text-xs text-warning">
          Selected cut retained · {generatedAssetDraftIdentityBlockReason(asset)}. Review and export wait for this check.
        </p> : null}
        <SimilarityFilterNote asset={asset} />
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
      {props.assets.filter(asset => !selectedIds.has(asset.id) && asset.mediaKind === "video" && asset.status === "completed" && asset.reviewStatus === "pending").map(asset => {
        const block = generatedAssetDraftIdentityBlockReason(asset);
        return <div key={asset.id} className="py-2 text-sm"><div className="flex items-center justify-between gap-2"><span>{asset.title}{block ? ` · ${block}` : ""}</span><Button disabled={busy || accepting || Boolean(block) || !asset.target || !findH3TargetSegment(props.segments, asset.target)} reason={block} onClick={() => { props.onSelectAsset(asset); setReview(null); }}>Use in draft</Button></div><SimilarityFilterNote asset={asset} /></div>;
      })}
    </Surface> : null}
  </div>;
}

function clock(seconds: number) { return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`; }
function preciseClock(seconds: number) { return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, "0")}`; }

type NativeHandleProps = {asset:GeneratedStudioAsset;range:ReturnType<typeof h3IdentityAssessmentTrimWindow>;disabled:boolean;onStartFrame:(frame:number)=>void};

export function NativeHandleDetails(props: NativeHandleProps) {
  const [open,setOpen]=useState(false);
  return <details className="w-full py-2" onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-fg-2">Choose source handle</summary>
    {open ? <NativeHandleControl {...props}/> : null}
  </details>;
}

function NativeHandleControl({asset,range,disabled,onStartFrame}:NativeHandleProps) {
  const video=useRef<HTMLVideoElement>(null);
  const audition=useRef<ReturnType<typeof createNativeHandleAudition>|null>(null);
  const attachVideo=useCallback((element:HTMLVideoElement|null)=>{
    if (!element && video.current) { audition.current?.destroy(); audition.current=null; video.current.pause(); video.current.removeAttribute("src"); video.current.load(); }
    video.current=element;
  },[]);
  useEffect(()=>{
    const element=video.current;
    if(!element)return;
    element.pause();
    if(element.readyState>=1)element.currentTime=range.trimStart;
    const control=createNativeHandleAudition(element,{trimStart:range.trimStart,endFrameExclusive:range.endFrameExclusive,fps:range.fps});
    audition.current=control;
    return ()=>{control.destroy();if(audition.current===control)audition.current=null;};
  },[range.trimStart,range.endFrameExclusive,range.fps]);
  return <div className="mt-2 grid gap-3 rounded-md border border-line bg-ink-0 p-3 sm:grid-cols-2">
    <video ref={attachVideo} className="w-full rounded-sm" controls preload="metadata" src={buildGeneratedAssetPlaybackUrl(asset)}
      onLoadedMetadata={event=>{event.currentTarget.currentTime=range.trimStart;}}
      onPlay={()=>audition.current?.watch()} onPause={()=>audition.current?.cancel()}
      onTimeUpdate={()=>audition.current?.check()}/>
    <div className="space-y-2 text-xs text-fg-2">
      <label className="block">Native start frame
        <input type="number" min={0} max={range.maxStartFrame} step={1} value={range.firstFrame} disabled={disabled}
          onChange={event=>{const value=Number(event.target.value);if(event.target.value!==""&&Number.isSafeInteger(value)&&value>=0&&value<=range.maxStartFrame)onStartFrame(value);}}
          className="ml-2 w-24 rounded-md border border-line bg-ink-1 px-2 py-1 text-fg-0"/>
      </label>
      <p>{range.targetDuration.toFixed(3)}s target · source {preciseClock(range.trimStart)}–{preciseClock(range.trimEnd)} · frames {range.firstFrame}–{range.endFrameExclusive-1} at {range.fps}fps</p>
      <p className="text-fg-3">Changing the handle does not select or approve it. Check this exact range, then review before using it.</p>
      <Button disabled={disabled} onClick={()=>audition.current?.play()}>Play selected range</Button>
    </div>
  </div>;
}

export function SimilarityFilterNote({ asset }: { asset: GeneratedStudioAsset }) {
  const label = generatedAssetDraftSimilarityLabel(asset), warnings = generatedAssetDraftSimilarityWarnings(asset);
  const filter = normalizeGeneratedAssetIdentityVerification(asset.identityVerification)?.draftSimilarityFilter;
  if (!label && !filter && !warnings.length) return null;
  const scores = filter ? filter.samples.flatMap((sample) => sample.scores.map(({ score }) => score)) : [];
  const range = scores.reduce<[number, number]>(([low, high], score) => [Math.min(low, score), Math.max(high, score)], [Infinity, -Infinity]);
  const outcome = label ?? (filter?.status === "ineligible" ? "Similarity filter did not pass" : "Similarity filter could not be assessed");
  return <div aria-label="Similarity filter evidence" className="w-full py-1 text-xs text-fg-3">
    <p className="text-fg-2">{outcome}. Identity remains unverified; scores are not calibrated identity confidence. Review the assembled draft.</p>
    {filter ? <>
      <p className="mt-1 text-fg-2">{scores.length ? `Cosine similarity ${range[0].toFixed(3)}–${range[1].toFixed(3)}` : "No face similarity scores measured"} · cutoff {filter.threshold.toFixed(3)}</p>
      <p className="mt-1 text-fg-2">Eligible frames {filter.eligibleFrameCount}/{filter.examinedFrameCount} assessed · out of scope {filter.outOfScopeFrameCount} · ambiguous {filter.ambiguousFrameCount}</p>
    </> : null}
    {warnings.length ? <details className="mt-1">
      <summary className="cursor-pointer">Quality details ({warnings.length})</summary>
      <ul aria-label="Similarity quality warnings" className="mt-1 list-inside list-disc">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
    </details> : null}
  </div>;
}
