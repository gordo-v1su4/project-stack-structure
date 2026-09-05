"use client";

import { useRealtimeRunsWithTag } from "@trigger.dev/react-hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  formatActivityDuration,
  groupActivityRuns,
  summarizeActivityRuns,
  workActivityReconnectDelay,
  workActivityTokenRefreshDelay,
  WORK_ACTIVITY_RETRY_MS,
  type ActivityRunInput,
  type WorkActivityItem,
} from "@/lib/workActivity";
import { useDismiss } from "./shell/useDismiss";

type ActivityCredentials = {
  accessToken: string;
  baseURL: string;
  tag: string;
  expiresAt: number;
};

type ActiveActivityCredentials = ActivityCredentials & {
  version: number;
};

export function WorkActivity() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);
  const [credentials, setCredentials] = useState<ActiveActivityCredentials>();
  const credentialVersion = useRef(0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [requiresSignIn, setRequiresSignIn] = useState(false);
  const [connectionError, setConnectionError] = useState<string>();
  const [runs, setRuns] = useState<ActivityRunInput[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const response = await fetch("/api/orchestration/realtime-token", { cache: "no-store" });
        const body = await response.json() as Partial<ActivityCredentials> & { error?: string };
        if (response.status === 401) {
          if (!cancelled) {
            credentialVersion.current += 1;
            setCredentials(undefined);
            setRequiresSignIn(true);
          }
          return;
        }
        if (!response.ok || !body.accessToken || !body.baseURL || !body.tag || !body.expiresAt) {
          throw new Error(body.error || `Work activity token failed (${response.status}).`);
        }
        if (cancelled) return;
        const next = body as ActivityCredentials;
        const version = credentialVersion.current + 1;
        credentialVersion.current = version;
        setCredentials({ ...next, version });
        setRequiresSignIn(false);
        setConnectionError(undefined);
        timer = window.setTimeout(refresh, workActivityTokenRefreshDelay(next.expiresAt));
      } catch (error) {
        if (cancelled) return;
        credentialVersion.current += 1;
        setCredentials(undefined);
        setConnectionError(error instanceof Error ? error.message : String(error));
        timer = window.setTimeout(refresh, WORK_ACTIVITY_RETRY_MS);
      }
    };
    void refresh();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [refreshNonce]);

  useEffect(() => {
    if (!connectionError || requiresSignIn) return;
    const timer = window.setTimeout(
      () => setRefreshNonce((value) => value + 1),
      workActivityReconnectDelay(connectionError),
    );
    return () => window.clearTimeout(timer);
  }, [connectionError, requiresSignIn]);

  const onSnapshot = useCallback((version: number, next: ActivityRunInput[], error?: string) => {
    if (version !== credentialVersion.current) return;
    setRuns(next);
    setConnectionError(error);
    if (error) {
      credentialVersion.current += 1;
      setCredentials(undefined);
    }
  }, []);
  const activity = useMemo(() => groupActivityRuns(runs, now), [runs, now]);
  const summary = useMemo(() => summarizeActivityRuns(activity), [activity]);
  const summaryLabel = summary.total
    ? `${summary.completed}/${summary.total} complete · ${summary.active} active · ${summary.queued} queued${summary.failed ? ` · ${summary.failed} failed` : ""}`
    : "realtime";

  useEffect(() => {
    if (!summary.active && !summary.queued) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [summary.active, summary.queued]);

  return (
    <div ref={rootRef} className="relative">
      {credentials ? (
        <WorkActivitySubscription
          key={credentials.version}
          credentials={credentials}
          subscriptionId={`stack-structure-work-${credentials.version}`}
          onSnapshot={onSnapshot}
        />
      ) : null}
      {/* Quiet by default: an icon with a count. It only speaks when work is running or failed. */}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="stack-structure-work-activity"
        aria-label={`Work activity: ${summaryLabel}`}
        title={summaryLabel}
        className={`relative flex h-7 items-center gap-1.5 rounded-md border px-2 font-mono text-[11px] transition-colors ${
          summary.active
            ? "border-accent-lo bg-accent-tint text-accent"
            : summary.failed
              ? "border-danger-lo bg-danger-tint text-danger"
              : "border-transparent text-fg-3 hover:border-line-2 hover:text-fg-1"
        }`}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={summary.active ? "studio-spin" : undefined}>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 4.5V8l2.5 1.5" />
        </svg>
        {summary.active ? <span>{summary.active} running</span> : summary.failed ? <span>{summary.failed} failed</span> : summary.total ? <span>{summary.completed}</span> : null}
      </button>

      {open ? (
        <section
          id="stack-structure-work-activity"
          aria-label="Work activity"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[420px] rounded-[10px] border border-line-2 bg-ink-1 p-4 shadow-2xl shadow-black/70"
        >
          <div className="mb-3 flex items-start justify-between gap-3 border-b border-line pb-3">
            <div>
              <div className="text-[13px] font-medium text-fg-0">Work</div>
              <div className="mt-0.5 font-mono text-[11px] text-fg-3">{summary.total ? summaryLabel : "Production runs from the last 24 hours"}</div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="text-[11px] text-fg-3 hover:text-fg-1">Close</button>
          </div>
          {requiresSignIn ? (
            <div className="rounded-md border border-line bg-ink-0 p-3 text-[12px] leading-5 text-fg-2">
              Sign in with GitHub from the project menu to view your scoped production work.
            </div>
          ) : connectionError ? (
            <div className="rounded-md border border-danger-lo bg-danger-tint p-3 text-[12px] leading-5 text-danger">{connectionError}</div>
          ) : !credentials ? (
            <div className="py-6 text-center text-[12px] text-fg-3">Connecting...</div>
          ) : activity.length === 0 ? (
            <div className="py-6 text-center text-[12px] text-fg-3">No work in the last 24 hours.</div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
              {activity.map((item) => <ActivityRow key={item.id} item={item} />)}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function WorkActivitySubscription({
  credentials,
  subscriptionId,
  onSnapshot,
}: {
  credentials: ActiveActivityCredentials;
  subscriptionId: string;
  onSnapshot: (version: number, runs: ActivityRunInput[], error?: string) => void;
}) {
  const { runs, error, stop } = useRealtimeRunsWithTag(credentials.tag, {
    id: subscriptionId,
    accessToken: credentials.accessToken,
    baseURL: credentials.baseURL,
    createdAt: "1d",
    skipColumns: ["payload", "output"],
    throttleInMs: 100,
  });
  const pendingSnapshot = useRef<{ runs: ActivityRunInput[]; error?: string }>({ runs: [] });
  const flushTimer = useRef<number | undefined>(undefined);
  const snapshotKey = JSON.stringify(runs);
  useEffect(() => {
    if (error) stop();
  }, [error, stop]);
  useEffect(() => {
    pendingSnapshot.current = {
      runs: runs as unknown as ActivityRunInput[],
      error: error?.message,
    };
    if (flushTimer.current !== undefined) return;
    flushTimer.current = window.setTimeout(() => {
      flushTimer.current = undefined;
      onSnapshot(credentials.version, pendingSnapshot.current.runs, pendingSnapshot.current.error);
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials.version, error?.message, onSnapshot, snapshotKey]);
  useEffect(() => () => {
    if (flushTimer.current !== undefined) {
      window.clearTimeout(flushTimer.current);
      flushTimer.current = undefined;
    }
  }, []);
  return null;
}

function ActivityRow({ item, child = false }: { item: WorkActivityItem; child?: boolean }) {
  const tone = item.failed ? "bg-danger" : item.active ? "bg-accent studio-pulse" : "bg-ok";
  return (
    <article className={`border-b border-line py-2 last:border-b-0 ${child ? "ml-5" : ""}`}>
      <div className="flex items-start gap-2.5">
        <span className={`mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full ${tone}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <strong className="truncate text-[12.5px] font-medium text-fg-0">{item.taskLabel}</strong>
            <span className="font-mono text-[10.5px] text-fg-3">{formatActivityDuration(item.totalMs)}</span>
          </div>
          <div className="mt-0.5 truncate text-[11.5px] text-fg-2">{item.stageLabel}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[10.5px] text-fg-3">
            {item.totalItems !== undefined ? <span>{item.completedItems ?? 0}/{item.totalItems} items</span> : null}
            {item.queuedMs !== undefined ? <span>queue {formatActivityDuration(item.queuedMs)}</span> : null}
            {item.runtimeMs !== undefined ? <span>run {formatActivityDuration(item.runtimeMs)}</span> : null}
            {item.providerStatus ? <span>{item.providerStatus}</span> : null}
          </div>
          {item.progressPercent !== undefined ? (
            <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-ink-3"><span className="block h-full rounded-full bg-accent" style={{ width: `${item.progressPercent}%` }} /></div>
          ) : null}
          {item.providerMessage ? <p className="mt-1 text-[11px] text-fg-3">{item.providerMessage}</p> : null}
          {item.error ? <p className="mt-1 text-[11px] text-danger">{item.error}</p> : null}
        </div>
      </div>
      {item.children.length ? <div className="mt-1">{item.children.map((entry) => <ActivityRow key={entry.id} item={entry} child />)}</div> : null}
    </article>
  );
}
