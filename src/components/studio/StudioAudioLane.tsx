"use client";

import { AudioPreview } from "./AudioPreview";
import { UploadControl } from "./UploadControl";
import type { BeatJoinAnalysis } from "./types";

type StudioAudioLaneProps = {
  analysis: BeatJoinAnalysis | null;
  isPreparingAudio: boolean;
  audioProgress: number;
  audioStatus: string;
  audioError: string | null;
  bpmFallback: number;
  subtitle: string;
  onAudioUpload: (files: File[]) => void | Promise<void>;
  onPlayheadChange: (nextPlayhead: number) => void;
};

export function StudioAudioLane({
  analysis,
  isPreparingAudio,
  audioProgress,
  audioStatus,
  audioError,
  bpmFallback,
  subtitle,
  onAudioUpload,
  onPlayheadChange,
}: StudioAudioLaneProps) {
  if (!analysis) {
    return (
      <div className="space-y-2 border border-[#181818] rounded-[3px] bg-[linear-gradient(180deg,#0e0e0e_0%,#090909_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="truncate text-[11px] uppercase tracking-[0.24em] text-[#d7d7d7]">Master Song Lane</div>
            <div className="mt-1 text-[9px] uppercase tracking-[0.22em] text-[#626262]">
              Upload the song once and keep it available across every studio mode.
            </div>
          </div>
        </div>

        <UploadControl
          accept="audio/*"
          title={isPreparingAudio ? "Analyzing the master song…" : "Upload the master song"}
          detail="We keep the progress bar visible while Essentia runs, then reveal the waveform and beat-driven visuals when analysis is ready."
          actionLabel={isPreparingAudio ? "Analyzing Audio…" : "Upload Audio"}
          disabled={isPreparingAudio}
          isProcessing={isPreparingAudio}
          processingProgress={audioProgress}
          status={audioStatus}
          error={audioError}
          onFiles={onAudioUpload}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 rounded-[3px] border border-[#181818] bg-[#0b0b0b] px-3 py-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#d7d7d7]">Master Song Lane</div>
          <div className="mt-1 text-[9px] uppercase tracking-[0.16em] text-[#5f5f5f]">{audioStatus}</div>
        </div>
        <UploadControl
          accept="audio/*"
          variant="button"
          title=""
          detail=""
          actionLabel={isPreparingAudio ? "Analyzing…" : "Replace Audio"}
          disabled={isPreparingAudio}
          processingProgress={audioProgress}
          onFiles={onAudioUpload}
        />
      </div>

      <AudioPreview
        analysis={analysis}
        bpmFallback={bpmFallback}
        title={analysis.sourceLabel}
        subtitle={subtitle}
        onPlayheadChange={(nextPlayhead) => onPlayheadChange(nextPlayhead)}
      />
    </div>
  );
}
