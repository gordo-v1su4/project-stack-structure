"use client";

import { useEffect, useRef, useState } from "react";

import type { DeepgramTranscriptSummary } from "./deepgramUtils";
import { UploadControl } from "./UploadControl";
import { formatVocalStemTranscriptStatus, transcribeVocalStemFile } from "./vocalStemTranscription";
import type { BeatJoinAnalysis } from "./types";

type IngestVocalStemLaneProps = {
  analysis: BeatJoinAnalysis | null;
  vocalStemName: string;
  transcriptSummary: DeepgramTranscriptSummary | null;
  disabled?: boolean;
  onTranscriptStart: (fileName: string) => void;
  onTranscriptComplete: (summary: DeepgramTranscriptSummary, fileName: string) => void;
  onTranscriptFailed: (message: string) => void;
};

export function IngestVocalStemLane({
  analysis,
  vocalStemName,
  transcriptSummary,
  disabled = false,
  onTranscriptStart,
  onTranscriptComplete,
  onTranscriptFailed,
}: IngestVocalStemLaneProps) {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState(() => formatVocalStemTranscriptStatus(transcriptSummary));
  const [error, setError] = useState<string | null>(null);
  const progressTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!isTranscribing) {
      setStatus(formatVocalStemTranscriptStatus(transcriptSummary));
    }
  }, [isTranscribing, transcriptSummary]);

  useEffect(() => () => {
    if (progressTimer.current) {
      window.clearInterval(progressTimer.current);
    }
  }, []);

  async function handleUpload(files: File[]) {
    const file = files[0];
    if (!file || isTranscribing || disabled) return;

    if (progressTimer.current) {
      window.clearInterval(progressTimer.current);
      progressTimer.current = null;
    }

    onTranscriptStart(file.name);
    setError(null);
    setIsTranscribing(true);
    setProgress(8);
    setStatus(`Transcribing ${file.name}…`);

    progressTimer.current = window.setInterval(() => {
      setProgress((current) => Math.min(88, current + (current < 35 ? 7 : current < 65 ? 4 : 2)));
    }, 900);

    try {
      const summary = await transcribeVocalStemFile(file, analysis?.duration);
      onTranscriptComplete(summary, file.name);
      setProgress(100);
      setStatus(formatVocalStemTranscriptStatus(summary));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Deepgram transcription unavailable.";
      setError(message);
      setProgress(0);
      setStatus(message);
      onTranscriptFailed(message);
    } finally {
      if (progressTimer.current) {
        window.clearInterval(progressTimer.current);
        progressTimer.current = null;
      }
      setIsTranscribing(false);
    }
  }

  const chunkCount = transcriptSummary?.chunks.length ?? 0;
  const statusLine = error
    ?? (vocalStemName
      ? `${vocalStemName}${transcriptSummary ? ` · ${chunkCount} timed lines` : isTranscribing ? ` · transcribing ${progress}%` : ""}`
      : status);

  return (
    <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Vocal stem</div>
            {transcriptSummary ? (
              <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#78c878]">{chunkCount} lines</span>
            ) : null}
          </div>
          <div className={`mt-1 truncate text-[10px] leading-4 ${error ? "text-[#c07a3f]" : transcriptSummary ? "text-[#777]" : "text-[#6d6d6d]"}`}>
            {!analysis
              ? "Upload master song first, then the isolated lead vocal."
              : statusLine}
          </div>
        </div>

        <div className="shrink-0">
          <UploadControl
            accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg"
            title=""
            detail=""
            actionLabel={isTranscribing ? `${progress}%` : transcriptSummary ? "Replace stem" : "Upload stem"}
            variant="button"
            disabled={disabled || isTranscribing || !analysis}
            onFiles={handleUpload}
          />
        </div>
      </div>

      {isTranscribing ? (
        <div className="mt-2 h-1 overflow-hidden rounded-[1px] bg-[#151515]">
          <div className="h-full bg-[#e05c00] transition-[width] duration-300" style={{ width: `${progress}%` }} />
        </div>
      ) : null}

      {transcriptSummary ? (
        <div className="mt-1.5 text-[9px] leading-4 text-[#555]">Timed lyrics preview is on Story.</div>
      ) : null}
    </section>
  );
}
