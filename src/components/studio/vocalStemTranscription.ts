import { transcribeAudioWithDeepgram, type DeepgramTranscriptSummary } from "./deepgramUtils";

export function formatVocalStemTranscriptStatus(summary: DeepgramTranscriptSummary | null) {
  if (!summary) return "Upload the isolated vocal stem to extract timed lyrics and SRT chunks.";

  return `Deepgram extracted ${summary.wordCount} words into ${summary.chunks.length} timed SRT chunks${
    summary.topics.length || summary.intents.length ? ` · ${summary.topics.length + summary.intents.length} topics/intents` : ""
  }.`;
}

export async function transcribeVocalStemFile(file: File, songDuration?: number) {
  return transcribeAudioWithDeepgram(file, { duration: songDuration });
}
