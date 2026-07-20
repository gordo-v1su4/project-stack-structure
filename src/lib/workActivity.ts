export type ActivityRunInput = {
  id: string;
  taskIdentifier: string;
  status: string;
  metadata?: Record<string, unknown>;
  queuedAt?: Date | string;
  createdAt?: Date | string;
  startedAt?: Date | string;
  finishedAt?: Date | string;
  completedAt?: Date | string;
  durationMs?: number;
  error?: { message?: string } | string;
};

export type WorkActivityItem = {
  id: string;
  taskLabel: string;
  status: string;
  stageLabel: string;
  progressPercent?: number;
  completedItems?: number;
  totalItems?: number;
  providerStatus?: string;
  providerMessage?: string;
  parentRunId?: string;
  queuedMs?: number;
  runtimeMs?: number;
  totalMs?: number;
  timestamp: number;
  active: boolean;
  failed: boolean;
  error?: string;
  children: WorkActivityItem[];
};

export type WorkActivitySummary = {
  completed: number;
  active: number;
  queued: number;
  failed: number;
  total: number;
};

export const WORK_ACTIVITY_RETRY_MS = 30_000;

const terminalStatuses = new Set([
  "COMPLETED", "FAILED", "CRASHED", "SYSTEM_FAILURE", "CANCELED",
  "EXPIRED", "INTERRUPTED", "TIMED_OUT",
]);
const failedStatuses = new Set([
  "FAILED", "CRASHED", "SYSTEM_FAILURE", "CANCELED", "EXPIRED", "INTERRUPTED", "TIMED_OUT",
]);
const queuedStatuses = new Set([
  "QUEUED", "DELAYED", "PENDING_VERSION", "PENDING_EXECUTION", "WAITING_FOR_DEPLOY",
]);

const taskLabels: Record<string, string> = {
  "media-video-pipeline": "Analyze video",
  "media-video-scene-detect": "Detect scenes",
  "qwen-scene-caption-batch": "Caption scene batch",
  "media-video-finalize": "Finalize media analysis",
  "essentia-analyze-stored-audio": "Analyze master audio",
  "qwen-smart-scene-caption": "Caption scene",
  "local-ai-generation": "Generate local asset",
  "higgsfield-nano-banana-pro-grid": "Generate Higgsfield grid",
  "deepgram-transcribe-stored-audio": "Transcribe master audio",
  "ffmpeg-preview-or-concat": "Render preview",
  "ffmpeg-final-music-video-export": "Render final export",
  "ffmpeg-shader-capture-export": "Mux shader capture",
  "ffglitch-transform": "Apply FFglitch",
  "image-split-grid": "Split image grid",
  "stack-structure-service-health": "Check production services",
};

export function workActivityTokenRefreshDelay(expiresAt: number, now = Date.now()) {
  return Math.max(WORK_ACTIVITY_RETRY_MS, expiresAt - now - 90_000);
}

export function workActivityReconnectDelay(error: string) {
  return /(?:\b401\b|public access token is invalid|token (?:is )?expired)/i.test(error)
    ? 0
    : WORK_ACTIVITY_RETRY_MS;
}

export function groupActivityRuns(runs: ActivityRunInput[], now = Date.now()) {
  const normalized = runs.map((run) => normalizeActivityRun(run, now));
  const byId = new Map(normalized.map((run) => [run.id, run]));
  const roots: WorkActivityItem[] = [];
  for (const run of normalized) {
    const parent = run.parentRunId ? byId.get(run.parentRunId) : undefined;
    if (parent) parent.children.push(run);
    else roots.push(run);
  }
  for (const root of roots) root.children.sort((a, b) => a.timestamp - b.timestamp);
  return roots.sort((a, b) => b.timestamp - a.timestamp);
}

export function summarizeActivityRuns(items: WorkActivityItem[]): WorkActivitySummary {
  const summary: WorkActivitySummary = {
    completed: 0,
    active: 0,
    queued: 0,
    failed: 0,
    total: items.length,
  };

  for (const item of items) {
    if (item.status === "COMPLETED") summary.completed += 1;
    else if (terminalStatuses.has(item.status)) summary.failed += 1;
    else if (queuedStatuses.has(item.status)) summary.queued += 1;
    else summary.active += 1;
  }

  return summary;
}

export function normalizeActivityRun(run: ActivityRunInput, now = Date.now()): WorkActivityItem {
  const values = run.metadata ?? {};
  const queuedAt = timestamp(run.queuedAt ?? run.createdAt);
  const startedAt = timestamp(run.startedAt);
  const finishedAt = timestamp(run.finishedAt ?? run.completedAt);
  const completedItems = finiteNumber(values.completedItems);
  const totalItems = finiteNumber(values.totalItems);
  const terminal = terminalStatuses.has(run.status);
  const providerStatus = stringValue(values.providerStatus);
  const progressPercent = totalItems && completedItems !== undefined
    ? Math.max(0, Math.min(100, Math.round((completedItems / totalItems) * 100)))
    : terminal && run.status === "COMPLETED" ? 100 : undefined;
  return {
    id: run.id,
    taskLabel: taskLabels[run.taskIdentifier] ?? humanize(run.taskIdentifier),
    status: run.status,
    stageLabel: stringValue(values.stageLabel) ?? humanize(stringValue(values.stage) ?? run.status),
    progressPercent,
    completedItems,
    totalItems,
    providerStatus: terminal && providerStatus?.toLowerCase() === "running" ? undefined : providerStatus,
    providerMessage: stringValue(values.providerMessage),
    parentRunId: stringValue(values.parentRunId),
    queuedMs: queuedAt !== undefined && startedAt !== undefined ? Math.max(0, startedAt - queuedAt) : undefined,
    runtimeMs: startedAt !== undefined ? Math.max(0, (finishedAt ?? now) - startedAt) : undefined,
    totalMs: queuedAt !== undefined ? Math.max(0, (finishedAt ?? now) - queuedAt) : undefined,
    timestamp: queuedAt ?? startedAt ?? finishedAt ?? 0,
    active: !terminal,
    failed: failedStatuses.has(run.status),
    error: typeof run.error === "string" ? run.error : run.error?.message,
    children: [],
  };
}

export function formatActivityDuration(value?: number) {
  if (value === undefined) return "-";
  if (value < 1_000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.floor((value % 60_000) / 1_000);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function timestamp(value?: Date | string) {
  if (!value) return undefined;
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function humanize(value: string) {
  return value.replace(/^stack-structure-/, "").replace(/[_-]+/g, " ")
    .toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());
}
