"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { PersistedStudioProjectDraft, RuntimeStudioProjectDraft } from "../projectPersistence";
import type { StudioProjectSummary } from "@/lib/studioProjectStore";
import { ProjectLibrary } from "../ProjectLibrary";
import { describeSaveState, type SaveState } from "../saveState";
import type { StageHeaderModel } from "../stageActions";
import { Button, Kicker, ProgressBar, StatusDot } from "../ui";

export type StagePreviewRun = {
  isRunning: boolean;
  progress: number;
  done: boolean;
  processingLabel: string;
  completedLabel: string;
};
import { WorkActivity } from "../WorkActivity";

type InspectorProps = {
  model: StageHeaderModel | null;
  preview: StagePreviewRun;
  notice?: { text: string; tone: "warn" | "ok"; actionLabel?: string; onAction?: () => void } | null;
  onPrimary: () => void;
  onSecondary: () => void;
  onResetPreview: () => void;
  saveState: SaveState;
  projectDraft: PersistedStudioProjectDraft;
  activeProjectId: string | null;
  activeProjectName: string;
  onNewProject: () => Promise<boolean>;
  onProjectSelected: (project: StudioProjectSummary, draft: RuntimeStudioProjectDraft) => void;
  onProjectSaved: (project: StudioProjectSummary) => void;
  /** Act-specific evidence and controls (Phase C modules). */
  children?: ReactNode;
};

/**
 * The one rail where controls live. Project identity on top, then the act:
 * what it is for, whether it is blocked, and the single action that moves the
 * user forward. Act modules mount underneath.
 */
export function Inspector({
  model,
  preview,
  notice = null,
  onPrimary,
  onSecondary,
  onResetPreview,
  saveState,
  projectDraft,
  activeProjectId,
  activeProjectName,
  onNewProject,
  onProjectSelected,
  onProjectSaved,
  children,
}: InspectorProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  const save = describeSaveState(saveState, now);
  const primary = model?.primary ?? null;
  const secondary = model?.secondary ?? null;
  const blocked = model?.blocked ?? null;

  return (
    <aside aria-label="Inspector" className="vt-inspector flex w-[360px] shrink-0 flex-col border-l border-line bg-ink-1">
      {/* Project — outside the scroll area so its popovers can escape. */}
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <ProjectLibrary
          draft={projectDraft}
          activeProjectId={activeProjectId}
          activeProjectName={activeProjectName}
          onNewProject={onNewProject}
          onProjectSelected={onProjectSelected}
          onProjectSaved={onProjectSaved}
        />
        <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap font-mono text-[11px] text-fg-3" title={save.detail}>
          <StatusDot tone={save.tone} pulse />
          {save.label}
        </div>
        <WorkActivity />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {model ? (
          <section className="border-b border-line px-5 pb-5 pt-5">
            <div className="flex items-center gap-3">
              <Kicker tone={blocked ? "waiting" : "accent"}>Act {model.step} of {model.total}</Kicker>
            </div>
            <h1 className="vt-act-title font-display mt-2 text-[36px] leading-[1] text-fg-0">{model.title}</h1>
            <p className="mt-2 font-mono text-[11.5px] text-fg-2" title={model.status}>{model.status}</p>
            <p className="mt-3 text-[13px] leading-[1.5] text-fg-2">{model.description}</p>

            {blocked ? (
              <p className="mt-3 rounded-md border border-warn-lo bg-warn-tint px-3 py-2 text-[12px] leading-5 text-warn">{blocked.reason}</p>
            ) : null}
            {notice ? (
              <div className={`mt-3 flex flex-wrap items-center gap-3 text-[12px] ${notice.tone === "warn" ? "text-warn" : "text-ok"}`}>
                <span>{notice.text}</span>
                {notice.actionLabel && notice.onAction ? (
                  <button type="button" onClick={notice.onAction} className="underline decoration-dotted underline-offset-4 hover:text-fg-0">
                    {notice.actionLabel}
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="mt-5 flex flex-col gap-2">
              {primary ? (
                <Button
                  variant={primary.kind === "open-prerequisite" ? "secondary" : "primary"}
                  size="lg"
                  onClick={onPrimary}
                  disabled={Boolean(primary.disabledReason)}
                  reason={primary.disabledReason}
                  data-stage-primary={primary.kind}
                  align="between"
                  className="w-full"
                >
                  <span>{primary.label}</span>
                  {primary.kind === "continue" ? <span aria-hidden>→</span> : null}
                </Button>
              ) : null}
              {secondary ? (
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={onSecondary}
                  disabled={Boolean(secondary.disabledReason) || preview.isRunning}
                  reason={secondary.disabledReason}
                  align="between"
                  className="w-full"
                >
                  <span>{secondary.label}</span>
                  {!secondary.disabledReason ? <kbd className="studio-kbd">P</kbd> : null}
                </Button>
              ) : null}
              {primary?.disabledReason && primary.kind === "continue" ? (
                <p className="text-[11px] leading-4 text-fg-3">{primary.disabledReason}</p>
              ) : null}
            </div>

            {preview.isRunning || preview.done ? (
              <div className="mt-4 flex items-center gap-3 border-t border-line pt-3">
                {preview.isRunning ? (
                  <>
                    <span className="min-w-0 truncate text-[11px] text-fg-2">{preview.processingLabel}</span>
                    <ProgressBar value={preview.progress} className="flex-1" />
                    <span className="font-mono text-[11px] text-accent">{Math.floor(preview.progress)}%</span>
                  </>
                ) : (
                  <>
                    <StatusDot tone="ready" />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-ok">{preview.completedLabel}</span>
                    <button type="button" onClick={onResetPreview} className="text-[11px] text-fg-3 hover:text-fg-1">Clear</button>
                  </>
                )}
              </div>
            ) : null}
          </section>
        ) : null}

        {children ? <div className="px-5 py-4">{children}</div> : null}
      </div>
    </aside>
  );
}
