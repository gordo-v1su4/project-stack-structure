"use client";

import { AudioPreview } from "./AudioPreview";
import { UploadControl } from "./UploadControl";
import type { BeatJoinAnalysis } from "./types";
import { Button, ProgressBar } from "./ui";

type StudioAudioLaneProps = {
  analysis: BeatJoinAnalysis | null;
  isPreparingAudio: boolean;
  audioProgress: number;
  audioStatus: string;
  audioError: string | null;
  bpmFallback: number;
  subtitle: string;
  /** On Ingest the song upload lives in the checklist, so the empty lane hides itself. */
  onIngest: boolean;
  onAudioUpload: (files: File[]) => void | Promise<void>;
  onOpenIngest: () => void;
  onPlayheadChange: (nextPlayhead: number) => void;
};

/**
 * Persistent master-song lane. Once analysis exists it is the waveform that
 * follows the user through every stage; before that it only appears outside
 * Ingest as a one-line pointer back to the song upload.
 */
export function StudioAudioLane({
  analysis,
  isPreparingAudio,
  audioProgress,
  audioStatus,
  audioError,
  bpmFallback,
  subtitle,
  onIngest,
  onAudioUpload,
  onOpenIngest,
  onPlayheadChange,
}: StudioAudioLaneProps) {
  if (!analysis) {
    if (onIngest) {
      return isPreparingAudio ? (
        <div className="rounded-md border border-line bg-ink-2 px-4 py-3">
          <div className="flex items-center justify-between gap-3 text-[12px]">
            <span className="text-fg-1">Analyzing the master song…</span>
            <span className="font-mono text-[11px] text-accent">{Math.floor(audioProgress)}%</span>
          </div>
          <ProgressBar value={audioProgress} className="mt-2" />
        </div>
      ) : null;
    }
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-ink-2 px-4 py-2.5">
        <span className="text-[12px] text-fg-2">{isPreparingAudio ? "Analyzing the master song…" : "No master song yet. Upload it in Ingest to unlock beat sync."}</span>
        <Button size="sm" variant="secondary" onClick={onOpenIngest}>Open Ingest</Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <AudioPreview
        analysis={analysis}
        bpmFallback={bpmFallback}
        title={analysis.sourceLabel}
        subtitle={subtitle}
        onPlayheadChange={(nextPlayhead) => onPlayheadChange(nextPlayhead)}
      />
      {onIngest ? (
        <div className="flex items-center justify-between gap-3 px-1 text-[11px] text-fg-3">
          <span className="truncate">{audioError ?? audioStatus}</span>
          <UploadControl
            accept="audio/*"
            variant="button"
            title=""
            detail=""
            actionLabel={isPreparingAudio ? "Analyzing…" : "Replace song"}
            disabled={isPreparingAudio}
            processingProgress={audioProgress}
            onFiles={onAudioUpload}
          />
        </div>
      ) : null}
    </div>
  );
}
