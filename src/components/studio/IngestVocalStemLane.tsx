"use client";

import { useEffect, useRef, useState } from "react";

import type { DeepgramTranscriptSummary } from "./deepgramUtils";
import { fmt } from "./math";
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
    setStatus(`Vocal stem loaded: ${file.name}. Sending stem to Deepgram for lyrics/SRT...`);

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

  return (
    <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Vocal stem / lyrics</div>
          <div className="mt-1 max-w-3xl text-[11px] leading-5 text-[#6d6d6d]">
            Upload the isolated lead vocal. Deepgram turns it into timed lyric lines and SRT chunks for Match, Story, and Smart captions.
          </div>
        </div>
        {transcriptSummary ? (
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#78c878]">{chunkCount} timed lines</div>
        ) : null}
      </div>

      <UploadControl
        accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg"
        title={isTranscribing ? "Transcribing vocal stem…" : transcriptSummary ? "Replace vocal stem" : "Upload vocal stem"}
        detail="Use the stem-only vocal track, not the full mix. Story stays locked until lyrics are ready."
        actionLabel={isTranscribing ? `Transcribing ${progress}%` : transcriptSummary ? "Replace Vocal Stem" : "Upload Vocal Stem"}
        disabled={disabled || isTranscribing || !analysis}
        isProcessing={isTranscribing}
        processingProgress={progress}
        status={vocalStemName ? `${vocalStemName}${transcriptSummary ? ` · ${chunkCount} chunks` : ""}` : status}
        error={error}
        onFiles={handleUpload}
      />

      {!analysis ? (
        <div className="mt-2 text-[10px] leading-4 text-[#6f4a12]">Upload the master song first so lyric timing can align to the beat map.</div>
      ) : null}

      {transcriptSummary ? (
        <details className="mt-3 rounded-[2px] border border-[#171717] bg-[#070707]">
          <summary className="cursor-pointer px-3 py-2 text-[9px] uppercase tracking-[0.14em] text-[#777]">
            Preview lyrics · {chunkCount} timed lines
          </summary>
          <div className="grid gap-2 border-t border-[#171717] p-2 lg:grid-cols-2">
            <div className="max-h-48 overflow-auto whitespace-pre-wrap rounded-[2px] bg-[#030303] p-2 text-[10px] leading-4 text-[#a7a7a7]">
              {transcriptSummary.transcript || "No transcript text returned."}
            </div>
            <div className="max-h-48 space-y-1 overflow-auto rounded-[2px] bg-[#030303] p-2 font-mono text-[9px] text-[#878787]">
              {transcriptSummary.chunks.map((chunk) => (
                <div key={`${chunk.index}-${chunk.start}`} className="grid grid-cols-[86px_1fr] gap-2 border-b border-[#101010] pb-1 last:border-b-0">
                  <span className="text-[#e05c00]">{fmt(chunk.start)}–{fmt(chunk.end)}</span>
                  <span className="text-[#9c9c9c]">{chunk.text}</span>
                </div>
              ))}
            </div>
          </div>
        </details>
      ) : null}
    </section>
  );
}
