import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { probeMediaFile, type ProbedMediaFile } from "@/components/studio/mediaProbe";
import { buildSwarmComfyDirectUrl, extractComfyOutputRefs, getComfyHistoryStatus, type ComfyOutputRef } from "@/components/studio/localGeneration";
import { H3_FPS, H3_HEIGHT, H3_WIDTH, type H3GenerationJob } from "@/components/studio/h3Generation";
import type { LocalGenerationOutput } from "@/trigger/localGeneration";
import { downloadMediaGatewayFile, getMediaGatewayConfig, uploadFileToMediaGateway } from "./mediaGateway";
import { normalizeStudioOwnerSegment } from "./studioStoragePaths";
import { readStudioProject } from "./studioProjectStore";
import { materializeH3Job } from "./h3GenerationServer";
import { validateSavedGenerationScope } from "./generationScopeServer";
import { downloadH3ReferenceImage, pinH3JobReferences, readH3Job, updateH3Job } from "./h3JobStore";
import { buildH3Workflow } from "./h3Workflow";
import { assessH3Identity, type H3IdentityDiagnostic } from "./h3IdentityVerification";
import { planH3ReferenceConditioning } from "./h3ReferenceConditioning";
import { prepareH3IdentityPolicy, type PreparedH3PolicyReference } from "./h3DraftPolicyPreparation";
import { canonicalIdentityPolicyJson, identityPolicySha256 } from "@/components/studio/issuedIdentityPolicy";
import { assertH3IdentityAssessmentScope, identityAssessmentAsset, type H3IdentityAssessmentScope, type H3IdentityAssessment } from "@/components/studio/h3IdentityAssessment";
import { readH3IdentityAssessment, writeH3IdentityAssessment } from "./h3IdentityAssessmentStore";
import { openSwarmComfyClient, SwarmComfyClientUnavailable } from "./swarmComfyClient";
import { H3_FIRST_FRAME_PROFILE } from "@/components/studio/h3FirstFrame";
import { prepareH3FirstFrame } from "./h3FirstFramePreflight";
import { assertH3FirstFrameMatchesJob } from "./h3FirstFrameStore";

export type H3JobReference = { ownerId: string; projectId: string; jobId: string; mode?: "identity-recheck"|"current-reference-assessment"; assessment?: H3IdentityAssessmentScope; currentRequestId?:string };

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const executeImagePreparation = promisify(execFile);
const IMAGE_EXTENSIONS: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };
class H3ProviderRejection extends Error {}

async function providerJson(baseUrl: string, route: string, body?: unknown) {
  const response = await fetch(buildSwarmComfyDirectUrl(baseUrl, route), {
    ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    cache: "no-store", signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const message = `SwarmUI ${route.split("/")[0]} returned HTTP ${response.status}.`;
    if (route === "prompt" && response.status >= 400 && response.status < 500) throw new H3ProviderRejection(message);
    throw new Error(message);
  }
  return await response.json() as Record<string, unknown>;
}

/** Search by our durable correlation, including the response-loss window after POST /prompt. */
export function findH3ProviderPrompt(jobId: string, queue: Record<string, unknown>, history: Record<string, unknown>) {
  for (const entry of [...((queue.queue_running as unknown[]) ?? []), ...((queue.queue_pending as unknown[]) ?? [])]) {
    if (!Array.isArray(entry)) continue;
    const extra = entry[3] as Record<string, unknown> | undefined;
    if (extra?.stack_structure_h3_job === jobId && typeof entry[1] === "string") return entry[1];
  }
  for (const [id, value] of Object.entries(history)) {
    const prompt = (value as { prompt?: unknown[] })?.prompt;
    const extra = prompt?.[3] as Record<string, unknown> | undefined;
    if (extra?.stack_structure_h3_job === jobId) return id;
  }
  return undefined;
}

export function validateH3VideoProbe(probe: ProbedMediaFile, frames: number, neededDuration: number) {
  const video = probe.primaryVideoStream;
  if (!video || video.codecName !== "h264" || video.width !== H3_WIDTH || video.height !== H3_HEIGHT
    || Math.abs((video.frameRate ?? 0) - H3_FPS) > 0.01 || probe.duration + 0.01 < neededDuration
    || Math.abs(probe.duration - frames / H3_FPS) > 0.1) {
    throw new Error("H3 returned video outside the required codec, size, frame rate or duration contract.");
  }
}

export function h3OutputSubfolder(value: string | undefined, jobId: string) {
  if (!value || /^[\\/]|^[a-z]:/i.test(value)) throw new Error("The provider returned an invalid output reference.");
  const parts = value.replace(/\\/g, "/").split("/");
  if (parts.some(part => !part || part === "." || part === "..") || parts.join("/") !== `stack-structure/${jobId}`) {
    throw new Error("The provider returned an invalid output reference.");
  }
  return parts.join("/");
}

function cancellationRequested(job: H3GenerationJob) { return Boolean(job.cancelRequestedAt) || job.state === "cancel_requested"; }

async function uploadReference(baseUrl: string, job: H3GenerationJob, index: number, folder: string, prepared?: PreparedH3PolicyReference) {
  const ref = job.references[index];
  const media = prepared ? { bytes: new Uint8Array(prepared.bytes).buffer, mime: prepared.mime } : await downloadH3ReferenceImage(ref);
  const extension = IMAGE_EXTENSIONS[media.mime];
  if (!extension || !media.bytes.byteLength || media.bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("H3 references must be PNG, JPEG or WebP images smaller than 32 MiB.");
  const hash = createHash("sha256").update(Buffer.from(media.bytes)).digest("hex");
  const imagePath = path.join(folder, `${index}${extension}`);
  await writeFile(imagePath, Buffer.from(media.bytes));
  const probe = await probeMediaFile(imagePath);
  const image = probe.primaryVideoStream;
  if (!image?.width || !image.height || image.width < 256 || image.height < 256
    || image.width * image.height > 64 * 1024 * 1024) throw new Error("Reference images must be readable and at least 256 pixels on each side.");
  const preparation = planH3ReferenceConditioning({ profile: job.profile, conditioningPreparationVersion: job.conditioningPreparationVersion,
    rawSha256: hash, width: image.width, height: image.height, canonicalName: ref.canonicalName, role: ref.role });
  let conditioningBytes = new Uint8Array(media.bytes);
  let conditioningExtension = extension;
  let conditioningMime = media.mime;
  if (preparation.operation === "crop") {
    const croppedPath = path.join(folder, `conditioning-${index}.png`);
    await executeImagePreparation(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", imagePath,
      "-vf", preparation.ffmpegFilter!, "-frames:v", "1", "-pix_fmt", "rgb24", croppedPath], { timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true });
    conditioningBytes = new Uint8Array(await readFile(croppedPath));
    const cropped = (await probeMediaFile(croppedPath)).primaryVideoStream;
    if (cropped?.width !== preparation.crop!.width || cropped.height !== preparation.crop!.height) throw new Error("Conditioning crop dimensions did not match the pinned plan.");
    conditioningExtension = ".png";
    conditioningMime = "image/png";
  }
  const conditioningHash = createHash("sha256").update(conditioningBytes).digest("hex");
  const form = new FormData();
  form.set("subfolder", `stack-structure/${job.id}`);
  form.set("type", "input");
  form.set("overwrite", "true");
  form.set("image", new File([conditioningBytes], `${conditioningHash}${conditioningExtension}`, { type: conditioningMime }));
  const response = await fetch(buildSwarmComfyDirectUrl(baseUrl, "upload/image"), {
    method: "POST", body: form, signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`SwarmUI reference upload returned HTTP ${response.status}.`);
  const uploaded = await response.json() as { name?: string; subfolder?: string };
  if (!uploaded.name || /[\\/]/.test(uploaded.name) || uploaded.subfolder !== `stack-structure/${job.id}`) {
    throw new Error("SwarmUI returned an invalid reference binding.");
  }
  return { path: `${uploaded.subfolder}/${uploaded.name}`, hash, conditioningHash, preparation };
}

function completedOutput(job: H3GenerationJob): LocalGenerationOutput {
  const asset = job.result!.asset;
  return { provider: "swarmui", status: "completed", message: "H3 shot persisted for draft review.",
    jobId: job.id, generatedAsset: asset, promptId: job.promptId,
    assets: [{ provider: "swarmui", kind: "video", filename: "shot.mp4", mimeType: "video/mp4",
      providerUrl: asset.resultUrl!, storage: asset.fullStorage! }] };
}

export async function runH3Generation(reference: H3JobReference, runId: string,
  options: { wait: (seconds: number) => Promise<unknown>; stage: (label: string) => void; timeoutSeconds?: number;
    identityDiagnostic?: (event: H3IdentityDiagnostic) => void }) {
  if (reference.mode === "identity-recheck") return recheckH3Identity(reference, options);
  if(reference.mode==="current-reference-assessment"){
    if(!reference.currentRequestId)throw new Error("Explicit current-reference request is required.");
    const{runCurrentIdentityRequest}=await import("./currentIdentityRunner");
    const outcome=await runCurrentIdentityRequest(reference.ownerId,reference.projectId,reference.currentRequestId,runId,options);
    return {provider:"swarmui" as const,status:"completed" as const,message:"Current-reference CPU assessment completed; project selection is unchanged.",assets:[],currentIdentityRequest:outcome};
  }
  const { ownerId, projectId, jobId } = reference;
  const storedJob = await readH3Job(ownerId, projectId, jobId);
  if (!storedJob) throw new Error("Generation job not found.");
  let job: H3GenerationJob = storedJob;
  if (job.state === "ready" && job.result) return completedOutput(job);
  if (job.state === "cancelled") throw new Error("This generation job was cancelled.");
  const baseUrl = (process.env.LOCAL_SWARMUI_URL || process.env.SWARMUI_URL || "").replace(/\/+$/, "");
  const temp = await mkdtemp(path.join(tmpdir(), "stack-h3-"));
  const update = async (patch: Partial<H3GenerationJob>) => {
    job = await updateH3Job(ownerId, projectId, jobId, current => {
      if (current.runId && current.runId !== runId) throw new Error("A different Trigger run owns this job.");
      if (current.state === "cancelled" && patch.state !== "cancelled") {
        throw new Error("This generation job was cancelled.");
      }
      if (patch.identityPolicy && current.identityPolicy && canonicalIdentityPolicyJson(patch.identityPolicy) !== canonicalIdentityPolicyJson(current.identityPolicy)) {
        throw new Error("An issued identity policy cannot be replaced on an existing job.");
      }
      if (cancellationRequested(current) && patch.state && patch.state !== "cancelled") {
        if (patch.state === "rendering") return { ...current, ...patch, state: "cancel_requested" };
        throw new Error("This generation job was cancelled.");
      }
      return { ...current, ...patch };
    });
    return job;
  };
  try {
    if (!baseUrl || !/^https?:\/\//.test(baseUrl)) throw new Error("The SwarmUI gateway is not configured.");
    if (job.runId && job.runId !== runId) throw new Error("A different Trigger run owns this job.");
    await update({ runId, error: undefined });
    const saved = await readStudioProject(ownerId, projectId, { fresh: true });
    const config = getMediaGatewayConfig();
    if (!saved || !config) throw new Error("The saved project is unavailable.");
    if (!job.promptId && job.state !== "submitting" && job.state !== "submission_unknown" && !cancellationRequested(job)) {
      await validateSavedGenerationScope(ownerId, saved);
      const current = await pinH3JobReferences(materializeH3Job(ownerId, saved, job.request, config.bucket, {
        profile: job.profile, conditioningPreparationVersion: job.conditioningPreparationVersion, ...(job.firstFrame?{firstFrame:job.firstFrame}:{}),
      }));
      if(job.firstFrame)assertH3FirstFrameMatchesJob(job.firstFrame,current);
      if (current.id !== job.id) throw new Error("The story plan or reference package changed before generation.");
    }
    if (!job.promptId && (job.state === "submitting" || job.state === "submission_unknown" || cancellationRequested(job))) {
      options.stage("Reconciling the existing H3 submission");
      const queue = await providerJson(baseUrl, "queue");
      const history = await providerJson(baseUrl, "history?max_items=1000");
      const recovered = findH3ProviderPrompt(job.id, queue, history);
      if (!recovered) {
        if (cancellationRequested(job)) {
          await update({ state: "cancelled", error: "Cancellation recorded; the original provider submission could not be located. Its result will not enter the draft." });
          throw new Error("Cancellation recorded; no replacement generation was submitted.");
        }
        throw new Error("Submission could not be reconciled. Generation was not repeated.");
      }
      await update({ promptId: recovered, state: "rendering" });
    }
    if (!job.promptId) {
      options.stage("Hydrating the named H3 references");
      await update({ state: "preparing" });
      let policyReferences: PreparedH3PolicyReference[] | undefined;
      let firstFrameBytes: Uint8Array | undefined;
      if (job.request.identityPolicyFamily) {
        options.stage("Checking the declared raw references before video generation");
        const prepared = await prepareH3IdentityPolicy(job, temp);
        policyReferences = prepared.references;
        const { version, id, sha256, familyId, familySha256 } = prepared.policy;
        await update({ identityPolicy: { version, id, sha256, familyId, familySha256 },
          referenceHashes: prepared.references.map(reference => reference.raw.rawSha256) });
        if(job.profile===H3_FIRST_FRAME_PROFILE){
          options.stage("Screening the actual first-frame PNG before video generation");
          const first=await prepareH3FirstFrame(job,prepared.policy,prepared.references,temp);
          firstFrameBytes=first.bytes;await update({firstFrameAssessment:first.assessment});
        }
      }
      if(job.profile===H3_FIRST_FRAME_PROFILE&&!firstFrameBytes)throw new Error("I2VA requires a successful first-frame screen before provider access.");
      // Health/schema probes do not enqueue GPU work.
      await providerJson(baseUrl, "system_stats");
      const node=job.profile===H3_FIRST_FRAME_PROFILE?"MiniMaxH3ImageToVideo":"MiniMaxH3ReferenceToVideo";
      const contract = await providerJson(baseUrl, `object_info/${node}`);
      if (!contract[node]) throw new Error("The native H3 conditioning node is unavailable.");
      const paths: string[] = [], hashes: string[] = [], conditioningHashes: string[] = [];
      const preparations: NonNullable<H3GenerationJob["conditioningPreparations"]> = [];
      if(firstFrameBytes){
        const hash=job.firstFrame!.body.pngSha256,form=new FormData();form.set("subfolder",`stack-structure/${job.id}`);form.set("type","input");form.set("overwrite","true");
        form.set("image",new File([new Uint8Array(firstFrameBytes)],`${hash}.png`,{type:"image/png"}));
        const response=await fetch(buildSwarmComfyDirectUrl(baseUrl,"upload/image"),{method:"POST",body:form,signal:AbortSignal.timeout(120_000)});
        if(!response.ok)throw new Error("SwarmUI first-frame upload failed.");
        const uploaded=await response.json() as {name?:string;subfolder?:string};
        if(uploaded.name!==`${hash}.png`||uploaded.subfolder!==`stack-structure/${job.id}`)throw new Error("SwarmUI returned an invalid first-frame binding.");
        paths.push(`${uploaded.subfolder}/${uploaded.name}`);hashes.push(...job.referenceHashes!);conditioningHashes.push(hash);
      }else for (let index = 0; index < job.references.length; index++) {
        const uploaded = await uploadReference(baseUrl, job, index, temp, policyReferences?.[index]);
        paths.push(uploaded.path); hashes.push(uploaded.hash);
        conditioningHashes.push(uploaded.conditioningHash); preparations.push(uploaded.preparation);
      }
      const built = buildH3Workflow(job, paths);
      const client = await openSwarmComfyClient(baseUrl);
      try {
        client.assertOpen();
        await update({ state: "submitting", compiledPrompt: built.prompt, frames: built.frames, referenceHashes: hashes,
          conditioningReferenceHashes: conditioningHashes, ...(firstFrameBytes?{}:{conditioningPreparations: preparations}) });
        options.stage("Submitting the native H3 reference shot");
        client.assertOpen();
        const response = await providerJson(baseUrl, "prompt", { prompt: built.workflow, client_id: client.clientId,
          extra_data: { stack_structure_h3_job: job.id, profile: job.profile } });
        // HTTP 200 without an ID does not prove the queue rejected the request.
        // A valid ID remains authoritative even when diagnostics accompany it.
        if (typeof response.prompt_id !== "string" || !response.prompt_id.trim()) {
          throw new Error("SwarmUI acknowledged the request without a prompt ID. Reconcile the original submission before retrying.");
        }
        await update({ promptId: response.prompt_id, state: "rendering" });
      } finally {
        // Registration is required through the ACK and durable ID write only.
        // HTTP history remains authoritative across Trigger's durable waits.
        client.close();
      }
    }
    options.stage("Rendering the H3 shot on the local GPU");
    const started = Date.now();
    let output: ComfyOutputRef | undefined;
    while (Date.now() - started < (options.timeoutSeconds ?? 1500) * 1000) {
      const current = await readH3Job(ownerId, projectId, jobId);
      const history = await providerJson(baseUrl, `history/${encodeURIComponent(job.promptId!)}`);
      const status = getComfyHistoryStatus(history, job.promptId);
      if (current && cancellationRequested(current) && (status === "error" || status === "completed")) {
        await update({ state: "cancelled" });
        throw new Error("H3 cancellation finalized; its output was not added to the draft.");
      }
      if (status === "error") {
        await update({ state: "failed", error: "H3 execution failed on the local GPU." });
        throw new Error("H3 execution failed on the local GPU.");
      }
      if (current && cancellationRequested(current)) {
        const queue = await providerJson(baseUrl, "queue");
        const pending = (queue.queue_pending as unknown[][] | undefined) ?? [];
        if (pending.some(entry => entry[1] === job.promptId)) {
          await providerJson(baseUrl, "queue", { delete: [job.promptId] });
          await update({ state: "cancelled" });
          throw new Error("H3 generation was cancelled before execution.");
        }
      } else if (status === "completed") {
        output = extractComfyOutputRefs(history, job.promptId).find(asset => asset.kind === "video");
        if (!output) throw new Error("H3 completed without a saved video.");
        break;
      }
      await options.wait(3);
    }
    if (!output) throw new Error("H3 is still running or its completion is unknown. Resume status reconciliation instead of rendering again.");
    await update({ state: "persisting" });
    options.stage("Validating and storing the generated H3 video");
    if (output.filename.includes("/") || output.filename.includes("\\")) {
      throw new Error("The provider returned an invalid output reference.");
    }
    const subfolder = h3OutputSubfolder(output.subfolder, job.id);
    const query = new URLSearchParams({ filename: output.filename, type: output.type ?? "output" });
    query.set("subfolder", subfolder);
    const response = await fetch(buildSwarmComfyDirectUrl(baseUrl, `view?${query}`), { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`H3 output download returned HTTP ${response.status}.`);
    const bytes = await response.arrayBuffer();
    const outputPath = path.join(temp, "shot.mp4");
    await writeFile(outputPath, Buffer.from(bytes));
    const probe = await probeMediaFile(outputPath);
    validateH3VideoProbe(probe, job.frames!, job.request.songEnd - job.request.songStart);
    const folder = `media-uploads/projects/${normalizeStudioOwnerSegment(ownerId)}/generated/${projectId}/${job.id}`;
    const storage = await uploadFileToMediaGateway({ file: new File([bytes], "shot.mp4", { type: "video/mp4" }), folder, preserveFileName: true });
    const pendingAsset = { id: job.id, provider: "swarmui" as const, model: job.profile, title: job.target.sectionLabel,
      prompt: job.compiledPrompt!, createdAt: job.createdAt, jobId: job.id, status: "completed" as const,
      mediaKind: "video" as const, width: H3_WIDTH, height: H3_HEIGHT, durationSeconds: probe.duration,
      resultUrl: storage.mediaUrl || storage.publicUrl, fullStorage: storage, trimStart: 0,
      reviewStatus: "pending" as const, target: job.target, triggerRunId: runId };
    options.stage("Checking likeness with the deterministic face verifier");
    const asset = await assessH3Identity({ job, asset: pendingAsset, outputPath, tempFolder: temp, diagnostic: options.identityDiagnostic });
    job = await updateH3Job(ownerId, projectId, jobId, current => {
      if (cancellationRequested(current) || current.state === "cancelled") return { ...current, state: "cancelled" };
      return { ...current, state: "ready", result: { asset }, error: undefined };
    });
    if (!job.result || job.state !== "ready") throw new Error("H3 output was cancelled before draft acceptance.");
    return completedOutput(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local H3 generation failed.";
    await updateH3Job(ownerId, projectId, jobId, current => {
      if (current.runId && current.runId !== runId) return current;
      if (["ready", "failed", "cancelled"].includes(current.state)) return current;
      if (cancellationRequested(current)) return { ...current, state: "cancel_requested", error: message };
      return { ...current, state: error instanceof H3ProviderRejection || error instanceof SwarmComfyClientUnavailable ? "failed"
        : current.promptId || current.state === "submitting" || current.state === "submission_unknown" ? "submission_unknown" : "failed", error: message };
    });
    throw error;
  } finally {
    // temp is allocated by mkdtemp beneath the OS temp directory, never a caller path.
    await rm(temp, { recursive: true, force: true });
  }
}

/** Reassess immutable stored pixels on CPU; never contact Swarm or submit another render. */
export async function recheckH3Identity(reference: H3JobReference, options: { stage: (label: string) => void;
  identityDiagnostic?: (event: H3IdentityDiagnostic) => void }) {
  const { ownerId, projectId, jobId } = reference;
  const job = await readH3Job(ownerId, projectId, jobId);
  const saved = await readStudioProject(ownerId, projectId, { fresh: true });
  const config = getMediaGatewayConfig();
  if (!job || job.ownerId !== ownerId || job.projectId !== projectId || job.state !== "ready" || !job.result || !saved || !config) {
    throw new Error("An owned completed shot and saved project are required for an identity recheck.");
  }
  const asset = job.result.asset;
  if (asset.reviewStatus === "rejected" || (saved.draft.generatedAssets ?? []).some(candidate =>
    (candidate.id === asset.id || candidate.jobId === job.id) && candidate.reviewStatus === "rejected")) {
    throw new Error("A rejected shot cannot be reconsidered by an automatic identity recheck.");
  }
  const assessment = reference.assessment;
  if (assessment) {
    assertH3IdentityAssessmentScope(assessment,job);
    const existing = await readH3IdentityAssessment(ownerId,projectId,jobId,assessment.id);
    if (existing) return completedOutput({ ...job, result: { asset: identityAssessmentAsset(existing,job) } });
  }
  const storage = asset.fullStorage;
  const expectedKey = `media-uploads/projects/${normalizeStudioOwnerSegment(ownerId)}/generated/${projectId}/${job.id}/shot.mp4`;
  if (!storage || storage.bucket !== config.bucket || storage.objectKey !== expectedKey
    || !asset.mediaSha256 || !/^[a-f0-9]{64}$/.test(asset.mediaSha256)) throw new Error("The stored shot has no immutable owned media binding.");
  const folder = await mkdtemp(path.join(tmpdir(), "stack-h3-recheck-"));
  const initialProof = JSON.stringify(asset.identityVerification);
  try {
    options.stage("Checking the existing shot with the deterministic face model");
    const media = await downloadMediaGatewayFile({ bucket: config.bucket, objectKey: expectedKey, fileName: "shot.mp4" });
    const hash = createHash("sha256").update(new Uint8Array(media.bytes)).digest("hex");
    if (hash !== asset.mediaSha256) throw new Error("Stored shot bytes changed; no identity evidence was updated.");
    const outputPath = path.join(folder, "shot.mp4");
    await writeFile(outputPath, new Uint8Array(media.bytes));
    validateH3VideoProbe(await probeMediaFile(outputPath), job.frames!, job.request.songEnd - job.request.songStart);
    const assessed = await assessH3Identity({ job, asset: assessment ? { ...asset, trimStart: assessment.trimStart } : asset, outputPath, tempFolder: folder,
      referenceResolver:saved.draft.musicVideoProject?.currentIdentity?await (await import("./historicalIdentityReference")).historicalIdentityReferenceResolver(job,saved):undefined,
      diagnostic: options.identityDiagnostic,
      ...(assessment ? { pinnedDraftPolicy: { id: assessment.policyId, sha256: assessment.policySha256 } } : {}) });
    const latest = await readStudioProject(ownerId, projectId, { fresh: true });
    if (!latest || (latest.draft.generatedAssets ?? []).some(candidate => (candidate.id === asset.id || candidate.jobId === job.id)
      && candidate.reviewStatus === "rejected")) throw new Error("The shot was rejected during reassessment.");
    if (assessment) {
      const current = await readH3Job(ownerId,projectId,jobId);
      if (!current || !assessed.identityVerification) throw new Error("Range assessment could not establish bound evidence.");
      assertH3IdentityAssessmentScope(assessment,current);
      const record: H3IdentityAssessment = { version: 1, scope: assessment, status: "ready", assessedAt: new Date().toISOString(),
        proof: assessed.identityVerification, proofSha256: identityPolicySha256(assessed.identityVerification) };
      // Validate before append. Never replace the original failed or successful report.
      identityAssessmentAsset(record,current);
      const stored = await writeH3IdentityAssessment(record);
      return completedOutput({ ...current, result: { asset: identityAssessmentAsset(stored,current) } });
    }
    const updated = await updateH3Job(ownerId, projectId, jobId, current => {
      if (current.state !== "ready" || current.result?.asset.mediaSha256 !== hash
        || JSON.stringify(current.result.asset.identityVerification) !== initialProof || current.result.asset.reviewStatus === "rejected") {
        throw new Error("The stored shot changed during reassessment. Refresh its evidence before retrying.");
      }
      return { ...current, result: { asset: assessed } };
    });
    return completedOutput(updated);
  } catch (error) {
    if (assessment) await writeH3IdentityAssessment({ version: 1, scope: assessment, status: "failed", assessedAt: new Date().toISOString(),
      error: "The exact range assessment could not be completed. Original shot evidence is unchanged." }).catch(() => {});
    throw error;
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
