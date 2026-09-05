"use client";

import { AudioPreview } from "./AudioPreview";
import type { BeatJoinAnalysis } from "./types";
import { Button, ProgressBar } from "./ui";

type StudioAudioLaneProps = {
  analysis: BeatJoinAnalysis | null;
  isPreparingAudio: boolean;
  audioProgress: number;
  audioError: string | null;
  bpmFallback: number;
  subtitle: string;
  onOpenIngest: () => void;
  onPlayheadChange: (nextPlayhead: number) => void;
};

/**
 * Persistent master-song lane shown on every stage after Ingest. Once analysis
 * exists it is the waveform that follows the user; before that it is a one-line
 * pointer back to the song upload, which only lives in the Ingest checklist.
 */
export function StudioAudioLane({
  analysis,
  isPreparingAudio,
  audioProgress,
  audioError,
  bpmFallback,
  subtitle,
  onOpenIngest,
  onPlayheadChange,
}: StudioAudioLaneProps) {
  if (!analysis) {
    return (
      <div className="rounded-md border border-line bg-ink-2 px-4 py-2.5">
        <div className="flex items-center justify-between gap-3 text-[12px]">
          <span className="text-fg-2">
            {isPreparingAudio ? "Analyzing the master song…" : "No master song yet. Upload it in Ingest to unlock beat sync."}
          </span>
          {isPreparingAudio ? (
            <span className="font-mono text-[11px] text-accent">{Math.floor(audioProgress)}%</span>
          ) : (
            <Button size="sm" variant="secondary" onClick={onOpenIngest}>Open Ingest</Button>
          )}
        </div>
        {isPreparingAudio ? <ProgressBar value={audioProgress} className="mt-2" /> : null}
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
      {audioError ? (
        <div className="flex items-center justify-between gap-3 px-1 text-[11px]">
          <span className="truncate text-danger">{audioError}</span>
          <Button size="sm" variant="ghost" onClick={onOpenIngest}>Fix in Ingest</Button>
        </div>
      ) : null}
    </div>
  );
}
