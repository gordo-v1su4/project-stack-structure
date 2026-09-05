"use client";

import type { StageHeaderModel } from "./stageActions";
import { Button, Kicker, ProgressBar } from "./ui";

export type StagePreviewRun = {
  isRunning: boolean;
  progress: number;
  done: boolean;
  processingLabel: string;
  completedLabel: string;
};

type StageHeaderProps = {
  model: StageHeaderModel;
  preview: StagePreviewRun;
  /** Optional one-line notice rendered under the description (e.g. "Story changed"). */
  notice?: { text: string; tone: "warn" | "ok"; actionLabel?: string; onAction?: () => void } | null;
  onPrimary: () => void;
  onSecondary: () => void;
  onResetPreview: () => void;
};

/**
 * The one place a stage explains itself and offers its forward action.
 * Replaces the stage strip, the dock "Next Step" column, the prerequisite
 * panel header, and the ProcessActionBar.
 */
export function StageHeader({ model, preview, notice = null, onPrimary, onSecondary, onResetPreview }: StageHeaderProps) {
  const primary = model.primary;
  const secondary = model.secondary;
  const blocked = model.blocked;

  return (
    <header className="studio-fade-in rounded-md border border-line bg-ink-2">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <Kicker tone={blocked ? "waiting" : "accent"}>
              Step {model.step} of {model.total}
            </Kicker>
            <span className="truncate font-mono text-[11px] text-fg-3" title={model.status}>{model.status}</span>
          </div>
          <h1 className="mt-1 text-[20px] font-semibold tracking-tight text-fg-0">{model.title}</h1>
          <p className="mt-1 max-w-3xl text-[12.5px] leading-5 text-fg-2">{model.description}</p>
          {blocked ? (
            <p className="mt-2 max-w-3xl rounded-md border border-warn-lo bg-warn-tint px-3 py-2 text-[12px] leading-5 text-warn">
              {blocked.reason}
            </p>
          ) : null}
          {notice ? (
            <div className={`mt-2 flex flex-wrap items-center gap-3 text-[12px] ${notice.tone === "warn" ? "text-warn" : "text-ok"}`}>
              <span>{notice.text}</span>
              {notice.actionLabel && notice.onAction ? (
                <button type="button" onClick={notice.onAction} className="underline decoration-dotted underline-offset-4 hover:text-fg-0">
                  {notice.actionLabel}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {secondary ? (
              <Button
                variant="secondary"
                size="lg"
                onClick={onSecondary}
                disabled={Boolean(secondary.disabledReason) || preview.isRunning}
                reason={secondary.disabledReason}
              >
                {secondary.label}
              </Button>
            ) : null}
            {primary ? (
              <Button
                variant={primary.kind === "open-prerequisite" ? "secondary" : "primary"}
                size="lg"
                onClick={onPrimary}
                disabled={Boolean(primary.disabledReason)}
                reason={primary.disabledReason}
                data-stage-primary={primary.kind}
              >
                {primary.label}
                {primary.kind === "continue" ? <span aria-hidden className="ml-1">→</span> : null}
              </Button>
            ) : null}
          </div>
          {primary?.disabledReason && primary.kind === "continue" ? (
            <div className="max-w-[360px] text-right text-[11px] leading-4 text-fg-3">{primary.disabledReason}</div>
          ) : null}
        </div>
      </div>

      {preview.isRunning || preview.done ? (
        <div className="flex items-center gap-3 border-t border-line px-5 py-2.5">
          {preview.isRunning ? (
            <>
              <span className="text-[11px] text-fg-2">{preview.processingLabel}</span>
              <ProgressBar value={preview.progress} className="max-w-[320px]" />
              <span className="font-mono text-[11px] text-accent">{Math.floor(preview.progress)}%</span>
            </>
          ) : (
            <>
              <span aria-hidden className="h-2 w-2 rounded-full bg-ok" />
              <span className="truncate text-[11px] text-ok">{preview.completedLabel}</span>
              <button type="button" onClick={onResetPreview} className="ml-auto text-[11px] text-fg-3 hover:text-fg-1">
                Clear
              </button>
            </>
          )}
        </div>
      ) : null}
    </header>
  );
}
