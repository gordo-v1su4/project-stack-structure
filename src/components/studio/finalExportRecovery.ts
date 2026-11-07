import { sha256 } from "@noble/hashes/sha2.js";
import type { PersistedStudioProjectDraft } from "./projectPersistence";
import { failSectionRecompute, type SectionRecomputeState } from "./sectionRecompute";

export type FinalExportIntent = {
  version: 1;
  projectId: string | null;
  requestKey: string;
  snapshotSha256: string;
  createdAt: string;
  runId?: string;
  state: "dispatching" | "running" | "ready" | "failed";
  replayable?: boolean;
};

/** The same render remains the same intent across saves, navigation and reload. */
export function finalExportSnapshotSha256(draft: PersistedStudioProjectDraft): string {
  const snapshot = {
    analysis: draft.analysis, videoSources: draft.videoSources, storyState: draft.storyState,
    musicVideoProject: draft.musicVideoProject, referenceAssets: draft.referenceAssets,
    generatedAssets: draft.generatedAssets?.filter(asset => asset.reviewStatus === "approved" || draft.generatedDraft?.assetIds.includes(asset.id)), generatedDraft: draft.generatedDraft,
    clipAudioSettings: draft.clipAudioSettings,
    shaderPresetId: draft.workflowUiSettings?.shaderPresetId,
    shaderAccentKinds: draft.workflowUiSettings?.shaderAccentKinds,
  };
  return Array.from(sha256(new TextEncoder().encode(JSON.stringify(snapshot))), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeFinalExportIntent(value: unknown): FinalExportIntent | undefined {
  if (!value || typeof value !== "object") return undefined;
  const intent = value as FinalExportIntent;
  if (intent.version !== 1 || (intent.projectId !== null && (typeof intent.projectId !== "string" || !/^[\w-]{1,96}$/.test(intent.projectId)))
    || typeof intent.requestKey !== "string" || !/^final-export-[\w-]{1,100}$/.test(intent.requestKey)
    || typeof intent.snapshotSha256 !== "string" || !/^[a-f0-9]{64}$/.test(intent.snapshotSha256)
    || typeof intent.createdAt !== "string" || !Number.isFinite(Date.parse(intent.createdAt))
    || !["dispatching", "running", "ready", "failed"].includes(intent.state)
    || (intent.runId !== undefined && (typeof intent.runId !== "string" || !/^run_[\w-]{1,100}$/.test(intent.runId)))
    || (intent.state === "running" && !intent.runId)
    || (intent.replayable !== undefined && typeof intent.replayable !== "boolean")) return undefined;
  return { version: 1, projectId: intent.projectId, requestKey: intent.requestKey, snapshotSha256: intent.snapshotSha256,
    createdAt: intent.createdAt, state: intent.state, ...(intent.runId ? { runId: intent.runId } : {}),
    ...(intent.replayable !== undefined ? { replayable: intent.replayable } : {}) };
}

export function isFinalExportIntentCurrent(intent: FinalExportIntent, projectId: string | null, draft: PersistedStudioProjectDraft): boolean {
  return intent.projectId === projectId && intent.snapshotSha256 === finalExportSnapshotSha256(draft);
}

export function assertFinalExportReplayAllowed(intent: FinalExportIntent, now = Date.now()): void {
  if (!intent.runId && intent.replayable === false) throw new Error("The upload-based export acknowledgement is unresolved. Reconcile its original run before uploading or dispatching again.");
  // Trigger's replay key expires after 24 hours. Never guess that a lost ACK means no render.
  if (!intent.runId && now - Date.parse(intent.createdAt) >= 23 * 60 * 60 * 1_000) {
    throw new Error("The export acknowledgement is unresolved and its safe replay window expired. Reconcile the original run before creating another export.");
  }
}

/** Only an explicitly rejected, unsubmitted request may be rebound after owned-media migration. */
export function rebindFinalExportAfterMigration(intent: FinalExportIntent, projectId: string | null,
  currentDraft: PersistedStudioProjectDraft, migratedDraft: PersistedStudioProjectDraft): FinalExportIntent {
  if (intent.runId || intent.state !== "dispatching" || !isFinalExportIntentCurrent(intent, projectId, currentDraft)) {
    throw new Error("The project or export changed during media migration.");
  }
  return { ...intent, snapshotSha256: finalExportSnapshotSha256(migratedDraft) };
}

export function releaseStaleFinalExportPreview(state: SectionRecomputeState, intent: FinalExportIntent, currentProjectId: string | null): SectionRecomputeState {
  return intent.projectId === currentProjectId ? failSectionRecompute(state, { requestKey: intent.requestKey,
    message: "The arrangement changed during export. Review the current cut before exporting again." }) : state;
}

export async function waitForCurrentFinalExport<T>(intent: FinalExportIntent, options: {
  waitForOutput: (runId: string) => Promise<T>;
  isCurrent: () => boolean;
}): Promise<T> {
  if (!intent.runId) throw new Error("The export has no acknowledged run.");
  const output = await options.waitForOutput(intent.runId);
  if (!options.isCurrent()) throw new Error("The project or arrangement changed during export. The original run remains in its project history.");
  if (!output || typeof output !== "object" || (output as { requestKey?: string }).requestKey !== intent.requestKey) {
    throw new Error("The export result does not match its saved request.");
  }
  return output;
}
