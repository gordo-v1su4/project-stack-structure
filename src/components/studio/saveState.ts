import type { StatusTone } from "./ui";

export type SaveStateKind = "idle" | "restored" | "dirty" | "saving" | "saved" | "error";

export interface SaveState {
  kind: SaveStateKind;
  /** Epoch ms of the last successful save/restore, when known. */
  at: number | null;
  /** Where the project lives: named RustFS project or browser-local draft. */
  scope: "project" | "local";
  /** Optional detail for tooltips (error messages, project names). */
  detail: string | null;
}

export function createSaveState(scope: SaveState["scope"] = "local"): SaveState {
  return { kind: "idle", at: null, scope, detail: null };
}

export function describeSaveState(state: SaveState, now = Date.now()): { label: string; tone: StatusTone; detail: string } {
  const where = state.scope === "project" ? "RustFS project" : "this browser";
  switch (state.kind) {
    case "saving":
      return { label: "Saving…", tone: "processing", detail: `Writing to ${where}.` };
    case "saved":
      return { label: state.at ? `Saved ${formatRelative(state.at, now)}` : "Saved", tone: "ready", detail: `Autosaved to ${where}.` };
    case "restored":
      return { label: "Restored", tone: "ready", detail: state.detail ?? `Restored from ${where}.` };
    case "dirty":
      return {
        label: "Unsaved changes",
        tone: "waiting",
        detail: state.scope === "project"
          ? "Autosaves to RustFS every few minutes and whenever you change stage."
          : "Autosaves to this browser. Sign in and create a project to keep it across devices.",
      };
    case "error":
      return { label: "Save failed", tone: "failed", detail: state.detail ?? "Autosave will retry." };
    case "idle":
    default:
      return {
        label: state.scope === "project" ? "Project" : "Local draft",
        tone: "waiting",
        detail: state.scope === "project" ? "Named project in RustFS." : "Unsaved browser draft. Sign in to create a durable project.",
      };
  }
}

export function formatRelative(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
