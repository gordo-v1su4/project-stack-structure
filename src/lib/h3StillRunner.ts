import { randomUUID } from "node:crypto";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import { downloadH3ReferenceImage } from "./h3JobStore";
import { readH3StillJob, updateH3StillJob, type H3StillJob, type H3StillResult } from "./h3StillJobStore";
import { prepareH3StillImage } from "./h3StillImagePreparation";
import { validateH3StillJobContext } from "./h3StillServer";
import { downloadH3StillMaster, H3StillSubmissionError, H3StillUploadError, prepareH3StillProvider, readH3StillStatus, rebuildH3StillProvider,
  reconcileH3StillPrompt, submitH3StillOnce, type PreparedH3StillProvider, type H3StillSubmissionReceipt, type H3StillTransport } from "./h3StillProvider";

export type H3StillJobReference = { ownerId: string; projectId: string; jobId: string; mode?: "reconcile"; previousRunId?: string };
type Pixels = Awaited<ReturnType<typeof prepareH3StillImage>>;
export interface H3StillRunnerDependencies {
  read: typeof readH3StillJob;
  update: typeof updateH3StillJob;
  claim: (ownerId: string, projectId: string, jobId: string, expectedPreviousRunId: string, newRunId: string) => Promise<H3StillJob>;
  validate: (job: H3StillJob) => Promise<H3GenerationJob>;
  prepare: (job: H3StillJob, transport: H3StillTransport) => Promise<PreparedH3StillProvider>;
  submit: typeof submitH3StillOnce;
  reconcile: typeof reconcileH3StillPrompt;
  status: typeof readH3StillStatus;
  download: typeof downloadH3StillMaster;
  pixels: typeof prepareH3StillImage;
  persist: (job: H3StillJob, template: H3GenerationJob, pixels: Pixels) => Promise<H3StillResult>;
  now: () => number;
  baseUrl: () => string;
}
const defaults: H3StillRunnerDependencies = {
  read: readH3StillJob, update: updateH3StillJob, validate: validateH3StillJobContext,
  claim: async (...args) => (await import("./h3StillJobStore")).claimH3StillReconciliation(...args),
  prepare: (job, transport) => prepareH3StillProvider(job.descriptor, { ...transport, jobId: job.id, readReference: async (ref, signal) => {
    signal.throwIfAborted(); const raw = await downloadH3ReferenceImage(ref); signal.throwIfAborted();
    return { bytes: new Uint8Array(raw.bytes), mime: raw.mime, etag: raw.etag, version: ref.version };
  } }),
  submit: submitH3StillOnce, reconcile: reconcileH3StillPrompt, status: readH3StillStatus, download: downloadH3StillMaster,
  pixels: prepareH3StillImage,
  persist: async (job, template, pixels) => (await import("./h3StillResultStore")).persistH3StillResult(job, template, pixels),
  now: Date.now, baseUrl: () => process.env.LOCAL_SWARMUI_URL || process.env.SWARMUI_URL || "",
};
class CancelledBeforeSubmit extends Error {}
const terminal = (job: H3StillJob) => ["ready", "failed", "cancelled"].includes(job.state);
const cancelled = (job: H3StillJob) => !!job.cancelRequestedAt || job.state === "cancel_requested" || job.state === "cancelled";

/** One durable still attempt; absence or transport timeout never authorizes another GPU submission. */
export async function runH3Still(reference: H3StillJobReference, runId: string, options: {
  wait: (seconds: number) => Promise<unknown>; stage: (label: string) => void; timeoutSeconds?: number;
}, overrides: Partial<H3StillRunnerDependencies> = {}) {
  const d = { ...defaults, ...overrides }, seconds = options.timeoutSeconds ?? 1500;
  // Run IDs identify Trigger ownership, not individual executions of the same run.
  // A unique CAS value prevents a losing writer's identical lost-ACK comparison
  // from mistaking another execution's submitting receipt for its own write.
  const submissionClaimId = randomUUID();
  if (!Number.isSafeInteger(seconds) || seconds < 10 || seconds > 1500 || !runId.trim()) throw new Error("Invalid H3 still worker deadline or owner.");
  const hardDeadline = d.now() + seconds * 1000, deadline = hardDeadline - 5000;
  const within = async <T>(operation: Promise<T>, end = deadline): Promise<T> => {
    const ms = Math.max(0, end - d.now());
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("H3 still worker deadline expired.")), ms); })]); }
    finally { if (timer) clearTimeout(timer); }
  };
  const initial = await within(d.read(reference.ownerId, reference.projectId, reference.jobId));
  if (!initial || initial.ownerId !== reference.ownerId || initial.projectId !== reference.projectId || initial.id !== reference.jobId) throw new Error("Owned H3 still job not found.");
  let job: H3StillJob = initial;
  if (reference.mode === "reconcile" && (!reference.previousRunId || !job.workflowSha256)) throw new Error("Explicit still reconciliation requires the previous submitted worker run.");
  if (job.runId && job.runId !== runId) {
    if (reference.mode !== "reconcile" || reference.previousRunId !== job.runId) throw new Error("A different worker run owns this H3 still job.");
    job = await within(d.claim(job.ownerId, job.projectId, job.id, reference.previousRunId, runId));
    if (job.runId !== runId || !job.workflowSha256) throw new Error("Still reconciliation ownership was not established.");
  }
  if (terminal(job)) return { jobId: job.id, state: job.state };
  const mutate = async (change: (current: H3StillJob) => H3StillJob, final = false) => {
    job = await within(d.update(reference.ownerId, reference.projectId, reference.jobId, runId, change), final ? hardDeadline : deadline); return job;
  };
  const refresh = async () => {
    const current = await within(d.read(reference.ownerId, reference.projectId, reference.jobId));
    if (!current || current.runId !== runId) throw new Error("H3 still worker ownership changed."); job = current; return current;
  };
  const transport = (): H3StillTransport => ({ baseUrl: d.baseUrl(), timeoutMs: Math.max(1, Math.min(90_000, deadline - d.now())) });
  let crossedSubmissionBoundary = !!job.promptId || !!job.workflowSha256 || ["submitting", "submission_unknown", "rendering", "persisting"].includes(job.state);
  try {
    await mutate(current => current);
    if (cancelled(job) && !crossedSubmissionBoundary) {
      await mutate(current => ({ ...current, state: "cancelled" })); return { jobId: job.id, state: job.state };
    }
    let prepared = rebuildH3StillProvider(job.descriptor, job.id);
    if (job.workflowSha256 && job.workflowSha256 !== prepared.workflowSha256) throw new Error("The saved still workflow differs from its frozen attempt.");
    if (!crossedSubmissionBoundary) {
      options.stage("Preparing the approved MiniMax still references");
      await mutate(current => cancelled(current) ? current : { ...current, state: "preparing", error: undefined });
      if (cancelled(job)) throw new CancelledBeforeSubmit();
      await within(d.validate(job));
      prepared = await within(d.prepare(job, transport()));
      try {
        const submitted = await within(d.submit(prepared, job.id, { ...transport(), beforeSubmit: async (receipt: H3StillSubmissionReceipt) => {
          if (d.now() >= deadline) throw new Error("The still submission deadline expired.");
          await within(d.validate(job));
          if (d.now() >= deadline) throw new Error("The still submission deadline expired.");
          await mutate(current => {
            if (cancelled(current)) throw new CancelledBeforeSubmit();
            if (current.state !== "preparing" || current.workflowSha256 || current.promptId) throw new Error("The still submission boundary was already claimed; reconcile the existing attempt.");
            return { ...current, state: "submitting", submissionClaimId, workflowSha256: receipt.workflowSha256, providerSchemaSha256: receipt.schemaSha256 };
          });
          if (job.submissionClaimId !== submissionClaimId) throw new Error("Another execution owns the still submission claim; reconcile the existing attempt.");
          crossedSubmissionBoundary = true;
        } }));
        await mutate(current => ({ ...current, promptId: submitted.promptId, state: cancelled(current) ? "cancel_requested" : "rendering" }));
      } catch (error) {
        if (error instanceof CancelledBeforeSubmit) throw error;
        if (error instanceof H3StillSubmissionError && error.disposition === "rejected") {
          await mutate(current => ({ ...current, state: cancelled(current) ? "cancel_requested" : "failed", error: "SwarmUI rejected the still workflow before rendering." }));
          if (job.state === "cancel_requested") await mutate(current => ({ ...current, state: "cancelled" }));
          return { jobId: job.id, state: job.state };
        }
        if (!crossedSubmissionBoundary) throw error;
        await mutate(current => ({ ...current, state: cancelled(current) ? "cancel_requested" : "submission_unknown", error: "Still submission acknowledgement is uncertain; the same attempt is being reconciled." }));
      }
    }
    let failures = 0;
    while (d.now() < deadline) {
      await refresh();
      if (terminal(job)) return { jobId: job.id, state: job.state };
      try {
        if (!job.promptId) {
          options.stage("Reconciling the existing MiniMax still submission");
          const promptId = await within(d.reconcile(prepared, job.id, transport()));
          if (promptId) await mutate(current => ({ ...current, promptId, state: cancelled(current) ? "cancel_requested" : "rendering", error: undefined }));
        }
        if (job.promptId) {
          options.stage(cancelled(job) ? "Observing the cancelled still attempt without interrupting other work" : "Rendering the MiniMax still");
          const state = await within(d.status(prepared, job.id, job.promptId, transport()));
          // A saved prompt can survive an observation timeout. Restore its legal
          // rendering state only after the provider validates the exact owned
          // prompt; unknown history never grants this transition or another POST.
          if (state.status === "running" || state.status === "completed") {
            await mutate(current => current.state === "submission_unknown" && !cancelled(current)
              ? { ...current, state: "rendering", error: undefined } : current);
          }
          if (state.status === "failed") {
            await mutate(current => ({ ...current, state: cancelled(current) ? "cancelled" : "failed", error: "The existing still provider workflow failed." }));
            return { jobId: job.id, state: job.state };
          }
          if (state.status === "completed") {
            await refresh();
            if (cancelled(job)) { await mutate(current => ({ ...current, state: "cancelled" })); return { jobId: job.id, state: job.state }; }
            options.stage("Preparing and storing the still for identity review");
            await mutate(current => cancelled(current) ? current : { ...current, state: "persisting" });
            if (cancelled(job)) continue;
            const master = await within(d.download(job.descriptor, job.id, state.output, transport()));
            const pixelBudget = Math.min(30_000, deadline - d.now() - 2000);
            if (pixelBudget < 1) throw new Error("Insufficient time to prepare and reap the still pixel worker.");
            // This adapter owns its child deadline and reaps before settling. Do not race it with
            // an equally short parent timer and release the GPU/task slot before child cleanup.
            const pixels = await d.pixels(master.bytes, master.pngSha256, { timeoutMs: pixelBudget });
            await refresh(); if (cancelled(job)) continue;
            const result = await within(d.persist(job, job.template, pixels));
            await mutate(current => cancelled(current) ? current : { ...current, state: "ready", result, error: undefined });
            if (job.state === "ready") return { jobId: job.id, state: job.state, artifactId: result.artifactId };
            continue;
          }
        }
        failures = 0;
      } catch {
        failures++;
        if (failures >= 5) break;
      }
      const delay = failures ? Math.min(15, 2 ** failures) : 3;
      await within(options.wait(Math.min(delay, Math.max(0, (deadline - d.now()) / 1000))));
    }
    await mutate(current => ({ ...current, state: cancelled(current) ? "cancel_requested" : "submission_unknown", error: "The still attempt remains unresolved; no replacement was submitted." }), true);
    return { jobId: job.id, state: job.state };
  } catch (error) {
    // Re-read after an uncertain storage ACK before deciding whether submission could have started.
    const current = await within(d.read(reference.ownerId, reference.projectId, reference.jobId), hardDeadline).catch(() => null);
    if (current?.runId === runId) {
      job = current;
      crossedSubmissionBoundary ||= !!job.promptId || !!job.workflowSha256 || ["submitting", "submission_unknown", "rendering", "persisting"].includes(job.state);
      if (!terminal(job)) await mutate(value => ({ ...value,
        state: crossedSubmissionBoundary ? cancelled(value) ? "cancel_requested" : "submission_unknown" : cancelled(value) || error instanceof CancelledBeforeSubmit ? "cancelled" : "failed",
        error: crossedSubmissionBoundary ? "The existing still attempt needs reconciliation; no replacement was submitted."
          : error instanceof H3StillUploadError ? error.message : "The still could not be prepared; no GPU submission was made." }), true);
    }
    if (crossedSubmissionBoundary || job.state === "cancelled" || job.state === "failed") return { jobId: job.id, state: job.state };
    throw error;
  }
}
