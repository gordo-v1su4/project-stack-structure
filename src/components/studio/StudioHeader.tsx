"use client";

import { useEffect, useState } from "react";
import type { PersistedStudioProjectDraft, RuntimeStudioProjectDraft } from "./projectPersistence";
import type { StudioProjectSummary } from "@/lib/studioProjectStore";
import { ProjectLibrary } from "./ProjectLibrary";
import { describeSaveState, type SaveState } from "./saveState";
import { StatusDot } from "./ui";
import { WorkActivity } from "./WorkActivity";

type StudioHeaderProps = {
  songLabel: string | null;
  songDuration: number | null;
  saveState: SaveState;
  projectDraft: PersistedStudioProjectDraft;
  activeProjectId: string | null;
  activeProjectName: string;
  onNewProject: () => Promise<boolean>;
  onProjectSelected: (project: StudioProjectSummary, draft: RuntimeStudioProjectDraft) => void;
  onProjectSaved: (project: StudioProjectSummary) => void;
};

/** Project identity + persistence state. Stage identity lives in StageHeader. */
export function StudioHeader({ songLabel, songDuration, saveState, projectDraft, activeProjectId, activeProjectName, onNewProject, onProjectSelected, onProjectSaved }: StudioHeaderProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  const save = describeSaveState(saveState, now);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-line bg-ink-1 px-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="truncate text-[13px] font-medium text-fg-0" title={activeProjectName}>{activeProjectName}</span>
        <span className="flex items-center gap-1.5 rounded-md border border-line px-2 py-[3px] text-[11px] text-fg-2" title={save.detail}>
          <StatusDot tone={save.tone} pulse />
          {save.label}
        </span>
        {songLabel ? (
          <span className="hidden min-w-0 items-center gap-2 text-[11px] text-fg-3 md:flex" title={songLabel}>
            <span className="text-fg-4">·</span>
            <span className="truncate font-mono">{songLabel}</span>
            {songDuration ? <span className="font-mono text-fg-4">{formatDuration(songDuration)}</span> : null}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <WorkActivity />
        <ProjectLibrary
          draft={projectDraft}
          activeProjectId={activeProjectId}
          activeProjectName={activeProjectName}
          onNewProject={onNewProject}
          onProjectSelected={onProjectSelected}
          onProjectSaved={onProjectSaved}
        />
      </div>
    </header>
  );
}

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}
