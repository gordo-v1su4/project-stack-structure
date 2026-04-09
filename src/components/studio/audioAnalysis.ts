import type { BeatJoinAnalysis, BeatJoinSection } from "./types";

const DEFAULT_EMPTY_SECTIONS: BeatJoinSection[] = [{ label: "Intro", start: 0, end: 1 }];

interface EssentiaRequestTarget {
  headers?: HeadersInit;
  transport: "direct" | "proxy";
  url: string;
}

export async function fetchEssentiaAnalysis(file: File) {
  const startedAt = performance.now();
  const requestTarget = resolveEssentiaRequestTarget();
  console.groupCollapsed("[Essentia] Upload analysis");
  console.info("[Essentia] Request started", {
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || "unknown",
    transport: requestTarget.transport,
    url: requestTarget.url,
  });

  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch(requestTarget.url, {
      method: "POST",
      headers: requestTarget.headers,
      body: formData,
    });

    const payload = await readResponsePayload(response);

    const responseObject = isRecord(payload) ? payload : null;
    const rawPayload = isRecord(responseObject?.raw) ? responseObject.raw : payload;

    console.info("[Essentia] Response received", {
      ok: response.ok,
      status: response.status,
      elapsedMs: Math.round(performance.now() - startedAt),
      duration: getNumericValue(responseObject?.duration),
      bpm: getNumericValue(responseObject?.bpm),
      beats: getArrayLength(responseObject?.beats),
      onsets: getArrayLength(responseObject?.onsets),
      energyPoints: getArrayLength(responseObject?.energy),
      sections: getArrayLength(responseObject?.sections),
    });
    console.info("[Essentia] Raw upstream payload", rawPayload);

    if (!response.ok) {
      const message = getEssentiaErrorMessage({
        payload,
        status: response.status,
        statusText: response.statusText,
        transport: requestTarget.transport,
      });
      console.error("[Essentia] Request failed", payload);
      throw new Error(message);
    }

    return payload;
  } finally {
    console.groupEnd();
  }
}

export function resolveEssentiaRequestTarget(): EssentiaRequestTarget {
  const directApiUrl =
    (process.env.NEXT_PUBLIC_ESSENTIA_API_BASE_URL ?? process.env.NEXT_PUBLIC_ESSENTIA_API_URL ?? "").trim().replace(/\/+$/, "");
  const directApiKey = (process.env.NEXT_PUBLIC_ESSENTIA_API_KEY ?? "").trim();

  if (directApiUrl && directApiKey) {
    return {
      url: `${directApiUrl}/analyze/full`,
      transport: "direct",
      headers: {
        Authorization: `Bearer ${directApiKey}`,
        "X-API-Key": directApiKey,
      },
    };
  }

  return {
    url: "/api/essentia/full",
    transport: "proxy",
  };
}

export function getEssentiaErrorMessage(params: {
  payload: unknown;
  status: number;
  statusText?: string;
  transport: EssentiaRequestTarget["transport"];
}) {
  const { payload, status, statusText, transport } = params;
  const detail = extractErrorText(payload);

  if (status === 413) {
    if (transport === "proxy") {
      return detail ??
        "The audio upload was rejected by this deployment before Essentia received it. This usually means the host's request-size limit was exceeded. Configure NEXT_PUBLIC_ESSENTIA_API_BASE_URL and NEXT_PUBLIC_ESSENTIA_API_KEY for direct uploads, or try a smaller/compressed file.";
    }

    return detail ?? "Essentia rejected the uploaded audio because the file is too large. Try a compressed MP3/M4A or a shorter excerpt.";
  }

  const normalizedStatusText = statusText?.trim();
  return detail ?? normalizedStatusText ?? `Analysis failed with ${status}`;
}

async function readResponsePayload(response: Response) {
  const text = await response.text();
  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function extractWaveformData(file: File, sampleCount = 1200) {
  const buffer = await file.arrayBuffer();
  const context = new AudioContext();

  try {
    const decoded = await context.decodeAudioData(buffer.slice(0));
    const channelCount = decoded.numberOfChannels || 1;
    const channelData = Array.from({ length: channelCount }, (_, index) => decoded.getChannelData(index));
    const blockSize = Math.max(1, Math.floor(decoded.length / sampleCount));

    const peaks = Array.from({ length: sampleCount }, (_, blockIndex) => {
      const start = blockIndex * blockSize;
      const end = Math.min(decoded.length, start + blockSize);
      let peak = 0;

      for (let frame = start; frame < end; frame += 1) {
        let mixed = 0;
        for (const channel of channelData) mixed += Math.abs(channel[frame] ?? 0);
        peak = Math.max(peak, mixed / channelCount);
      }

      return clamp(peak, 0, 1);
    });
    const peakMax = Math.max(...peaks, 0.0001);

    const waveformData = {
      duration: decoded.duration,
      waveform: peaks.map((peak) => clamp(Math.pow(peak / peakMax, 0.72), 0, 1)),
    };

    console.info("[Essentia] Waveform decoded", {
      fileName: file.name,
      decodedDuration: waveformData.duration,
      waveformPoints: waveformData.waveform.length,
    });

    return waveformData;
  } finally {
    void context.close();
  }
}

export function parseEssentiaPayload(params: {
  payload: unknown;
  fileName: string;
  waveform: number[];
  waveformDuration: number;
  audioUrl: string;
}) {
  const { payload, fileName, waveform, waveformDuration, audioUrl } = params;
  if (!payload || typeof payload !== "object") return null;

  const source = payload as Record<string, unknown>;
  const energy = normalizeSeries(findValue(source, [["energy"], ["energy", "curve"], ["analysis", "energy"], ["analysis", "energy", "curve"]]));
  const beats = normalizeTimes(findValue(source, [["beats"], ["analysis", "beats"]]));
  const onsets = normalizeTimes(findValue(source, [["onsets"], ["analysis", "onsets"]]));
  const rawSections = findValue(source, [["sections"], ["structure", "sections"], ["analysis", "sections"], ["analysis", "structure", "sections"]]);
  const analysisDuration =
    getNumericValue(source.duration) ??
    getNumericValue(findValue(source, [["analysis", "duration"]])) ??
    lastValue(onsets) ??
    lastValue(beats) ??
    getLastSectionEnd(rawSections);
  const duration = Math.max(analysisDuration, waveformDuration, 0);
  const sections = normalizeSections(rawSections, duration);

  if (!duration || (!energy.length && !beats.length && !onsets.length && !sections.length && !waveform.length)) return null;

  const parsedAnalysis = {
    sourceLabel: fileName,
    audioUrl,
    waveform: waveform.length ? waveform : energy,
    energy,
    beats,
    onsets,
    sections: sections.length ? sections : DEFAULT_EMPTY_SECTIONS.map((section) => ({ ...section, end: duration })),
    duration,
  } satisfies BeatJoinAnalysis;

  console.info("[Essentia] Parsed analysis", {
    sourceLabel: parsedAnalysis.sourceLabel,
    duration: parsedAnalysis.duration,
    waveformPoints: parsedAnalysis.waveform.length,
    energyPoints: parsedAnalysis.energy.length,
    beats: parsedAnalysis.beats,
    onsets: parsedAnalysis.onsets,
    sections: parsedAnalysis.sections,
  });

  return parsedAnalysis;
}

function normalizeSeries(value: unknown) {
  if (!Array.isArray(value)) return [];

  const numbers = value
    .map((entry) => (typeof entry === "number" ? entry : Number(entry)))
    .filter((entry) => Number.isFinite(entry));

  if (!numbers.length) return [];

  const maxValue = Math.max(...numbers);
  const scale = maxValue > 1 ? maxValue : 1;
  return numbers.map((entry) => clamp(entry / scale, 0, 1));
}

function normalizeTimes(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => (typeof entry === "number" ? entry : Number(entry)))
    .filter((entry) => Number.isFinite(entry) && entry >= 0)
    .sort((left, right) => left - right);
}

function normalizeSections(value: unknown, duration: number): BeatJoinSection[] {
  const items = Array.isArray(value) ? value : [];
  if (!items.length || duration <= 0) return [];

  const sections: BeatJoinSection[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const section = item as Record<string, unknown>;
    const start = getNumericValue(section.start);
    const end = getNumericValue(section.end);
    if (start === null || end === null || end <= start) continue;

    sections.push({
      label: String(section.label ?? section.name ?? "Section"),
      start: clamp(start, 0, duration),
      end: clamp(end, 0, duration),
      energy: getNumericValue(section.energy) ?? undefined,
    });
  }

  return sections.sort((left, right) => left.start - right.start);
}

function findValue(source: Record<string, unknown>, paths: string[][]) {
  for (const path of paths) {
    let current: unknown = source;
    for (const key of path) {
      if (!current || typeof current !== "object") {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[key];
    }
    if (current !== undefined) return current;
  }
  return undefined;
}

function getNumericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function getLastSectionEnd(value: unknown) {
  if (!Array.isArray(value) || !value.length) return 0;
  const ends = value
    .map((entry) => (entry && typeof entry === "object" ? getNumericValue((entry as Record<string, unknown>).end) : null))
    .filter((entry): entry is number => entry !== null);
  return ends.length ? Math.max(...ends) : 0;
}

function extractErrorText(payload: unknown) {
  if (typeof payload === "string" && payload.trim()) return payload.trim();
  if (!payload || typeof payload !== "object") return null;

  if ("error" in payload && typeof payload.error === "string" && payload.error.trim()) {
    return payload.error.trim();
  }

  if ("detail" in payload && typeof payload.detail === "string" && payload.detail.trim()) {
    return payload.detail.trim();
  }

  return null;
}

function lastValue(values: number[]) {
  return values.length ? values[values.length - 1] ?? 0 : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getArrayLength(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
