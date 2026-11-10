"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildGeneratedAssetPlaybackUrl, generatedAssetDraftIdentityBlockReason, type GeneratedStudioAsset } from "../generatedAssets";
import { canDeliverH3IdentityAssessment, h3IdentityAssessmentTrimWindow } from "../h3IdentityAssessment";
import { generatedAssetDraftSimilarityLabel, generatedAssetDraftSimilarityWarnings, normalizeGeneratedAssetIdentityVerification } from "../generatedAssetIdentity";
import { recheckH3Similarity } from "../h3SimilarityRecheck";
import { currentIdentityEvidenceSha256, identityPolicyChoiceForReferences, identityPolicySha256 } from "../issuedIdentityPolicy";
import { createNativeHandleAudition } from "../nativeHandleAudition";
import type { GeneratedDraftReview, GeneratedDraftSelection } from "../generatedDraft";
import { appendH3AestheticReferenceIds, createH3PickupWindow, enqueueH3DraftRequest, findH3TargetSegment, h3DraftBatchStorageKey, h3RequestWindowKey, h3WindowKey, nextH3Attempt, parseH3DraftBatch, planH3DraftWindows, readH3DraftJobs, selectH3PickupWindow, selectH3ReferenceAssetIds, prepareH3PickupRequest, type H3DraftBatch } from "../h3DraftPlan";
import { isH3JobTerminal, type H3GenerationJob, type H3GenerationRequest } from "../h3Generation";
import type { EditPlanPreviewSegment, MusicVideoProject } from "../musicVideoProject";
import { buildH3DraftPlanningInput, buildPlannedH3DraftRequests, previousH3WindowJob } from "../h3PlannedDraftRequests";
import { generationScopeSha256 } from "../generationScope";
import type { H3ShotPlanningResult } from "../h3ShotPlanning";
import { aestheticReferenceApplies, type AestheticReferenceLibrary } from "../aestheticReferences";
import { ReferenceSheetPreview } from "../ReferenceSheetPreview";
import type { ReferenceAsset } from "../referenceAssets";
import { Button, StatusDot, Surface } from "../ui";
import { uploadFileDirectlyToRustFs } from "../directUploadClient";
import { normalizeH3FirstFrameArtifact } from "../h3FirstFrame";
import { captureH3FirstFrame } from "../captureH3FirstFrame";
import { earlierH3FirstFrameSource } from "../h3FirstFrameSource";
import { currentReferenceBankCheckBlockReason } from "../currentReferenceReview";
import { nativeFirstFrameSelection, assertNativeFirstFrameReceipt, type NativeFirstFrameSelection } from "../nativeFirstFrame";
import { currentReferenceIdentityApprovalSha256 } from "../currentReferenceIdentity";
import { buildLiveDraftTakes, completeH3ReviewRequest, readH3ReviewNotes, writeH3ReviewNotes, queueH3ReviewRevision } from "../liveDraftReview";
import { LiveDraftTakeViewer } from "./LiveDraftTakeViewer";
import { MiniMaxStillPanel } from "./MiniMaxStillPanel";
import type { H3FirstFrameChoice } from "../h3FirstFrame";
import { buildStillVideoRequest, restoreStillShotForm, stillCanonicalContext } from "../h3StillClient";
import type { StoryTreatment } from "../storyTreatments";
import type { StoryPlanDraft } from "../musicVideoProject";
import type { SceneProofPlan } from "../sceneProofs";
import { sceneProofScopeSha256 } from "../sceneProofPlanning";

type Props = {
  storyApproved?: boolean;
  confirmedTreatment?: StoryTreatment | null;
  sceneProofPlan?: SceneProofPlan;
  sceneProofReviewRequired?: boolean;
  storyBeats?: StoryPlanDraft[];
  projectId: string | null;
  project?: MusicVideoProject | null;
  segments: EditPlanPreviewSegment[];
  assets: GeneratedStudioAsset[];
  draft: GeneratedDraftSelection | null;
  referenceAssets: ReferenceAsset[];
  aestheticReferences?: AestheticReferenceLibrary;
  onAestheticSelection?: (shotId: string, ids: string[]) => void;
  onEnsureSavedProject: () => Promise<string>;
  onGeneratedAsset: (asset: GeneratedStudioAsset, expectedRevision?: number) => void;
  onReviewDraft: () => Promise<GeneratedDraftReview>;
  onAcceptDraft: (review: GeneratedDraftReview) => Promise<void>;
  onRejectAsset: (assetId: string) => void;
  onSelectAsset: (asset: GeneratedStudioAsset) => void;
  onCheckCurrentReferences?: (assetId: string) => Promise<void>;
};

const STATE_LABELS: Record<H3GenerationJob["state"], string> = {
  queued: "Queued", preparing: "Preparing references", submitting: "Starting render",
  submission_unknown: "Checking submitted render", rendering: "Rendering", persisting: "Saving video",
  ready: "Ready for review", failed: "Needs retry", cancel_requested: "Stopping", cancelled: "Stopped",
};

export function MiniMaxDraftPanel(props: Props) {
  const [allJobs, setJobs] = useState<H3GenerationJob[]>([]);
  const jobs = allJobs.filter(job => job.projectId === props.projectId);
  const [jobHistory, setJobHistory] = useState({ projectId: props.projectId, limit: 40 });
  const visibleJobLimit = jobHistory.projectId === props.projectId ? jobHistory.limit : 40;
  if (jobHistory.projectId !== props.projectId) setJobHistory({ projectId: props.projectId, limit: 40 });
  const [busy, setBusy] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<GeneratedDraftReview | null>(null);
  const [notes, setNotes] = useState<{ projectId: string | null; values: Record<string, string> }>({ projectId: null, values: {} });
  const revisionText = notes.projectId === props.projectId ? notes.values : {};
  const [openedTake, setOpenedTake] = useState<{ projectId: string | null; id: string } | null>(null);
  const [storedBatch, setBatch] = useState<H3DraftBatch | null>(null);
  const batch = storedBatch?.projectId === props.projectId ? storedBatch : null;
  const [pickupKey, setPickupKey] = useState("");
  const [pickupEdits, setPickupEdits] = useState<Record<string, { direction?: string; duration?: string; crowdIds?: string[] }>>({});
  const [handleFrames,setHandleFrames] = useState<Record<string,number>>({});
  const [pickupMode,setPickupMode] = useState<"references"|"first-frame">("references");
  const [generatedStillChoice, setGeneratedStillChoice] = useState<{ context: string; shot: H3GenerationRequest; conditioning: H3FirstFrameChoice } | null>(null);
  type PreparedFrame = {file:File;context:string;source?:NativeFirstFrameSelection};
  const [preparedFirstFrame,setPreparedFirstFrame] = useState<PreparedFrame|null>(null);
  const preparedFirstFrameRef = useRef<PreparedFrame|null>(null);
  const firstFrameContextRef = useRef("");
  const stillContextRef = useRef("");
  const stillFormGuardRef = useRef("");
  const [nativeFrameChoice,setNativeFrameChoice] = useState<{sourceKey:string;frameIndex:number|null}|null>(null);
  function prepareFrame(value:PreparedFrame|null){preparedFirstFrameRef.current=value;setPreparedFirstFrame(value);setGeneratedStillChoice(null);}
  const handleFramesRef = useRef<Record<string,number>>({});
  const latest = useRef(props);
  const mounted = useRef(true);
  const delivered = useRef(new Set<string>());
  const batchRef = useRef<H3DraftBatch | null>(null);
  const running = useRef(false);
  const preparingPickup = useRef(false);
  const checkingCurrentReferences = useRef(false);
  const continueBatch = useRef<(() => Promise<void>) | null>(null);
  const recoveryIntents = useRef(new Map<string, string>());
  const preparingDraft = useRef(false);
  const planning = useRef<{ controller: AbortController; projectId: string; binding: string; aesthetics: string; jobs: H3GenerationJob[] } | null>(null);
  function planningIsCurrent() {
    const active = planning.current;
    const current = latest.current;
    if (!active || !mounted.current || active.controller.signal.aborted || current.projectId !== active.projectId || current.storyApproved === false || !current.project) return false;
    try { return buildH3DraftPlanningInput(active.projectId, current.project, current.referenceAssets,
      { assets: current.assets, draft: current.draft, jobs: active.jobs, confirmedTreatment: current.confirmedTreatment,
        sceneProofPlan: current.sceneProofPlan, sceneProofReviewRequired: current.sceneProofReviewRequired, storyBeats: current.storyBeats }).bindingSha256 === active.binding
      && generationScopeSha256(current.aestheticReferences ?? null) === active.aesthetics; }
    catch { return false; }
  }
  const mayEdit = () => latest.current.storyApproved !== false && !running.current && !preparingPickup.current
    && !checkingCurrentReferences.current && !jobs.some(job => !isH3JobTerminal(job));
  useEffect(() => {
    const projectId = props.projectId;
    let values: Record<string, string> = {};
    try { if (projectId) values = readH3ReviewNotes(localStorage, projectId); } catch { /* Notes remain editable without browser storage. */ }
    setNotes({ projectId, values });
  }, [props.projectId]);
  function updateNote(assetId: string, value: string) {
    const values = { ...revisionText, [assetId]: value.slice(0, 6000) };
    setNotes({ projectId: props.projectId, values });
    try { if (props.projectId) writeH3ReviewNotes(localStorage, props.projectId, values); }
    catch { setError("Revision notes could not be saved in this browser."); }
  }
  useEffect(() => { latest.current = props; }, [props]);
  useEffect(() => { continueBatch.current = runBatch; });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; planning.current?.controller.abort(); }; }, []);
  useEffect(() => {
    if (planning.current && !planningIsCurrent()) planning.current.controller.abort();
  }, [props.projectId, props.project, props.referenceAssets, props.aestheticReferences, props.storyApproved, props.assets, props.draft, props.confirmedTreatment,
    props.sceneProofPlan, props.sceneProofReviewRequired, props.storyBeats]);

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
      latest.current.onGeneratedAsset(asset, latest.current.storyApproved === false ? undefined : job.request.draftRevision);
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

  useEffect(() => {
    if (props.storyApproved === false && batchRef.current && !batchRef.current.paused) {
      persistBatch({ ...batchRef.current, paused: true });
    }
  }, [props.storyApproved]);

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
        if (latest.current.storyApproved === false || !latest.current.segments.length || latest.current.segments.some(segment => segment.planSignature !== saved.planSignature)) {
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
          const remaining = completeH3ReviewRequest(batchRef.current!);
          persistBatch(remaining ? { ...remaining, paused: true } : null);
          break;
        }
        const effectiveAsset = latest.current.assets.find(asset => asset.id === job.result?.asset.id) ?? job.result?.asset;
        const identityBlock = effectiveAsset ? generatedAssetDraftIdentityBlockReason(effectiveAsset) : "Needs identity check";
        if (identityBlock) {
          const remaining = completeH3ReviewRequest(batchRef.current!);
          persistBatch(remaining ? { ...remaining, paused: true } : null);
          setMessage("The take was saved outside the draft.");
          throw new Error(`${identityBlock}. Review the take before continuing the remaining shots.`);
        }
        persistBatch(completeH3ReviewRequest(batchRef.current!));
      }
      if (mounted.current && batchRef.current?.projectId === batchProjectId && batchRef.current.requests.length === 0) { persistBatch(null); setMessage("Shot generation completed. Review the assembled draft and any remaining gaps."); }
    } catch (failure) {
      if (mounted.current && latest.current.projectId === batchProjectId) setError(failure instanceof Error ? failure.message : "Could not confirm generation progress.");
      if (batchRef.current?.projectId === batchProjectId) persistBatch({ ...batchRef.current, paused: true });
    } finally { running.current = false; if (mounted.current) setBusy(false); }
  }

  async function generateMissing() {
    if (!mayEdit() || busy || accepting || preparingDraft.current || batchRef.current?.requests.length) return;
    if (props.segments.some(segment => segment.animaticShotId)) { setError("Prepare motion for the reviewed animatic shots individually; the legacy batch uses different edit windows."); return; }
    preparingDraft.current = true;
    setBusy(true); setError(null); setMessage("Saving the current story and references…");
    const startingProjectId = props.projectId;
    try {
      const projectId = await props.onEnsureSavedProject();
      if (!mounted.current || (latest.current.projectId !== startingProjectId && latest.current.projectId !== projectId)) throw new Error("The project changed while preparing the draft.");
      // Allow the parent to publish the newly saved project ID before polling.
      latest.current = { ...latest.current, projectId };
      let existingJobs = await readJobs(projectId);
      await new Promise(resolve => setTimeout(resolve, 50));
      if (!mounted.current || latest.current.projectId !== projectId || latest.current.storyApproved === false) throw new Error("The project or approved story changed.");
      let windows = planH3DraftWindows(latest.current.segments);
      let planningInput: ReturnType<typeof buildH3DraftPlanningInput> | undefined;
      let planningResult: H3ShotPlanningResult | undefined;
      if (windows.length) {
        if (!latest.current.project) throw new Error("Restore the full confirmed story before preparing missing shots.");
        planningInput = buildH3DraftPlanningInput(projectId, latest.current.project, latest.current.referenceAssets,
          { assets: latest.current.assets, draft: latest.current.draft, jobs: existingJobs, confirmedTreatment: latest.current.confirmedTreatment,
            sceneProofPlan: latest.current.sceneProofPlan, sceneProofReviewRequired: latest.current.sceneProofReviewRequired, storyBeats: latest.current.storyBeats });
        const coveredKeys = new Set(planningInput.groups.flatMap(group => group.windows)
          .filter(window => window.sourceEvidence || window.generatedEvidence).map(window => window.key));
        if (windows.some(window => coveredKeys.has(h3WindowKey(window)))) throw new Error("Some apparent gaps already contain canonical footage. Restore their playback sources before generating.");
      }
      if (windows.some(window => !previousH3WindowJob(projectId, window, existingJobs))) {
        if (!planningInput) throw new Error("Restore the current shot planning context.");
        planning.current = { controller: new AbortController(), projectId, binding: planningInput.bindingSha256,
          aesthetics: generationScopeSha256(latest.current.aestheticReferences ?? null), jobs: existingJobs };
        setMessage("Planning and reviewing each musical shot before video generation…");
        const { requestH3ShotPlanning } = await import("../h3ShotPlanningClient");
        planningResult = await requestH3ShotPlanning(planningInput, { signal: planning.current.controller.signal, isCurrent: planningIsCurrent });
        if (!planningIsCurrent()) throw new Error("The project or shot planning context changed. No new video requests were created.");
        existingJobs = await readJobs(projectId);
        if (!planningIsCurrent()) throw new Error("The project or shot planning context changed. No new video requests were created.");
        windows = planH3DraftWindows(latest.current.segments);
      }
      const requests = buildPlannedH3DraftRequests({ projectId, windows, jobs: existingJobs, draftRevision: latest.current.draft?.revision ?? 0,
        referenceAssets: latest.current.referenceAssets, aestheticReferences: latest.current.aestheticReferences, planningInput, planningResult });
      if (!requests.length) { setMessage("Every current song window already has footage."); return; }
      planning.current = null;
      persistBatch({ version: 1, projectId, planSignature: requests[0].planSignature, requests, paused: false });
      await runBatch();
    } catch (failure) { if (mounted.current && (latest.current.projectId === startingProjectId || latest.current.projectId === planning.current?.projectId)) setError(failure instanceof Error ? failure.message : "Could not create the draft."); }
    finally { planning.current?.controller.abort(); planning.current = null; preparingDraft.current = false; if (mounted.current && !running.current) setBusy(false); }
  }

  async function revise(asset: GeneratedStudioAsset) {
    if (!mayEdit() || busy || accepting) return;
    if (batchRef.current && !batchRef.current.paused) { setError("Pause upcoming submissions before revising a take."); return; }
    const target = asset.target;
    if (!target) return;
    const segment = findH3TargetSegment(props.segments, target);
    if (!segment) { setError("This shot belongs to an earlier plan. Use the current story."); return; }
    setBusy(true); setError(null);
    try {
      const projectId = await props.onEnsureSavedProject();
      latest.current = { ...latest.current, projectId };
      const existingJobs = await readJobs(projectId);
      if (latest.current.projectId !== projectId || latest.current.storyApproved === false) throw new Error("The project or story changed while preparing this revision.");
      const original = existingJobs.find(job => job.id === asset.jobId || job.id === asset.id)
        ?? existingJobs.filter(job => h3RequestWindowKey(job.request) === h3WindowKey(segment)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      const direction = revisionText[asset.id]?.trim() || original?.request.prompt || segment.storyDirection || segment.label;
      const input: H3GenerationRequest = original ? nextH3Attempt(original, existingJobs, latest.current.draft?.revision ?? 0, direction) : {
        projectId, planSignature: target.planSignature!, requirementId: target.requirementId, timelineItemId: target.timelineItemId,
        sectionId: target.sectionId, songStart: target.songStart, songEnd: target.songEnd, prompt: direction,
        referenceAssetIds: [], requestIntentId: crypto.randomUUID(), attempt: 0, draftRevision: latest.current.draft?.revision ?? 0,
      };
      const referenceAssetIds = appendH3AestheticReferenceIds(selectH3ReferenceAssetIds(latest.current.referenceAssets, direction, original?.references.filter(ref => ref.role === "crowd").map(ref => ref.assetId)), latest.current.aestheticReferences, segment);
      persistBatch(queueH3ReviewRevision(batchRef.current, bindPreparedSceneRequest({ ...input,
        ...(!original ? identityPolicyChoiceForReferences(latest.current.referenceAssets, referenceAssetIds) : {}), referenceAssetIds })));
      setReview(null); await runBatch();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Revision failed."); }
    finally { if (mounted.current && !running.current) setBusy(false); }
  }

  /** Only deliberate preparation may acquire current review authority. Recovery
   * and queued POSTs keep their original binding and must fail if it changed. */
  function bindPreparedSceneRequest(request: H3GenerationRequest): H3GenerationRequest {
    const current = latest.current;
    if (request.animaticMotion) return request;
    if (current.segments.some(segment => segment.animaticShotId)) throw new Error("Choose the current reviewed animatic shot before preparing motion.");
    if (current.sceneProofPlan === undefined && !current.sceneProofReviewRequired) return request;
    if (!current.project || !current.confirmedTreatment) throw new Error("Restore the confirmed scene plan before preparing this shot.");
    const binding = sceneProofScopeSha256({ projectId: request.projectId, project: current.project,
      treatment: current.confirmedTreatment, storyBeats: current.storyBeats ?? [], references: current.referenceAssets,
      sceneProofPlan: current.sceneProofPlan, sceneProofReviewRequired: current.sceneProofReviewRequired }, request);
    return { ...request, sceneProofScopeSha256: binding };
  }

  async function generateOneShot() {
    if (!mayEdit() || !pickupWindow || preparingPickup.current || running.current || batchRef.current?.requests.length) return;
    preparingPickup.current = true;
    const chosenKey = h3WindowKey(pickupWindow);
    const direction = pickupDirection.trim();
    const duration = pickupWindow.animaticShotId ? pickupWindow.musicEnd - pickupWindow.musicStart : Number(pickupDuration);
    setBusy(true); setError(null); setMessage("Saving this shot's story and references…");
    try {
      if (!direction) throw new Error("Describe the visible shot before creating it.");
      if (pickupWindow.animaticRetainedSource) throw new Error("Review and place the existing footage for this retained source shot.");
      // Validate before saving, then bind again to the latest current hole after the await.
      createH3PickupWindow(pickupWindow, duration);
      const projectId = await props.onEnsureSavedProject();
      latest.current = { ...latest.current, projectId };
      const existingJobs = await readJobs(projectId);
      const currentWindow = planH3DraftWindows(latest.current.segments).find(window => h3WindowKey(window) === chosenKey);
      if (!currentWindow) throw new Error("This song window changed while saving. Select its current missing window.");
      const segment = createH3PickupWindow(currentWindow, duration);
      if (generatedStillChoice?.context === stillContext) {
        if (stillContextRef.current !== generatedStillChoice.context) throw new Error("The shot changed while its generated frame was being prepared.");
        if (generatedStillChoice.shot.projectId !== projectId || h3RequestWindowKey(generatedStillChoice.shot) !== h3WindowKey(segment)) throw new Error("The generated still no longer matches this exact shot.");
        if (existingJobs.some(job => h3RequestWindowKey(job.request) === h3WindowKey(segment) && !isH3JobTerminal(job))) throw new Error("This exact shot already has an active video submission. Review its existing job first.");
        const request = bindPreparedSceneRequest(buildStillVideoRequest(generatedStillChoice, existingJobs));
        persistBatch({ version: 1, projectId, planSignature: request.planSignature, requests: [request], paused: false });
        setReview(null); await runBatch(); return;
      }
      const previous = existingJobs.filter(job => h3RequestWindowKey(job.request) === h3WindowKey(segment)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (previous && !isH3JobTerminal(previous)) throw new Error("This exact shot already has a submission. Check its existing render in Generation progress.");
      const authorities = selectH3ReferenceAssetIds(latest.current.referenceAssets, direction, pickupMode === "references" ? pickupCrowdIds : []);
      const referenceAssetIds = segment.animaticReferenceAssetIds ?? (pickupMode === "references" ? appendH3AestheticReferenceIds(authorities, latest.current.aestheticReferences, segment) : authorities);
      const input: H3GenerationRequest = {
        projectId, planSignature: segment.planSignature!, requirementId: segment.requirementId, timelineItemId: segment.timelineItemId,
        sectionId: segment.sectionId, songStart: segment.musicStart, songEnd: segment.musicEnd, prompt: direction,
        requestIntentId: crypto.randomUUID(), attempt: 0, referenceAssetIds, draftRevision: latest.current.draft?.revision ?? 0,
        ...identityPolicyChoiceForReferences(latest.current.referenceAssets, referenceAssetIds),
        ...(segment.animaticMotion ? { animaticMotion: segment.animaticMotion } : {}),
      };
      const request = bindPreparedSceneRequest(prepareH3PickupRequest(input, previous, existingJobs, pickupMode));
      if(pickupMode==="first-frame"){
        if (segment.animaticFirstFrame) {
          request.conditioning = segment.animaticFirstFrame;
          persistBatch({ version: 1, projectId, planSignature: request.planSignature, requests: [request], paused: false });
          setReview(null); await runBatch(); return;
        }
        if(!firstFrameFile)throw new Error("Choose a prepared native-size first-frame PNG. It will receive a CPU similarity screen before rendering.");
        const prepared=preparedFirstFrame;
        if(!prepared||preparedFirstFrameRef.current!==prepared||prepared.context!==firstFrameContext)throw new Error("The prepared native frame changed. Choose it again before submitting.");
        if(firstFrameFile.type!=="image/png"||firstFrameFile.size>32*1024*1024)throw new Error("Choose a PNG smaller than 32 MiB.");
        if(!request.identityPolicyFamily)throw new Error("First-frame shots require one or two named character authorities.");
        setMessage("Uploading and freezing this shot's first frame…");
        const expectedSha256=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await firstFrameFile.arrayBuffer())),byte=>byte.toString(16).padStart(2,"0")).join("");
        const upload=await uploadFileDirectlyToRustFs(firstFrameFile,"media-uploads/h3-first-frames");
        const {conditioning:_,...shot}=request;void _;
        const response=await fetch(prepared.source?"/api/generate/h3/native-first-frame":"/api/generate/h3/first-frame-artifacts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({shot,upload:{bucket:upload.bucket,objectKey:upload.objectKey},expectedSha256,...(prepared.source?{source:prepared.source}:{})}),signal:AbortSignal.timeout(120_000)});
        const result=await response.json();if(!response.ok)throw new Error(result.error||"Could not freeze the first frame.");
        const artifact=normalizeH3FirstFrameArtifact(result.artifact);if(!artifact||artifact.body.projectId!==projectId||artifact.body.pngSha256!==expectedSha256)throw new Error("First-frame registration returned a different image.");
        if(!mounted.current||preparedFirstFrameRef.current!==prepared||prepared.context!==firstFrameContextRef.current||latest.current.projectId!==projectId)throw new Error("The source frame or open project changed while freezing it. No generation was submitted.");
        if(prepared.source){
          const currentSource=latest.current.assets.find(asset=>asset.id===prepared.source!.assetId);
          if(!currentSource||identityPolicySha256(nativeFirstFrameSelection(currentSource,prepared.source.frameIndex))!==identityPolicySha256(prepared.source))throw new Error("The canonical source evidence changed before dispatch.");
          const receipt=assertNativeFirstFrameReceipt(result.sourceReceipt,prepared.source,artifact,shot);
          localStorage.setItem(`studio-native-first-frame-source-v1:${projectId}:${receipt.body.targetJobId}`,JSON.stringify(receipt));
        }
        request.conditioning={kind:"first-frame",artifactId:artifact.id,expectedSha256};
      }
      persistBatch({ version: 1, projectId, planSignature: request.planSignature, requests: [request], paused: false });
      setReview(null); await runBatch();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not create this shot."); }
    finally { preparingPickup.current = false; if (mounted.current && !running.current) setBusy(false); }
  }

  async function captureEarlierFirstFrame(){
    if(!earlierFrame||!nativeSourceSelection||!pickupWindow||busy)return;
    const projectId=props.projectId,windowKey=h3WindowKey(pickupWindow);setBusy(true);setError(null);
    const source=nativeSourceSelection,context=firstFrameContext;
    try{const url=buildGeneratedAssetPlaybackUrl(earlierFrame.asset);if(!url)throw new Error("The earlier take has no playable media.");const file=await captureH3FirstFrame(url,(source.frameIndex+0.5)/24);
      if(!mounted.current||latest.current.projectId!==projectId||!planH3DraftWindows(latest.current.segments).some(w=>h3WindowKey(w)===windowKey))return;
      const currentSource=latest.current.assets.find(asset=>asset.id===source.assetId);
      if(!currentSource||identityPolicySha256(nativeFirstFrameSelection(currentSource,source.frameIndex))!==identityPolicySha256(source))throw new Error("The source evidence changed during capture.");
      prepareFrame({file,context,source});setPickupMode("first-frame");setMessage(`Prepared native frame ${source.frameIndex} from ${earlierFrame.asset.title||"the earlier shot"}. Exact pixels will be verified before this new shot can render.`);
    }catch(failure){if(mounted.current&&latest.current.projectId===projectId)setError(failure instanceof Error?failure.message:"Could not prepare an earlier frame.");}
    finally{if(mounted.current)setBusy(false);}
  }

  async function recoverJob(job: H3GenerationJob, action: "resume" | "cancel" | "retry") {
    if (latest.current.storyApproved === false || (action === "retry" && !mayEdit())) return;
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
      // Checking an existing render must not revoke the user's saved pause.
      if (action === "resume" && batchRef.current && !batchRef.current.paused) await runBatch();
      setMessage(action === "cancel" ? "This shot is stopping safely. Other GPU work is not interrupted." : job.promptId || job.compiledPrompt
        ? "Checking the existing render. No replacement render was submitted." : "Resuming this shot's worker with the same saved inputs.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Job recovery failed."); }
    finally { if (mounted.current && !running.current) setBusy(false); }
  }

  async function checkSimilarity(job: H3GenerationJob) {
    if (!mayEdit() || busy || accepting) return;
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
  const pickupDuration = pickupWindow?.animaticShotId ? String(pickupMaximum) : pickupEdits[pickupEditKey]?.duration ?? String(Math.min(3, pickupMaximum));
  const pickupDurationValid = pickupMaximum > 0 && pickupDuration.trim() !== "" && Number.isFinite(Number(pickupDuration))
    && Number(pickupDuration) >= Math.min(1, pickupMaximum) && Number(pickupDuration) <= pickupMaximum;
  const pickupPrevious = pickupWindow && pickupDurationValid ? jobs.filter(job => !job.request.conditioning
    && h3RequestWindowKey(job.request) === h3WindowKey(createH3PickupWindow(pickupWindow, Number(pickupDuration))))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] : undefined;
  const pickupCrowdIds = pickupEdits[pickupEditKey]?.crowdIds ?? pickupPrevious?.references.filter(ref => ref.role === "crowd").map(ref => ref.assetId) ?? [];
  const crowdAssets = props.referenceAssets.filter(ref => ref.kind === "crowd" || ref.role === "crowd");
  let pickupReferenceIds: string[] = [];
  let pickupReferenceError: string | null = null;
  try { const authorities = selectH3ReferenceAssetIds(props.referenceAssets, pickupDirection, pickupMode === "references" ? pickupCrowdIds : []); pickupReferenceIds = pickupWindow?.animaticReferenceAssetIds ?? (pickupMode === "references" && pickupWindow ? appendH3AestheticReferenceIds(authorities, props.aestheticReferences, pickupWindow) : authorities); }
  catch (failure) { pickupReferenceError = failure instanceof Error ? failure.message : "Check this shot's references."; }
  const pickupIdentityIds=props.referenceAssets.filter(ref=>pickupReferenceIds.includes(ref.id)&&(ref.kind==="character"||ref.role.startsWith("character"))).map(ref=>ref.id);
  const earlierFrame=pickupWindow?earlierH3FirstFrameSource(props.assets,props.projectId,pickupWindow.planSignature,pickupWindow.musicStart,pickupIdentityIds):undefined;
  const nativeSourceKey=earlierFrame?identityPolicySha256({assetId:earlierFrame.asset.id,evidence:currentReferenceIdentityApprovalSha256(earlierFrame.asset),trim:earlierFrame.asset.trimStart??0}):"";
  const nativeFrameIndex=nativeFrameChoice?.sourceKey===nativeSourceKey?nativeFrameChoice.frameIndex??undefined:earlierFrame?.frameIndex;
  let nativeSourceSelection:NativeFirstFrameSelection|undefined,nativeSourceError:string|undefined;
  try{if(earlierFrame&&nativeFrameIndex!==undefined)nativeSourceSelection=nativeFirstFrameSelection(earlierFrame.asset,nativeFrameIndex);}catch(failure){nativeSourceError=failure instanceof Error?failure.message:"The exact native source is unavailable.";}
  const firstFrameContext=identityPolicySha256({target:pickupEditKey,planSignature:pickupWindow?.planSignature??"",duration:Number(pickupDuration),direction:pickupDirection,
    references:props.referenceAssets,source:nativeSourceSelection??null});
  const firstFrameFile=preparedFirstFrame?.context===firstFrameContext?preparedFirstFrame.file:null;
  const stillContext = stillCanonicalContext({ projectId: props.projectId, windowKey: pickupEditKey, references: props.referenceAssets,
    plan: props.project?.placementPlan ?? null, currentIdentity: props.project?.currentIdentity ?? null,
    storyApproved: props.storyApproved ?? true });
  stillContextRef.current = stillContext;
  const stillFormGuard = identityPolicySha256({ context: stillContext, direction: pickupDirection, duration: pickupDuration });
  stillFormGuardRef.current = stillFormGuard;
  async function prepareStillShot(): Promise<H3GenerationRequest> {
    if (pickupWindow?.animaticShotId) throw new Error("Use the saved reviewed animatic image for this motion shot.");
    if (!pickupWindow || !pickupDurationValid || !pickupDirection.trim() || !mayEdit()) throw new Error("Choose a current missing window, duration and named video direction first.");
    const guard = stillFormGuard, key = h3WindowKey(pickupWindow), direction = pickupDirection, duration = Number(pickupDuration);
    const projectId = await props.onEnsureSavedProject();
    if (latest.current.projectId !== projectId || !mounted.current || latest.current.storyApproved === false) throw new Error("The saved project changed.");
    const current = planH3DraftWindows(latest.current.segments).find(window => h3WindowKey(window) === key);
    if (!current || guard !== stillFormGuardRef.current) throw new Error("The missing shot changed while saving.");
    const target = createH3PickupWindow(current, duration);
    const referenceAssetIds = selectH3ReferenceAssetIds(latest.current.referenceAssets, direction);
    const policy = identityPolicyChoiceForReferences(latest.current.referenceAssets, referenceAssetIds);
    if (!policy.identityPolicyFamily) throw new Error("Choose one or two named characters for a screened first-frame continuation.");
    return { projectId, planSignature: target.planSignature!, requirementId: target.requirementId, timelineItemId: target.timelineItemId,
      sectionId: target.sectionId, songStart: target.musicStart, songEnd: target.musicEnd, prompt: direction,
      referenceAssetIds, requestIntentId: crypto.randomUUID(), attempt: 0, draftRevision: latest.current.draft?.revision ?? 0, ...policy };
  }
  useEffect(()=>{firstFrameContextRef.current=firstFrameContext;},[firstFrameContext]);
  async function checkBankReferences(assetId: string) {
    const check = latest.current.onCheckCurrentReferences;
    if (!check || !mayEdit() || checkingCurrentReferences.current) return;
    const projectId = latest.current.projectId;
    checkingCurrentReferences.current = true; setBusy(true); setError(null); setMessage(null); setReview(null);
    try {
      await check(assetId);
      if (mounted.current && latest.current.projectId === projectId) setMessage("Updated-reference check saved. Review the result before choosing this take.");
    } catch (failure) {
      if (mounted.current && latest.current.projectId === projectId) setError(failure instanceof Error ? failure.message : "Could not check this take against the updated references.");
    } finally {
      checkingCurrentReferences.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const activeJobs = jobs.filter(job => !isH3JobTerminal(job));
  const attemptsLeft = (job: H3GenerationJob) => 2 - Math.max(job.request.attempt ?? 0, ...jobs.filter(candidate => candidate.request.requestIntentId === job.request.requestIntentId).map(candidate => candidate.request.attempt ?? 0));
  const selectedIds = new Set(props.draft?.assetIds ?? []);
  const liveTakes = buildLiveDraftTakes(props.assets, jobs, [...selectedIds]);
  const readOnly = props.storyApproved === false;
  const editingBlocked = readOnly || busy || accepting || activeJobs.length > 0;
  const selected = props.assets.filter(asset => selectedIds.has(asset.id));
  const referencesReady = props.referenceAssets.some(asset => asset.role === "character-1" && asset.storageStatus === "uploaded" && asset.storageBucket && asset.storagePath && asset.displayName?.trim())
    && props.referenceAssets.some(asset => asset.role === "environment" && asset.storageStatus === "uploaded" && asset.storageBucket && asset.storagePath && asset.displayName?.trim());
  const unavailable = !props.segments.length ? "Confirm a story first." : !referencesReady ? "Upload named character and location references in Setup." : null;

  return <div className="space-y-3">
    {readOnly ? <p role="status" className="text-sm text-fg-3">Confirm the current Story to change the draft. Saved progress and take playback remain available; upcoming submissions are paused.</p> : null}
    {liveTakes.length ? <Surface aria-label="Arriving and saved takes">
      <h3 className="text-sm font-semibold">Arriving and saved takes</h3>
      <p className="text-xs text-fg-3">Open a completed take while the queue continues. Viewing does not select or approve footage.</p>
      {liveTakes.slice(0, visibleJobLimit).map(({ asset, playbackUrl, selected }) => <div key={asset.id} className="border-b border-line py-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{asset.title ?? "Saved take"} · {selected ? "Selected" : "Banked"}{generatedAssetDraftIdentityBlockReason(asset) ? ` · ${generatedAssetDraftIdentityBlockReason(asset)}` : ""}</span>
          <Button onClick={() => setOpenedTake(openedTake?.projectId === props.projectId && openedTake.id === asset.id ? null : { projectId: props.projectId, id: asset.id })}>
            {openedTake?.projectId === props.projectId && openedTake.id === asset.id ? "Close take" : "Open saved take"}</Button></div>
        {openedTake?.projectId === props.projectId && openedTake.id === asset.id ? <LiveDraftTakeViewer key={`${props.projectId}:${asset.id}`} asset={asset} playbackUrl={playbackUrl} /> : null}
        <label className="block text-xs text-fg-3">Revision notes<textarea maxLength={6000} aria-label={`Notes for ${asset.title ?? asset.id}`} value={revisionText[asset.id] ?? ""}
          onChange={event => updateNote(asset.id, event.target.value)} className="mt-1 w-full rounded-md border border-line bg-ink-1 p-2" /></label>
        <Button disabled={editingBlocked || Boolean(batch && !batch.paused) || !asset.target || !findH3TargetSegment(props.segments, asset.target)} onClick={() => void revise(asset)}>Render revised take, then pause</Button>
      </div>)}
      {liveTakes.length > visibleJobLimit ? <Button onClick={() => setJobHistory({ projectId: props.projectId, limit: visibleJobLimit + 40 })}>Show more saved takes</Button> : null}
    </Surface> : null}
    <Surface aria-label="Create the draft">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl space-y-1">
          <h2 className="text-lg font-semibold text-fg-0">Bring the story to life</h2>
          <p className="text-sm text-fg-2">MiniMax creates the missing shots from your references and assembles them with the footage you already have.</p>
          <p className="text-xs text-fg-3">New character shots receive a provisional similarity screen. Identity remains unverified; review the assembled cut.</p>
          <p className="text-xs text-fg-3">{missing.length ? `${missing.length} unfilled window${missing.length === 1 ? "" : "s"}` : props.segments.some(segment => segment.kind === "gap" || !segment.videoUrl) ? "Review the current plan to prepare its motion windows" : "Every song window has footage"}{activeJobs.length ? ` · ${activeJobs.length} renders in progress` : ""}. Review the cut before accepting it for Finish.</p>
        </div>
        <Button variant="primary" disabled={editingBlocked || props.segments.some(segment => segment.animaticShotId) || Boolean(unavailable) || Boolean(batch?.requests.length) || !missing.length || activeJobs.length > 0}
          reason={props.segments.some(segment => segment.animaticShotId) ? "Prepare each reviewed animatic shot below." : unavailable}
          onClick={() => void generateMissing()}>{busy ? "Creating draft…" : activeJobs.length ? "Generation in progress" : "Create missing shots"}</Button>
      </div>
      {unavailable ? <p className="mt-3 text-sm text-fg-3">{unavailable}</p> : null}
      <details className="mt-3 rounded-md border border-line p-3">
        <summary className="cursor-pointer text-sm text-fg-2">Create one shot · advanced</summary>
        <div className="mt-3 space-y-3">
          <label className="block text-xs text-fg-3">Missing story window<select aria-label="One shot story window"
            value={pickupWindow ? h3WindowKey(pickupWindow) : ""} disabled={editingBlocked}
            onChange={event => setPickupKey(event.target.value)} className="mt-1 block w-full rounded-md border border-line bg-ink-1 p-2 text-sm text-fg-1">
            {!pickupWindow ? <option value="">Select a missing window</option> : null}
            {missing.map(window => <option key={h3WindowKey(window)} value={h3WindowKey(window)}>{window.label} · {preciseClock(window.musicStart)}–{preciseClock(window.musicEnd)}{window.musicEnd - window.musicStart < 1 ? " · short boundary sliver" : ""}</option>)}
          </select></label>
          {pickupWindow ? <>
            <label className="block text-xs text-fg-3">Shot input<select aria-label="One shot input mode" value={pickupMode} disabled={editingBlocked}
              onChange={event=>{setPickupMode(event.target.value as "references"|"first-frame");setGeneratedStillChoice(null);}} className="mt-1 block w-full rounded-md border border-line bg-ink-1 p-2 text-sm text-fg-1">
              <option value="references">Named reference images</option><option value="first-frame">Continue from a first frame</option>
            </select></label>
            {pickupMode==="first-frame" ? pickupWindow.animaticFirstFrame ? <p className="text-xs text-fg-3">Uses the saved reviewed native image for this shot. Its identity screen runs before video generation.</p> : <div className="space-y-2">
              {earlierFrame?<label className="block text-xs text-fg-3">Native first-frame index
                <input aria-label="Native first-frame index" type="number" step={1} min={Math.floor((earlierFrame.asset.trimStart??0)*24+1e-6)} max={earlierFrame.frameIndex} value={nativeFrameIndex??""} disabled={editingBlocked}
                  onChange={event=>{const index=Number(event.target.value);prepareFrame(null);if(event.target.value==="")setNativeFrameChoice({sourceKey:nativeSourceKey,frameIndex:null});else if(Number.isSafeInteger(index))setNativeFrameChoice({sourceKey:nativeSourceKey,frameIndex:index});}}
                  className="ml-2 w-24 rounded-md border border-line bg-ink-1 p-2 text-sm text-fg-1"/>
              </label>:null}
              <Button disabled={editingBlocked||!nativeSourceSelection} onClick={()=>void captureEarlierFirstFrame()}>Use frame from earlier shot</Button>
              <p className="text-xs text-fg-3">{earlierFrame?`Uses the selected native trim of ${earlierFrame.asset.title||"the closest earlier eligible take"}.`:"An earlier eligible native take in this project and plan can supply the first frame."}</p>
              {nativeSourceError?<p role="alert" className="text-xs text-danger">{nativeSourceError}</p>:null}
              {nativeSourceSelection?<label className="block text-xs text-fg-3">Or import this exact native frame PNG
                <input key={`native:${firstFrameContext}`} aria-label="Exact native source PNG" type="file" accept="image/png" disabled={editingBlocked}
                  onChange={event=>{const file=event.target.files?.[0];prepareFrame(file?{file,context:firstFrameContext,source:nativeSourceSelection}:null);}} className="mt-1 block w-full text-sm text-fg-1"/>
                <span className="mt-1 block">Frame {nativeSourceSelection.frameIndex} only. The server requires exact historical and current decoded pixels. Browser color differences are rejected; use a lossless canonical-decoder PNG.</span>
              </label>:null}
              <label className="block text-xs text-fg-3">Or use a separately prepared first-frame PNG · 1344×768 opaque<input key={firstFrameContext} aria-label="Prepared first-frame PNG" type="file" accept="image/png" disabled={editingBlocked}
              onChange={event=>{const file=event.target.files?.[0];prepareFrame(file?{file,context:firstFrameContext}:null);}} className="mt-1 block w-full text-sm text-fg-1" />
              <span className="mt-1 block">{firstFrameFile?`Prepared: ${firstFrameFile.name}. `:""}Separate uploads do not claim a verified frame from the earlier take. The actual image receives a provisional one-image numerical screen before GPU video generation. Every intended video frame must then pass separately. Switching input type starts a new take and keeps earlier results.</span></label></div>:null}
            <fieldset className="space-y-2 rounded-md border border-line p-3" disabled={editingBlocked || pickupMode === "first-frame" || Boolean(pickupWindow.animaticShotId)}>
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
            <fieldset className="space-y-2 rounded-md border border-line p-3" disabled={editingBlocked || pickupMode !== "references" || Boolean(pickupWindow.animaticShotId)}>
              <legend className="px-1 text-xs text-fg-2">Shot and style refs · choose up to three for this shot</legend>
              <p className="text-xs text-fg-3">Character sheets remain identity and wardrobe authorities. First-frame video uses its screened PNG only.</p>
              {(props.aestheticReferences?.assets ?? []).filter(asset => aestheticReferenceApplies(asset, pickupWindow)).map(asset => {
                const ids = props.aestheticReferences?.shots[pickupWindow.timelineItemId ?? ""] ?? [];
                return <div key={asset.id} className="flex items-center gap-2 text-xs text-fg-2"><label className="flex items-center gap-2">
                  <input type="checkbox" checked={ids.includes(asset.id)} disabled={asset.storageStatus !== "uploaded" || (!ids.includes(asset.id) && ids.length >= 3)} onChange={event => {
                    if (pickupWindow.timelineItemId) props.onAestheticSelection?.(pickupWindow.timelineItemId, event.target.checked ? [...ids, asset.id] : ids.filter(id => id !== asset.id));
                  }} />
                  {asset.displayName} · {asset.purpose}</label>
                  <div className="h-12 w-20 overflow-hidden"><ReferenceSheetPreview src={asset.previewUrl} name={asset.displayName} /></div>
                </div>;
              })}
              {(props.aestheticReferences?.shots[pickupWindow.timelineItemId ?? ""] ?? []).filter(id => !(props.aestheticReferences?.assets ?? []).some(asset => asset.id === id && aestheticReferenceApplies(asset, pickupWindow))).map(id => <button type="button" key={id} onClick={() => props.onAestheticSelection?.(pickupWindow.timelineItemId!, (props.aestheticReferences?.shots[pickupWindow.timelineItemId!] ?? []).filter(value => value !== id))} className="text-xs text-danger">Remove unavailable selection · {id}</button>)}
              {!props.aestheticReferences?.assets.length ? <p className="text-xs text-fg-3">Add originals in Setup.</p> : null}
            </fieldset>
            <label className="block text-xs text-fg-3">Edit duration (seconds)<input aria-label="One shot edit duration" type="number" step="any"
              min={Math.min(1, pickupMaximum)} max={pickupMaximum} value={pickupDuration} disabled={editingBlocked || Boolean(pickupWindow.animaticShotId)}
              onChange={event => { setGeneratedStillChoice(null); setPickupEdits(current => ({ ...current, [pickupEditKey]: { ...current[pickupEditKey], duration: event.target.value } })); }}
              className="mt-1 block w-32 rounded-md border border-line bg-ink-1 p-2 text-sm text-fg-1" /></label>
            <p className="text-xs text-fg-3">{pickupDurationValid ? `This shot fills ${preciseClock(pickupWindow.musicStart)}–${preciseClock(pickupWindow.musicStart + Number(pickupDuration))}.` : `Choose ${Math.min(1, pickupMaximum)}–${pickupMaximum.toFixed(3)} seconds.`} The rest of the draft stays in place.{pickupMaximum < 1 ? " This explicitly selected boundary sliver uses its full duration." : ""}</p>
            <label className="block text-xs text-fg-3">Shot direction<textarea aria-label="One shot direction" rows={4} maxLength={6000}
              value={pickupDirection} disabled={editingBlocked}
              onChange={event => { setGeneratedStillChoice(null); setPickupEdits(current => ({ ...current, [pickupEditKey]: { ...current[pickupEditKey], direction: event.target.value } })); }}
              className="mt-1 block w-full rounded-md border border-line bg-ink-1 p-2 text-sm text-fg-1" /></label>
            {pickupWindow.animaticShotId ? <p className="text-xs text-fg-3">Motion uses the reviewed image, reference packet and frame window for this shot. Revise those in Story when needed.</p> : <MiniMaxStillPanel projectId={props.projectId} context={stillContext} disabled={editingBlocked || !pickupDurationValid || activeJobs.length > 0 || Boolean(batch?.requests.length)}
              prepareShot={prepareStillShot} onUse={selection => { setPickupEdits(current => ({ ...current, [pickupEditKey]: { ...current[pickupEditKey], ...restoreStillShotForm(selection.shot) } })); setGeneratedStillChoice({ ...selection, context: stillContext }); setMessage("The reviewed MiniMax frame is prepared with its frozen video direction. Create this shot to start identity screening and video generation."); }} />}
            {generatedStillChoice?.context === stillContext ? <p role="status" className="text-xs text-fg-2">Generated frame prepared. The video direction and named references are frozen for this take. <button type="button" className="underline" onClick={() => setGeneratedStillChoice(null)}>Clear generated frame</button></p> : null}
          </> : <p className="text-xs text-fg-3">Select a short boundary sliver explicitly, or prepare a missing story window.</p>}
          {batch?.requests.length ? <p className="text-xs text-fg-3">Continue or clear the saved requests before creating one shot.</p> : null}
          <Button disabled={editingBlocked || Boolean(pickupWindow?.animaticRetainedSource) || Boolean(unavailable) || !pickupWindow || !pickupDurationValid || !pickupDirection.trim() || Boolean(pickupReferenceError) || activeJobs.length > 0 || Boolean(batch?.requests.length)}
            reason={unavailable} onClick={() => void generateOneShot()}>Create this shot</Button>
        </div>
      </details>
      {message ? <p role="status" className="mt-3 text-sm text-fg-2">{message}</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
      {batch?.requests.length ? <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-3">
        <span>{batch.requests.length} saved shot request{batch.requests.length === 1 ? "" : "s"}{batch.paused ? " · paused" : " · continues when this project is open"}</span>
        {batch.paused ? <Button disabled={editingBlocked || batch.planSignature !== props.segments[0]?.planSignature} onClick={() => {
          if (!mayEdit()) return;
          persistBatch({ ...batch, paused: false }); void runBatch();
        }}>Continue saved batch</Button> : <Button onClick={() => persistBatch({ ...batch, paused: true })}>Pause remaining shots</Button>}
        {batch.paused && !busy ? <Button disabled={accepting || readOnly} onClick={() => persistBatch(null)}>Clear pending requests</Button> : null}
      </div> : null}
      {batch?.requests.length ? <details className="mt-2 text-xs text-fg-3"><summary className="cursor-pointer">Inspect saved submission queue</summary>
        <ol className="mt-2 space-y-2">{batch.requests.map((request, index) => <li key={`${request.requestIntentId}:${request.attempt ?? 0}:${index}`}>
          {index + 1}. {request.sectionId} · {preciseClock(request.songStart)}–{preciseClock(request.songEnd)} · saved request
          <p>{request.prompt}</p>
        </li>)}</ol>
      </details> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={!props.segments.length || editingBlocked} onClick={() => {
          setError(null); void props.onReviewDraft().then(setReview).catch(failure => setError(failure instanceof Error ? failure.message : "Preview failed."));
        }}>Review assembled draft</Button>
        <Button variant="success" disabled={!review || editingBlocked || missing.length > 0} reason="Review the complete draft first."
          onClick={() => {
            if (!review || !mayEdit()) return;
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
      <ul className="divide-y divide-line">{jobs.slice(0, visibleJobLimit).map(job => {
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
            <Button disabled={editingBlocked || !range} onClick={() => void checkSimilarity(job)}>Check similarity</Button>
          </> : null}
          {(["submission_unknown", "rendering", "persisting"] as string[]).includes(job.state) && !job.workerRecoveries?.some(recovery => !recovery.runId)
            ? <Button disabled={readOnly || busy || accepting} onClick={() => void recoverJob(job, "resume")}>Check existing render</Button> : null}
          {(job.state !== "cancelled" && job.workerRecoveries?.some(recovery => !recovery.runId))
            || (job.state === "failed" && job.runId && !job.promptId && !job.compiledPrompt && !job.result && !job.cancelRequestedAt)
            ? <Button disabled={readOnly || busy || accepting} onClick={() => void recoverJob(job, "resume")}>Resume worker</Button>
            : job.state === "failed" || job.state === "cancelled" ? <Button disabled={editingBlocked || attemptsLeft(job) <= 0 || !findH3TargetSegment(props.segments, job.target)} onClick={() => void recoverJob(job, "retry")}>Retry shot ({attemptsLeft(job)} left)</Button> : null}
          {!isH3JobTerminal(job) && job.state !== "cancel_requested" ? <Button variant="danger" disabled={accepting || readOnly} onClick={() => void recoverJob(job, "cancel")}>Cancel this shot</Button> : null}
        </span>
        {job.state === "ready" && asset?.identityVerification?.status === "unverifiable" && !rejected && range ? <NativeHandleDetails asset={asset} range={range} disabled={editingBlocked} onStartFrame={frame=>{
            handleFramesRef.current={...handleFramesRef.current,[job.id]:frame};setHandleFrames(handleFramesRef.current);setReview(null);
          }}/> : null}
        {asset ? <SimilarityFilterNote asset={asset} /> : null}
      </li>; })}</ul>
      {jobs.length > visibleJobLimit ? <Button onClick={() => setJobHistory({ projectId: props.projectId, limit: visibleJobLimit + 40 })}>
        Show earlier generation jobs ({Math.min(40, jobs.length - visibleJobLimit)} more)
      </Button> : null}
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
          maxLength={6000} onChange={event => updateNote(asset.id, event.target.value)}
          className="mt-1 block w-full rounded-md border border-line bg-ink-1 p-2 text-sm text-fg-1" /></label>
        <div className="mt-2 flex gap-2"><Button disabled={editingBlocked} onClick={() => void revise(asset)}>Revise shot</Button>
          <Button variant="danger" disabled={editingBlocked} onClick={() => { if (mayEdit()) { props.onRejectAsset(asset.id); setReview(null); } }}>Reject shot</Button></div>
      </div>)}</div>
    </Surface> : null}
    {props.assets.some(asset => !selectedIds.has(asset.id) && asset.mediaKind === "video" && asset.status === "completed" && asset.reviewStatus === "pending") ? <Surface>
      <h3 className="mb-2 text-sm font-semibold">Other takes</h3>
      {props.assets.filter(asset => !selectedIds.has(asset.id) && asset.mediaKind === "video" && asset.status === "completed" && asset.reviewStatus === "pending").map(asset => {
        const block = generatedAssetDraftIdentityBlockReason(asset);
        const checkBlock = asset.currentReferenceIdentity?.required ? currentReferenceBankCheckBlockReason(asset, props.segments) : null;
        return <div key={asset.id} className="py-2 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span>{asset.title}{block ? ` · ${block}` : ""}</span><div className="flex flex-wrap gap-2">
          {asset.currentReferenceIdentity?.required && props.onCheckCurrentReferences ? <Button disabled={editingBlocked || Boolean(checkBlock)} reason={checkBlock}
            onClick={() => void checkBankReferences(asset.id)}>Check against updated references</Button> : null}
          <Button disabled={editingBlocked || Boolean(block) || !asset.target || !findH3TargetSegment(props.segments, asset.target)} reason={block} onClick={() => { if (mayEdit()) { props.onSelectAsset(asset); setReview(null); } }}>Use in draft</Button></div></div><SimilarityFilterNote asset={asset} /></div>;
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
