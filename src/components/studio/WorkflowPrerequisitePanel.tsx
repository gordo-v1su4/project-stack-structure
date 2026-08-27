"use client";

import type { PipelineStage } from "./studioPipeline";

type WorkflowPrerequisitePanelProps = {
  stage: PipelineStage;
  onOpenPrerequisite: () => void;
};

export function WorkflowPrerequisitePanel({ stage, onOpenPrerequisite }: WorkflowPrerequisitePanelProps) {
  return (
    <section className="rounded-[2px] border border-[#2b211a] bg-[#0b0806]/95 px-5 py-8 backdrop-blur-sm">
      <div className="mx-auto max-w-2xl text-center">
        <div className="text-[9px] uppercase tracking-[0.2em] text-[#b86432]">{stage.label} is waiting</div>
        <div className="mt-3 text-[16px] font-medium text-[#d0d0d0]">Finish the contributing step first</div>
        <div className="mt-2 text-[11px] leading-5 text-[#777]">
          {stage.blockedReason ?? "Complete the required upstream work before using this workspace."}
        </div>
        {stage.prerequisiteKey ? (
          <button
            type="button"
            onClick={onOpenPrerequisite}
            className="mt-5 rounded-[2px] border border-[#7a3a10] bg-[#160c05] px-4 py-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#e05c00] hover:border-[#e05c00]"
          >
            Open required step
          </button>
        ) : null}
      </div>
    </section>
  );
}
