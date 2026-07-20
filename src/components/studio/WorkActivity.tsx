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

type ActivityCredentials = {
  accessToken: string;
  baseURL: string;
  tag: string;
  expiresAt: number;
};

export function WorkActivity() {
  const [open, setOpen] = useState(false);
  const [credentials, setCredentials] = useState<ActivityCredentials>();
  const [credentialVersion, setCredentialVersion] = useState(0);
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
          if (!cancelled) setRequiresSignIn(true);
          return;
        }
        if (!response.ok || !body.accessToken || !body.baseURL || !body.tag || !body.expiresAt) {
          throw new Error(body.error || `Work activity token failed (${response.status}).`);
        }
        if (cancelled) return;
        const next = body as ActivityCredentials;
        setCredentials(next);
        setRequiresSignIn(false);
        setConnectionError(undefined);
        setCredentialVersion((value) => value + 1);
        timer = window.setTimeout(refresh, workActivityTokenRefreshDelay(next.expiresAt));
      } catch (error) {
        if (cancelled) return;
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

  const onSnapshot = useCallback((next: ActivityRunInput[], error?: string) => {
    setRuns(next);
    setConnectionError(error);
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
    <div className="relative">
      {credentials ? (
        <WorkActivitySubscription
          key={credentialVersion}
          credentials={credentials}
          subscriptionId={`stack-structure-work-${credentialVersion}`}
          onSnapshot={onSnapshot}
        />
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="stack-structure-work-activity"
        aria-label={`Work activity: ${summaryLabel}`}
        className={`min-w-[76px] max-w-[240px] rounded-[2px] border px-2.5 py-1 text-left ${
          summary.active ? "border-[#6c3210] bg-[#1a100b]" : summary.failed ? "border-[#552020] bg-[#170b0b]" : "border-[#292929] bg-[#111]"
        }`}
      >
        <span className="block text-[8px] uppercase tracking-[0.16em] text-[#555]">Work</span>
        <span className="block truncate whitespace-nowrap font-mono text-[9px] text-[#c4c4c4]" title={summaryLabel}>
          {summaryLabel}
        </span>
      </button>

      {open ? (
        <section
          id="stack-structure-work-activity"
          aria-label="Work activity"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[430px] rounded-[3px] border border-[#292929] bg-[#0d0d0d] p-3 shadow-2xl shadow-black/70"
        >
          <div className="mb-2 flex items-center justify-between border-b border-[#202020] pb-2">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#d0d0d0]">Work activity</div>
              <div className="mt-1 text-[8px] text-[#555]">Trigger.dev production runs from the last 24 hours</div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="text-[9px] text-[#666] hover:text-[#aaa]">Close</button>
          </div>
          {requiresSignIn ? (
            <div className="rounded-[2px] border border-[#252525] bg-[#101010] p-3 text-[10px] text-[#777]">
              Sign in with GitHub from the Project menu to view your scoped production work.
            </div>
          ) : connectionError ? (
            <div className="rounded-[2px] border border-[#4a2020] bg-[#180b0b] p-3 text-[9px] text-[#c77777]">{connectionError}</div>
          ) : !credentials ? (
            <div className="py-5 text-center text-[9px] text-[#555]">Connecting...</div>
          ) : activity.length === 0 ? (
            <div className="py-5 text-center text-[9px] text-[#555]">No work in the last 24 hours.</div>
          ) : (
            <div className="max-h-[420px] space-y-1 overflow-y-auto">
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
  credentials: ActivityCredentials;
  subscriptionId: string;
  onSnapshot: (runs: ActivityRunInput[], error?: string) => void;
}) {
  const { runs, error } = useRealtimeRunsWithTag(credentials.tag, {
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
    pendingSnapshot.current = {
      runs: runs as unknown as ActivityRunInput[],
      error: error?.message,
    };
    if (flushTimer.current !== undefined) return;
    flushTimer.current = window.setTimeout(() => {
      flushTimer.current = undefined;
      onSnapshot(pendingSnapshot.current.runs, pendingSnapshot.current.error);
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error?.message, onSnapshot, snapshotKey]);
  useEffect(() => () => {
    if (flushTimer.current !== undefined) {
      window.clearTimeout(flushTimer.current);
      flushTimer.current = undefined;
    }
  }, []);
  return null;
}

function ActivityRow({ item, child = false }: { item: WorkActivityItem; child?: boolean }) {
  const tone = item.failed ? "#d05b5b" : item.active ? "#e05c00" : "#5f8f68";
  return (
    <article className={`rounded-[2px] border border-[#202020] bg-[#0a0a0a] p-2 ${child ? "ml-5" : ""}`}>
      <div className="flex items-start gap-2">
        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: tone }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <strong className="truncate text-[10px] font-medium text-[#c4c4c4]">{item.taskLabel}</strong>
            <span className="font-mono text-[8px] text-[#555]">{formatActivityDuration(item.totalMs)}</span>
          </div>
          <div className="mt-0.5 truncate text-[9px] text-[#666]">{item.stageLabel}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[8px] text-[#494949]">
            {item.totalItems !== undefined ? <span>{item.completedItems ?? 0}/{item.totalItems} items</span> : null}
            {item.queuedMs !== undefined ? <span>queue {formatActivityDuration(item.queuedMs)}</span> : null}
            {item.runtimeMs !== undefined ? <span>run {formatActivityDuration(item.runtimeMs)}</span> : null}
            {item.providerStatus ? <span>{item.providerStatus}</span> : null}
          </div>
          {item.progressPercent !== undefined ? (
            <div className="mt-1.5 h-0.5 overflow-hidden bg-[#1c1c1c]"><span className="block h-full bg-[#e05c00]" style={{ width: `${item.progressPercent}%` }} /></div>
          ) : null}
          {item.providerMessage ? <p className="mt-1 text-[8px] text-[#666]">{item.providerMessage}</p> : null}
          {item.error ? <p className="mt-1 text-[8px] text-[#c77777]">{item.error}</p> : null}
        </div>
      </div>
      {item.children.length ? <div className="mt-1 space-y-1">{item.children.map((entry) => <ActivityRow key={entry.id} item={entry} child />)}</div> : null}
    </article>
  );
}
