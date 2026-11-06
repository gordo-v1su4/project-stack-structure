/** Read-only by default. --run creates a named copy and dispatches bounded real work. */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEditPlanPreviewSegments, createMusicVideoProject, isPlacementPlanCurrent, prepareApprovedPlacements } from "../src/components/studio/musicVideoProject";
import { applyApprovedGeneratedAssets, type GeneratedStudioAsset } from "../src/components/studio/generatedAssets";
import { planH3DraftWindows } from "../src/components/studio/h3DraftPlan";
import { isH3JobTerminal, type H3GenerationJob, type H3GenerationRequest } from "../src/components/studio/h3Generation";
import { createGeneratedDraftSelection, selectGeneratedDraftAsset } from "../src/components/studio/generatedDraft";
import { hydrateStudioProjectDraft, type PersistedStudioProjectDraft } from "../src/components/studio/projectPersistence";
import { applyTreatmentCoverageToProject } from "../src/components/studio/storyTreatments";
import { buildStudioSourceContextSignature } from "../src/components/studio/studioSourceContext";
import type { SavedStudioProject } from "../src/lib/studioProjectStore";

export type VerificationOptions = {
  baseUrl: string;
  projectId: string;
  run: boolean;
  zeroFootage: boolean;
  limit: number;
  reuseCopy?: boolean;
  timeoutMs?: number;
};

export type VerificationReport = {
  schema: "h3-draft-verification.v1";
  mode: "read-only" | "real-jobs";
  sourceProjectId: string;
  projectId: string;
  zeroFootage: boolean;
  songSeconds: number;
  sourceCount: number;
  timedLyricCount: number;
  referenceCount: number;
  planSignature: string;
  plannedWindowCount: number;
  boundedJobLimit: number;
  jobs: Array<{ jobId: string; runId?: string; state: string; assetId?: string; storedByteRead?: boolean }>;
  savedAssetCount: number;
  approvedAssetCount: number;
  remainingApprovedGapCount: number;
  export: { saved: boolean; durationCovered: number; fullSongCovered: boolean; byteRead?: boolean };
  limitations: string[];
};

type Dependencies = {
  fetch: typeof fetch;
  cookie: string;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
  checkpoint?: (report: VerificationReport) => Promise<void>;
};

/** A zero-footage variant keeps the approved story and durable song/references. */
export function createVerificationCopy(draft: PersistedStudioProjectDraft, zeroFootage: boolean): PersistedStudioProjectDraft {
  const copy = structuredClone(draft);
  if (!zeroFootage) return copy;
  const runtime = hydrateStudioProjectDraft({ draft: copy });
  if (!runtime.analysis?.duration || !copy.storyState.confirmedTreatmentSnapshot) throw new Error("A saved song and confirmed story are required for the zero-footage variant.");
  copy.videoSources = [];
  copy.generatedAssets = [];
  copy.generatedDraft = null;
  copy.storyState.transcriptSummary = null;
  copy.storyState.vocalStemName = "";
  const context = buildStudioSourceContextSignature({ analysis: runtime.analysis, videoSources: [], referenceAssets: runtime.referenceAssets });
  copy.storyState.confirmedSourceContextSignature = context;
  const project = applyTreatmentCoverageToProject(createMusicVideoProject({
    analysis: runtime.analysis, duration: runtime.analysis.duration, lyricChunks: [],
    storyDrafts: copy.storyState.storyBeats, videoSources: [],
  }), copy.storyState.confirmedTreatmentSnapshot);
  copy.musicVideoProject = prepareApprovedPlacements({ project: { ...project, sourceContextSignature: context }, videoSources: [], editSettings: copy.storyState.editSettings });
  copy.workflowUiSettings = { ...copy.workflowUiSettings, activeTab: "generate", committedSplit: undefined, finalExport: undefined };
  return copy;
}

/** Only same-origin app routes receive the process-private session cookie. */
export async function verifyH3DraftFlow(options: VerificationOptions, dependencies: Dependencies): Promise<VerificationReport> {
  const base = new URL(options.baseUrl);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) throw new Error("This verification harness requires a local app URL.");
  if (!Number.isInteger(options.limit) || options.limit < 0 || options.limit > 1000) throw new Error("The job limit must be an integer from 0 to 1000.");
  if (!dependencies.cookie) throw new Error("Supply a session through the private STACK_STRUCTURE_E2E_COOKIE environment variable.");
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(options.projectId)) throw new Error("A saved project ID is required.");
  const now = dependencies.now ?? Date.now;
  const wait = dependencies.wait ?? (async (ms) => { await new Promise(resolve => setTimeout(resolve, ms)); });
  const request = async <T,>(endpoint: string, init: RequestInit = {}): Promise<T> => {
    const response = await dependencies.fetch(new URL(endpoint, base), { ...init, redirect: "error", signal: AbortSignal.timeout(60_000), headers: { cookie: dependencies.cookie, ...init.headers } });
    if (!response.ok) throw new Error(`App request failed (${response.status}) at ${endpoint.split("?")[0]}. Inspect the correlated server run; response bodies are kept out of logs.`);
    return await response.json() as T;
  };
  const readProject = async (id: string) => (await request<{ saved: SavedStudioProject }>(`/api/studio/projects/${encodeURIComponent(id)}`)).saved;
  let saved = await readProject(options.projectId);
  if (options.reuseCopy && !saved.project.name.startsWith("[H3 verification]")) throw new Error("Reuse is restricted to a previously created [H3 verification] project copy.");
  if (options.reuseCopy && options.zeroFootage) throw new Error("Create the zero-footage copy first; reuse must not rebuild a saved plan.");
  const draft = options.reuseCopy ? structuredClone(saved.draft) : createVerificationCopy(saved.draft, options.zeroFootage);
  if (options.run && !options.reuseCopy) saved = (await request<{ saved: SavedStudioProject }>("/api/studio/projects", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `[H3 verification] ${options.zeroFootage ? "Master-only" : "Footage"} ${new Date(now()).toISOString()}`, draft }),
  })).saved;
  const activeDraft = options.run ? saved.draft : draft;
  const runtime = hydrateStudioProjectDraft({ draft: activeDraft });
  const project = runtime.musicVideoProject;
  if (!project || !isPlacementPlanCurrent(project) || !project.placementPlan) throw new Error("Save a current confirmed Story/edit plan before verification.");
  const segments = buildEditPlanPreviewSegments({ project, videoSources: runtime.videoSources, editSettings: runtime.storyState.editSettings });
  const approved = applyApprovedGeneratedAssets(segments, runtime.generatedAssets);
  const windows = planH3DraftWindows(approved);
  const report: VerificationReport = {
    schema: "h3-draft-verification.v1", mode: options.run ? "real-jobs" : "read-only",
    sourceProjectId: options.projectId, projectId: saved.project.id, zeroFootage: options.zeroFootage,
    songSeconds: runtime.analysis?.duration ?? project.duration, sourceCount: runtime.videoSources.length,
    timedLyricCount: runtime.storyState.transcriptSummary?.chunks.length ?? 0,
    referenceCount: runtime.referenceAssets.length, planSignature: project.placementPlan.inputSignature,
    plannedWindowCount: windows.length, boundedJobLimit: options.limit, jobs: [], savedAssetCount: runtime.generatedAssets.length,
    approvedAssetCount: runtime.generatedAssets.filter(asset => asset.reviewStatus === "approved").length,
    remainingApprovedGapCount: windows.length,
    export: { saved: Boolean(activeDraft.workflowUiSettings?.finalExport), durationCovered: 0, fullSongCovered: false },
    limitations: ["Harness authentication bypasses OAuth and does not prove interactive sign-in.", "Metadata and byte reads do not prove identity, continuity, sound or creative quality.", "This harness never grants candidate approval or dispatches final export; review the draft in the app."],
  };
  const checkpoint = async () => { await dependencies.checkpoint?.(structuredClone(report)); };
  const readBytes = async (asset: GeneratedStudioAsset) => {
    const storage = asset.fullStorage;
    if (!storage?.bucket || storage.bucket === "local-fallback" || !storage.objectKey) throw new Error("Generated result is missing durable media storage.");
    const endpoint = `/api/storage/media?${new URLSearchParams({ bucket: storage.bucket, objectKey: storage.objectKey })}`;
    const response = await dependencies.fetch(new URL(endpoint, base), { redirect: "error", headers: { cookie: dependencies.cookie, range: "bytes=0-63" }, signal: AbortSignal.timeout(60_000) });
    if (!response.ok || !(await response.arrayBuffer()).byteLength) throw new Error("A generated result did not return stored media bytes.");
  };
  if (!options.run) {
    const known = await request<{ jobs: H3GenerationJob[] }>(`/api/generate/h3?${new URLSearchParams({ projectId: saved.project.id })}`);
    report.jobs = known.jobs.map(job => ({ jobId: job.id, runId: job.runId, state: job.state, assetId: job.result?.asset.id }));
    for (const [index, job] of known.jobs.entries()) if (job.state === "ready" && job.result?.asset) {
      await readBytes(job.result.asset);
      report.jobs[index].storedByteRead = true;
    }
    if (options.zeroFootage) report.limitations.push("The zero-footage variant is planned locally only; existing job observations belong to the source project until --run saves a copy.");
  }
  await checkpoint();
  if (options.run) for (const window of windows.slice(0, options.limit)) {
    const prompt = window.storyDirection?.trim() || window.label;
    const available = runtime.referenceAssets.filter(asset => asset.storageStatus === "uploaded");
    const identities = available.filter(asset => asset.role.startsWith("character") || asset.kind === "character");
    const mentioned = identities.filter(asset => prompt.toLocaleLowerCase().includes(asset.displayName.toLocaleLowerCase()));
    const references = [...mentioned, ...available.filter(asset => asset.role === "environment")];
    const body: H3GenerationRequest = { projectId: saved.project.id, planSignature: project.placementPlan.inputSignature,
      requirementId: window.requirementId, timelineItemId: window.timelineItemId, sectionId: window.sectionId,
      songStart: window.musicStart, songEnd: window.musicEnd, prompt,
      referenceAssetIds: references.map(asset => asset.id), requestIntentId: crypto.randomUUID() };
    const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
    const started = await request<{ jobId: string; runId?: string; job: H3GenerationJob }>("/api/generate/h3", init);
    report.jobs.push({ jobId: started.jobId, runId: started.runId, state: started.job.state });
    await checkpoint();
    // Redelivery of the same intent must reconcile the same logical job/run.
    const replay = await request<{ jobId: string; runId?: string }>("/api/generate/h3", init);
    if (replay.jobId !== started.jobId || replay.runId !== started.runId) throw new Error("Identical H3 submission did not reuse its job and run.");
    let job = started.job;
    const deadline = now() + (options.timeoutMs ?? 45 * 60_000);
    while (!isH3JobTerminal(job)) {
      if (now() > deadline) throw new Error(`Job polling deadline reached for ${job.id}; its saved job remains available for explicit resume.`);
      await wait(2000);
      job = (await request<{ job: H3GenerationJob }>(`/api/generate/h3?${new URLSearchParams({ projectId: saved.project.id, jobId: started.jobId })}`)).job;
      report.jobs.at(-1)!.state = job.state;
      await checkpoint();
    }
    if (job.state !== "ready" || !job.result?.asset) throw new Error(`H3 job ${job.id} ended ${job.state}.`);
    await readBytes(job.result.asset);
    report.jobs.at(-1)!.assetId = job.result.asset.id;
    report.jobs.at(-1)!.storedByteRead = true;
    // Persist a candidate selection, never an approval. Reload to retain concurrent saved results.
    saved = await readProject(saved.project.id);
    if (saved.draft.musicVideoProject?.placementPlan?.inputSignature !== project.placementPlan.inputSignature) throw new Error("The saved plan changed while generation ran; its candidate was retained in the job without overwriting the newer project.");
    const existing = saved.draft.generatedAssets ?? [];
    const assets = existing.some(asset => asset.id === job.result!.asset.id) ? existing : [...existing, { ...job.result.asset, reviewStatus: "pending" as const }];
    const selection = selectGeneratedDraftAsset({ draft: saved.draft.generatedDraft ?? createGeneratedDraftSelection(project.placementPlan.inputSignature), assets, asset: job.result.asset, segments });
    saved = (await request<{ saved: SavedStudioProject }>(`/api/studio/projects/${saved.project.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: saved.project.name, draft: { ...saved.draft, generatedAssets: assets, generatedDraft: selection } }) })).saved;
    const restored = await readProject(saved.project.id);
    if (!restored.draft.generatedAssets?.some(asset => asset.id === job.result!.asset.id)) throw new Error("Generated candidate did not survive saved-project reload.");
    report.savedAssetCount = restored.draft.generatedAssets.length;
    await checkpoint();
  }
  const current = options.run ? await readProject(saved.project.id) : saved;
  const currentDraft = options.run || !options.zeroFootage ? current.draft : activeDraft;
  const currentRuntime = hydrateStudioProjectDraft({ draft: currentDraft });
  report.savedAssetCount = currentRuntime.generatedAssets.length;
  const finalSegments = applyApprovedGeneratedAssets(segments, currentRuntime.generatedAssets);
  report.approvedAssetCount = currentRuntime.generatedAssets.filter(asset => asset.reviewStatus === "approved").length;
  report.remainingApprovedGapCount = finalSegments.filter(segment => segment.kind === "gap" || !segment.videoUrl).length;
  const covered = finalSegments.filter(segment => segment.kind !== "gap" && segment.videoUrl);
  report.export.durationCovered = covered.reduce((sum, segment) => sum + segment.musicEnd - segment.musicStart, 0);
  let cursor = 0;
  const contiguous = [...covered].sort((a, b) => a.musicStart - b.musicStart).every(segment => {
    const aligned = Math.abs(segment.musicStart - cursor) < 0.001 && segment.musicEnd > segment.musicStart;
    cursor = segment.musicEnd;
    return aligned;
  });
  report.export.fullSongCovered = contiguous && report.remainingApprovedGapCount === 0 && Math.abs(cursor - report.songSeconds) < 0.1;
  const finalExport = currentDraft.workflowUiSettings?.finalExport;
  report.export.saved = Boolean(finalExport);
  if (finalExport) {
    const url = new URL(finalExport.videoUrl, base);
    if (url.origin === base.origin && url.pathname === "/api/storage/media") {
      const response = await dependencies.fetch(url, { redirect: "error", headers: { cookie: dependencies.cookie, range: "bytes=0-63" }, signal: AbortSignal.timeout(60_000) });
      report.export.byteRead = response.ok && (await response.arrayBuffer()).byteLength > 0;
    } else report.limitations.push("Saved export URL is not an authenticated local storage route; durable export byte verification remains open.");
  }
  await checkpoint();
  return report;
}

export function parseVerificationOptions(args: string[], env: Record<string, string | undefined>): VerificationOptions {
  const value = (key: string) => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
  return { baseUrl: value("--url") ?? env.STACK_STRUCTURE_E2E_URL ?? "http://127.0.0.1:3000",
    projectId: value("--project-id") ?? "", run: args.includes("--run"), zeroFootage: args.includes("--zero-footage"),
    reuseCopy: args.includes("--reuse-copy"), limit: Number(value("--limit") ?? "1") };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--help")) console.info("bun run scripts/verify-h3-draft-flow.ts --project-id ID [--zero-footage] [--run --limit 1] [--reuse-copy] [--url http://127.0.0.1:3000]\nDefault: authenticated read-only inspection. --run creates a new [H3 verification] copy, dispatches real H3 jobs and saves pending candidates. --reuse-copy requires an existing verification copy. --limit 0 inspects/saves a copy without generation. Use private STACK_STRUCTURE_E2E_COOKIE; no cookies are written to reports. No fixture bundle is required.");
  else {
    const output = path.resolve(".tmp", "h3-verification", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    try {
      await mkdir(path.dirname(output), { recursive: true });
      const report = await verifyH3DraftFlow(parseVerificationOptions(process.argv.slice(2), process.env), {
        fetch, cookie: process.env.STACK_STRUCTURE_E2E_COOKIE ?? "",
        checkpoint: async (report) => { await writeFile(output, JSON.stringify(report, null, 2)); },
      });
      console.info(JSON.stringify({ reportPath: output, mode: report.mode, projectId: report.projectId, jobs: report.jobs.length, remainingApprovedGapCount: report.remainingApprovedGapCount, fullSongCovered: report.export.fullSongCovered, interactiveReviewRequired: true }));
    } catch (error) {
      console.error(JSON.stringify({ error: error instanceof Error ? error.message : "Verification failed", reportPath: output }));
      process.exitCode = 1;
    }
  }
}
