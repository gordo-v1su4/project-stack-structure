export type ReviewBackfillInput = { bucket: string; objectKey: string; label: string };
export type ReviewBackfillRow = { id: string; source: ReviewBackfillInput; state: "waiting" | "preparing" | "ready" | "failed";
  childRunId?: string; posterKey?: string };
export type ReviewBackfillStatus = "queued" | "dispatch_unknown" | "running" | "ready" | "partial" | "failed" | "cancelled";
export type ReviewBackfillSnapshot = { projectId: string; id: string; status: ReviewBackfillStatus; parentRunId?: string;
  updatedAt: string; revision: string; rows: ReviewBackfillRow[] };
export function reviewBackfillCounts(rows: ReviewBackfillRow[]) {
  return { total: rows.length, ready: rows.filter(row => row.state === "ready").length, failed: rows.filter(row => row.state === "failed").length,
    active: rows.filter(row => row.state === "preparing").length, waiting: rows.filter(row => row.state === "waiting").length };
}
export function reviewBackfillActive(status: ReviewBackfillStatus) { return ["queued", "dispatch_unknown", "running"].includes(status); }
