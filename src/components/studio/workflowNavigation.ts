import type { PipelineStage } from "./studioPipeline";
import type { Tab } from "./types";

/** Stable internal tabs keep saved projects and detailed tools addressable. */
export const WORKFLOW_STEPS: ReadonlyArray<{ key: Tab; label: string; tabs: readonly Tab[] }> = [
  { key: "review", label: "Setup", tabs: ["review"] },
  { key: "story", label: "Story", tabs: ["story"] },
  { key: "generate", label: "Draft", tabs: ["generate", "join", "shuffle", "split"] },
  { key: "compose", label: "Finish", tabs: ["compose", "ramp"] },
];

export function workflowStepForTab(tab: Tab) {
  return WORKFLOW_STEPS.find((step) => step.tabs.includes(tab))!;
}

export function buildWorkflowNavigation(stages: PipelineStage[], activeTab: Tab): PipelineStage[] {
  const byKey = new Map(stages.map((stage) => [stage.key, stage]));
  const steps = WORKFLOW_STEPS.map((step, index) => {
    const stage = byKey.get(step.key)!;
    const complete = step.key === "generate"
      ? stage.ready && Boolean(byKey.get("join")?.ready)
      : stage.complete;
    return { ...stage, label: step.label, step: index + 1, active: step.tabs.includes(activeTab), complete, isNext: false };
  });
  const next = steps.findIndex((step) => !step.complete);
  return steps.map((step, index) => ({ ...step, isNext: index === next }));
}
