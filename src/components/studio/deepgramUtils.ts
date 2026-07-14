import { exportSRT, type SrtChunk } from "./srtUtils";
import { waitForTriggerRunOutput } from "@/lib/clientTriggerRuns";

export const DEEPGRAM_DEV_TRANSCRIBE_ENDPOINT = "/deepgram-transcribe";

type JsonRecord = Record<string, unknown>;

type RankedLabel = {
  label: string;
  confidence?: number;
  score?: number;
  percent?: number;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function asRecordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function optionalRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function getPrimaryAlternative(response: JsonRecord) {
  const results = asRecord(response.results);
  const channels = asRecordArray(results.channels);
  const firstChannel = asRecord(channels[0]);
  const alternatives = asRecordArray(firstChannel.alternatives);
  return asRecord(alternatives[0]);
}

function cleanText(value: unknown) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function numberFrom(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function chunkWords(words: JsonRecord[], duration = 8): SrtChunk[] {
  if (!Array.isArray(words) || words.length === 0) return [];
  const chunks: SrtChunk[] = [];
  let current: JsonRecord[] = [];
  let start = numberFrom(words[0]?.start, 0);

  for (const word of words) {
    const wordStart = numberFrom(word.start, start);
    const wordEnd = numberFrom(word.end, wordStart + 0.3);
    if (current.length > 0 && wordEnd - start >= duration) {
      chunks.push({
        index: chunks.length + 1,
        start,
        end: numberFrom(current.at(-1)?.end, wordEnd),
        text: current.map((item) => cleanText(item.punctuated_word || item.word)).join(" "),
      });
      current = [];
      start = wordStart;
    }
    current.push(word);
  }

  if (current.length > 0) {
    chunks.push({
      index: chunks.length + 1,
      start,
      end: numberFrom(current.at(-1)?.end, start + duration),
      text: current.map((item) => cleanText(item.punctuated_word || item.word)).join(" "),
    });
  }

  return chunks.map((chunk) => ({ ...chunk, text: cleanText(chunk.text) }));
}

function chunksFromParagraphs(paragraphs: unknown): SrtChunk[] {
  const sentences = asRecordArray(asRecord(paragraphs).paragraphs).flatMap((paragraph) => asRecordArray(paragraph.sentences));
  return sentences
    .filter((sentence) => cleanText(sentence.text))
    .map((sentence, index) => ({
      index: index + 1,
      start: numberFrom(sentence.start, 0),
      end: Math.max(numberFrom(sentence.end, 0), numberFrom(sentence.start, 0)),
      text: cleanText(sentence.text),
    }))
    .filter((chunk) => chunk.end > chunk.start);
}

function chunksFromUtterances(utterances: unknown): SrtChunk[] {
  return asRecordArray(utterances)
    .filter((utterance) => cleanText(utterance.transcript))
    .map((utterance, index) => ({
      index: index + 1,
      start: numberFrom(utterance.start, 0),
      end: Math.max(numberFrom(utterance.end, 0), numberFrom(utterance.start, 0)),
      text: cleanText(utterance.transcript),
      confidence: typeof utterance.confidence === "number" ? utterance.confidence : undefined,
      sentiment: utterance.sentiment,
      sentimentScore: typeof utterance.sentiment_score === "number" ? utterance.sentiment_score : undefined,
    }))
    .filter((chunk) => chunk.end > chunk.start);
}

function extractSummary(response: JsonRecord) {
  const summary = asRecord(response.results).summary;
  if (!summary) return "";
  if (typeof summary === "string") return cleanText(summary);
  const summaryRecord = asRecord(summary);
  return cleanText(summaryRecord.short || summaryRecord.result || summaryRecord.text || summaryRecord.summary);
}

function normalizeLabeledSegments(segments: unknown, key: string): RankedLabel[] {
  return asRecordArray(segments).flatMap((segment) =>
    asRecordArray(segment[key]).map((item) => ({
      label: cleanText(item.topic || item.intent || item.label || item.text),
      confidence: numberFrom(item.confidence ?? item.score, 0),
      start: numberFrom(segment.start_word ?? segment.start, 0),
      end: numberFrom(segment.end_word ?? segment.end, 0),
    })),
  );
}

function rankLabels(items: RankedLabel[], fallbackWordCount = 0) {
  const totals = new Map<string, { label: string; score: number; count: number }>();
  for (const item of items || []) {
    if (!item.label) continue;
    const previous = totals.get(item.label) || { label: item.label, score: 0, count: 0 };
    previous.score += numberFrom(item.confidence ?? item.score, 0.5);
    previous.count += 1;
    totals.set(item.label, previous);
  }
  const ranked = [...totals.values()].sort((a, b) => b.score - a.score);
  const totalScore = ranked.reduce((sum, item) => sum + item.score, 0) || fallbackWordCount || ranked.length || 1;
  return ranked.map((item) => ({
    ...item,
    percent: Math.round((item.score / totalScore) * 10000) / 100,
  }));
}

function extractTopicItems(response: JsonRecord): RankedLabel[] {
  const topics = asRecord(response.results).topics;
  if (Array.isArray(topics)) return asRecordArray(topics).map((topic) => ({ ...topic, label: cleanText(topic.label ?? topic.topic ?? topic.text) }));
  const topicRecord = asRecord(topics);
  return [
    ...normalizeLabeledSegments(topicRecord.segments, "topics"),
    ...normalizeLabeledSegments(topicRecord.results, "topics"),
  ];
}

function extractIntentItems(response: JsonRecord): RankedLabel[] {
  const intents = asRecord(response.results).intents;
  if (Array.isArray(intents)) return asRecordArray(intents).map((intent) => ({ ...intent, label: cleanText(intent.label ?? intent.intent ?? intent.text) }));
  const intentRecord = asRecord(intents);
  return [
    ...normalizeLabeledSegments(intentRecord.segments, "intents"),
    ...normalizeLabeledSegments(intentRecord.results, "intents"),
  ];
}

export function buildSrtChunksFromDeepgram(response: JsonRecord, options: JsonRecord = {}): SrtChunk[] {
  const alternative = getPrimaryAlternative(response);
  const metadata = asRecord(response.metadata);
  const results = asRecord(response.results);
  const duration = numberFrom(metadata.duration, numberFrom(options.duration, 60));
  const utteranceChunks = chunksFromUtterances(results.utterances);
  if (utteranceChunks.length > 0) return utteranceChunks;

  const paragraphChunks = chunksFromParagraphs(alternative.paragraphs);
  if (paragraphChunks.length > 0) return paragraphChunks;

  const wordChunks = chunkWords(asRecordArray(alternative.words), numberFrom(options.chunkDuration, 8));
  if (wordChunks.length > 0) return wordChunks;

  const transcript = cleanText(alternative.transcript);
  return transcript
    ? [
        {
          index: 1,
          start: 0,
          end: Math.max(1, duration),
          text: transcript,
        },
      ]
    : [];
}

export type DeepgramWordCoverage = {
  duration: number;
  lastWordEnd: number;
  wordCount: number;
};

/** How much of the audio the transcription's words actually span. */
export function measureDeepgramWordCoverage(response: JsonRecord): DeepgramWordCoverage {
  const alternative = getPrimaryAlternative(response);
  const words = asRecordArray(alternative.words);
  const duration = numberFrom(asRecord(response.metadata).duration, 0);
  let lastWordEnd = 0;
  for (const word of words) {
    lastWordEnd = Math.max(lastWordEnd, numberFrom(word.end, 0));
  }
  return { duration, lastWordEnd, wordCount: words.length };
}

/**
 * True when a speech model plausibly gave up on sung/processed vocals: the
 * audio is long but recognized words stop well before it ends. Used to decide
 * whether a whisper retry is worth the extra latency.
 */
export function isDeepgramCoverageSparse(coverage: DeepgramWordCoverage): boolean {
  if (coverage.duration < 30) return false;
  if (coverage.wordCount === 0) return true;
  return coverage.lastWordEnd < coverage.duration * 0.6;
}

/** Picks the transcription whose words cover more of the song. */
export function pickRicherDeepgramResponse(primary: JsonRecord, fallback: JsonRecord): JsonRecord {
  const primaryCoverage = measureDeepgramWordCoverage(primary);
  const fallbackCoverage = measureDeepgramWordCoverage(fallback);
  if (fallbackCoverage.wordCount === 0) return primary;
  if (primaryCoverage.wordCount === 0) return fallback;
  if (fallbackCoverage.lastWordEnd > primaryCoverage.lastWordEnd * 1.15) return fallback;
  if (fallbackCoverage.wordCount > primaryCoverage.wordCount * 1.3) return fallback;
  return primary;
}

/**
 * Merges a tail-segment transcription (audio sliced at offsetSeconds) into a
 * full-song transcription. ASR models drop sung content deep into a long
 * file but transcribe the same audio fine as its own clip, so the uncovered
 * tail is re-transcribed separately and stitched back with offset times.
 * Only utterances/words starting after the primary's last word are added;
 * junk without letters (e.g. "000000.") is dropped and ♪ marks stripped.
 */
export function mergeDeepgramTailResponse(primary: JsonRecord, tail: JsonRecord, offsetSeconds: number): JsonRecord {
  const minStart = measureDeepgramWordCoverage(primary).lastWordEnd + 0.25;
  const cleanLyric = (value: unknown) => cleanText(String(value ?? "").replace(/♪/g, " "));
  const hasLetters = (value: string) => /\p{L}/u.test(value);

  const offsetTail = (record: JsonRecord): JsonRecord => ({
    ...record,
    start: numberFrom(record.start, 0) + offsetSeconds,
    end: numberFrom(record.end, 0) + offsetSeconds,
  });

  const tailUtterances = asRecordArray(asRecord(tail.results).utterances)
    .map(offsetTail)
    .map((utterance): JsonRecord => ({ ...utterance, transcript: cleanLyric(utterance.transcript) }))
    .filter((utterance) => numberFrom(utterance.start, 0) >= minStart && hasLetters(String(utterance.transcript)));
  const tailAlternative = getPrimaryAlternative(tail);
  const tailWords = asRecordArray(tailAlternative.words)
    .map(offsetTail)
    .filter((word) => numberFrom(word.start, 0) >= minStart && hasLetters(cleanLyric(word.punctuated_word || word.word)));

  if (!tailUtterances.length && !tailWords.length) return primary;

  const merged = JSON.parse(JSON.stringify(primary)) as JsonRecord;
  const results = asRecord(merged.results);
  merged.results = results;
  results.utterances = [...asRecordArray(results.utterances), ...tailUtterances];

  const channels = asRecordArray(results.channels);
  const alternative = asRecord(asRecordArray(asRecord(channels[0]).alternatives)[0]);
  if (channels[0] && Array.isArray(asRecord(channels[0]).alternatives)) {
    alternative.words = [...asRecordArray(alternative.words), ...tailWords];
    const tailText = tailUtterances.map((utterance) => String(utterance.transcript)).join(" ");
    if (tailText) {
      alternative.transcript = cleanText(`${cleanText(alternative.transcript)} ${tailText}`);
    }
  }

  return merged;
}

export type DeepgramTranscriptSummary = {
  provider: "deepgram";
  model: string;
  duration: number;
  confidence: number | null;
  transcript: string;
  wordCount: number;
  chunks: SrtChunk[];
  srt: string;
  summary: string;
  topics: ReturnType<typeof rankLabels>;
  intents: ReturnType<typeof rankLabels>;
  sentiments: unknown;
  averageSentiment: unknown;
  entities: JsonRecord[];
  warnings: unknown[];
};

export function summarizeDeepgramResponse(response: JsonRecord, options: JsonRecord = {}): DeepgramTranscriptSummary {
  const alternative = getPrimaryAlternative(response);
  const chunks = buildSrtChunksFromDeepgram(response, options);
  const transcript = cleanText(alternative.transcript || chunks.map((chunk) => chunk.text).join(" "));
  const results = asRecord(response.results);
  const metadata = asRecord(response.metadata);
  const sentiments = optionalRecord(results.sentiments);
  const entities = asRecordArray(alternative.entities);
  const words = asRecordArray(alternative.words);
  const topics = rankLabels(extractTopicItems(response), words.length);
  const intents = rankLabels(extractIntentItems(response), words.length);
  const summary = extractSummary(response);

  return {
    provider: "deepgram",
    model: isRecord(metadata.model_info) ? "nova-3" : cleanText(options.model) || "nova-3",
    duration: numberFrom(metadata.duration, numberFrom(options.duration, 0)),
    confidence: typeof alternative.confidence === "number" ? alternative.confidence : null,
    transcript,
    wordCount: words.length || transcript.split(/\s+/).filter(Boolean).length,
    chunks,
    srt: chunks.length > 0 ? exportSRT(chunks) : "",
    summary,
    topics,
    intents,
    sentiments,
    averageSentiment: sentiments?.average || null,
    entities,
    warnings: Array.isArray(metadata.warnings) ? metadata.warnings : Array.isArray(response.warnings) ? response.warnings : [],
  };
}

export async function transcribeAudioWithDeepgram(
  file: File,
  options: { duration?: number; endpoint?: string; model?: string } = {},
) {
  if (!file) throw new Error("Select a song before transcription.");
  const endpoint = options.endpoint || DEEPGRAM_DEV_TRANSCRIBE_ENDPOINT;
  console.info(`[Deepgram] POST ${endpoint}`, { file: file.name, size: file.size, type: file.type || "application/octet-stream" });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-Audio-Filename": encodeURIComponent(file.name || "song-audio"),
    },
    body: file,
  });

  const text = await response.text();
  let payload: JsonRecord;
  try {
    payload = text ? asRecord(JSON.parse(text)) : {};
  } catch {
    payload = { error: text };
  }

  console.info(`[Deepgram] response ${response.status}`, payload);

  if (response.ok && payload.queued === true && typeof payload.runId === "string" && payload.runId.trim()) {
    const runOutput = await waitForTriggerRunOutput(payload.runId, {
      timeoutMs: 15 * 60 * 1_000,
      pollIntervalMs: 2_000,
    });
    payload = asRecord(runOutput);
  }

  if (!response.ok || payload.ok === false) {
    if (response.status === 401) {
      throw new Error(
        "Deepgram authentication failed (401). Update DEEPGRAM_API_KEY in the dev server environment, then restart the app and re-upload the vocal stem.",
      );
    }
    throw new Error(cleanText(payload.error || payload.reason) || `Deepgram transcription failed (${response.status})`);
  }

  return summarizeDeepgramResponse(payload, {
    duration: options.duration,
    model: options.model || "nova-3",
  });
}
