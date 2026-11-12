export type ProjectWorkRow = { id: string; kind: "image" | "video"; shotId: string; state: string;
  updatedAt: string; runId?: string; attempt: number; currentPlan: boolean; selected: boolean };
export type ProjectWorkSnapshot = { projectId: string; revision: string; checkedAt: string; total: number;
  partial: boolean; rows: ProjectWorkRow[] };
export function isProjectWorkActive(row: ProjectWorkRow) {
  return ["queued", "preparing", "submitting", "rendering", "persisting", "cancel_requested"].includes(row.state);
}
