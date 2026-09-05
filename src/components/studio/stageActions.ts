import type { PipelineStage } from "./studioPipeline";
import type { Tab } from "./types";

/**
 * Pure model for the stage header: what the stage is for, whether it is
 * blocked, and the single primary action that moves the user forward.
 * Labels must describe what the button actually does — "Continue to Match"
 * advances the tab; "Preview" runs a preview pass; nothing else is implied.
 */

export const STAGE_DESCRIPTIONS: Record<Tab, string> = {
  review: "Upload the song, vocal stem, character and location references, and footage. Scenes are detected and captioned automatically.",
  story: "Pick a director treatment, resolve its story anchors against your footage, and confirm the plan that drives every section.",
  split: "Choose how footage is cut into candidate windows. Scene cuts are the default; rhythm adds onset-driven cuts.",
  shuffle: "Every section gets its best-scoring footage moment. Swap alternates where the pick is weak.",
  generate: "Fill true coverage gaps with generated shots. Short and weak matches are optional quality reviews.",
  join: "The approved edit in song order. Nothing reshuffles here — changes go back through Match or Generate.",
  ramp: "Speed ramps and transition curves over the joined edit. Defaults are tuned for music video pacing.",
  compose: "Pick a shader treatment, preview the final edit, and export the MP4.",
};

/** Stages that can run a preview pass from the header. */
const PREVIEW_TABS = new Set<Tab>(["story", "shuffle", "generate", "join", "ramp", "compose"]);

export type StageActionKind = "open-prerequisite" | "continue" | "preview" | "none";

export interface StageAction {
  kind: StageActionKind;
  label: string;
  targetTab: Tab | null;
  disabledReason: string | null;
}

export interface StageHeaderModel {
  step: number;
  total: number;
  title: string;
  description: string;
  status: string;
  blocked: { reason: string; prerequisiteKey: Tab | null; prerequisiteLabel: string | null } | null;
  primary: StageAction | null;
  secondary: StageAction | null;
}

export interface StageActionInput {
  stages: PipelineStage[];
  activeTab: Tab;
  /** True when a preview pass can be started right now (segments or a section window exist). */
  canPreview: boolean;
  previewDisabledReason: string | null;
  /** True while a preview/export request is in flight. */
  isBusy: boolean;
}

export function buildStageHeaderModel(input: StageActionInput): StageHeaderModel | null {
  const stage = input.stages.find((candidate) => candidate.key === input.activeTab);
  if (!stage) return null;
  const index = input.stages.indexOf(stage);
  const next = input.stages[index + 1] ?? null;
  const prerequisite = stage.prerequisiteKey ? input.stages.find((candidate) => candidate.key === stage.prerequisiteKey) ?? null : null;

  const blocked = !stage.available
    ? {
        reason: stage.blockedReason ?? "Finish the previous stage first.",
        prerequisiteKey: stage.prerequisiteKey,
        prerequisiteLabel: prerequisite?.label ?? null,
      }
    : null;

  let primary: StageAction | null = null;
  if (blocked) {
    primary = {
      kind: "open-prerequisite",
      label: blocked.prerequisiteLabel ? `Open ${blocked.prerequisiteLabel}` : "Open previous stage",
      targetTab: blocked.prerequisiteKey,
      disabledReason: blocked.prerequisiteKey ? null : "No prerequisite stage",
    };
  } else if (next) {
    primary = {
      kind: "continue",
      label: `Continue to ${next.label}`,
      targetTab: next.key,
      disabledReason: stage.ready ? null : continueBlockedReason(stage),
    };
  }

  const secondary: StageAction | null = PREVIEW_TABS.has(stage.key) && !blocked
    ? {
        kind: "preview",
        label: previewLabel(stage.key),
        targetTab: null,
        disabledReason: input.isBusy
          ? "Preview already running"
          : input.canPreview
            ? null
            : input.previewDisabledReason ?? "Nothing to preview yet",
      }
    : null;

  return {
    step: stage.step,
    total: input.stages.length,
    title: stage.label,
    description: STAGE_DESCRIPTIONS[stage.key] ?? "",
    status: stage.status,
    blocked,
    primary,
    secondary,
  };
}

function continueBlockedReason(stage: PipelineStage): string {
  switch (stage.key) {
    case "review":
      return `Ingest not complete · ${stage.status}`;
    case "story":
      return stage.status;
    case "split":
      return "Choose a split strategy with detected scenes";
    case "shuffle":
      return "Match needs at least one matched section";
    case "generate":
      return `${stage.status} · required before Join`;
    case "join":
      return "Join needs a resolved edit";
    default:
      return stage.status;
  }
}

function previewLabel(tab: Tab): string {
  switch (tab) {
    case "story":
      return "Preview story edit";
    case "shuffle":
      return "Preview matches";
    case "generate":
      return "Preview selection";
    case "join":
      return "Preview edit";
    case "ramp":
      return "Preview with effects";
    case "compose":
      return "Preview final edit";
    default:
      return "Preview";
  }
}
