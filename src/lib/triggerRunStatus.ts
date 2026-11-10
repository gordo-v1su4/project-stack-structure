const terminalFailures = new Set([
  "FAILED", "CRASHED", "SYSTEM_FAILURE", "EXPIRED", "INTERRUPTED", "TIMED_OUT",
]);

/** Older SDKs can leave every terminal flag false for newer control-plane statuses. */
export function normalizeTriggerRunStatus<T extends { status: string }>(run: T): T {
  const failed = terminalFailures.has(run.status);
  const cancelled = run.status === "CANCELED";
  const success = run.status === "COMPLETED";
  if (!failed && !cancelled && !success) return run;
  return { ...run, isCompleted: true, isFailed: failed, isCancelled: cancelled,
    isSuccess: success, isQueued: false, isExecuting: false, isWaiting: false };
}
