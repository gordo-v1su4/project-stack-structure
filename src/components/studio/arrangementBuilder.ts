import { lerp, sv } from "./math";
import type { BeatJoinAnalysis } from "./types";

export interface ArrangementSegment {
  id: number;
  clipId: number;
  start: number;
  end: number;
  duration: number;
  energy: number;
  detailLabel: string;
  tone: "low" | "mid" | "high";
}

interface CutCandidate {
  time: number;
  energy: number;
  amplitude: number;
  strength: number;
  source: "beat" | "onset" | "fft" | "section";
}

export function buildArrangementSegments(params: {
  analysis: BeatJoinAnalysis;
  clipOrder: number[];
  minDur: number;
  maxDur: number;
  energyResp: number;
  energyReactive: boolean;
  lowEnergyRange: number;
  highEnergyRange: number;
  onsetBoost: number;
  chaos: number;
}): ArrangementSegment[] {
  const {
    analysis,
    clipOrder,
    minDur,
    maxDur,
    energyResp,
    energyReactive,
    lowEnergyRange,
    highEnergyRange,
    onsetBoost,
    chaos,
  } = params;

  const duration = Math.max(analysis.duration, 0.001);
  const beatTimes = uniqueSortedTimes(analysis.beats, duration);
  const rawOnsets = uniqueSortedTimes(analysis.onsets, duration);
  const beatInterval = medianInterval(beatTimes) || Math.max(0.18, duration / 32);
  const fftRiseMarkers = buildOfflineFftMarkers(analysis.energy, duration);
  const waveform = analysis.waveform.length ? analysis.waveform : analysis.energy;
  const onsets = rawOnsets.filter(
    (time) => !beatTimes.some((beat) => Math.abs(beat - time) < Math.max(beatInterval * 0.12, 0.04))
  );

  const candidates: CutCandidate[] = [
    ...beatTimes.map((time) => createCandidate("beat", time, analysis.energy, waveform, duration, 0.86)),
    ...onsets.map((time) => createCandidate("onset", time, analysis.energy, waveform, duration, 1 + onsetBoost * 0.25)),
    ...fftRiseMarkers.map((time) => createCandidate("fft", time, analysis.energy, waveform, duration, 0.94)),
    ...analysis.sections
      .slice(1)
      .map((section) => createCandidate("section", clamp(section.start, 0, duration), analysis.energy, waveform, duration, 1.2)),
  ]
    .sort((left, right) => left.time - right.time)
    .filter((candidate, index, all) => index === 0 || Math.abs(candidate.time - all[index - 1].time) > 0.015);

  const acceptedCuts = [0];
  let lastCut = 0;

  for (const candidate of candidates) {
    if (candidate.time <= 0.02 || candidate.time >= duration - 0.02) continue;

    const normalized = energyReactive
      ? clamp((candidate.energy - lowEnergyRange) / Math.max(0.001, highEnergyRange - lowEnergyRange), 0, 1)
      : 0.5;
    const response = energyReactive ? clamp(Math.pow(normalized, 1 / Math.max(0.5, energyResp)), 0, 1) : 0.5;
    const lowZone = energyReactive && candidate.energy < lowEnergyRange;
    const highZone = energyReactive && candidate.energy >= highEnergyRange;
    const variation = lerp(0.88, 1.12, sv(candidate.time * 7.1 + chaos * 11.3));

    if (lowZone && candidate.source !== "beat" && candidate.source !== "section") continue;
    if (!highZone && candidate.source === "fft" && normalized < 0.46) continue;

    const dynamicMinSpacing = lowZone
      ? Math.max(maxDur * 0.92, beatInterval * 1.05)
      : highZone
        ? Math.max(minDur * 0.5, beatInterval * lerp(0.42, 0.18, Math.min(1, response + onsetBoost * 0.28)))
        : Math.max(minDur * 0.8, Math.min(maxDur * 0.94, beatInterval * lerp(0.9, 0.58, response)));

    if (candidate.time - lastCut < dynamicMinSpacing * variation) continue;

    const sourceLift =
      candidate.source === "section" ? 0.55 : candidate.source === "onset" ? 0.26 : candidate.source === "fft" ? 0.21 : 0.12;
    const keepScore =
      candidate.strength +
      candidate.amplitude * 0.85 +
      response * 0.65 +
      sourceLift +
      (chaos - 0.5) * (sv(candidate.time * 3.9) - 0.5) * 0.3;
    const required = candidate.source === "section" ? 0 : lowZone ? 1.38 : highZone ? 1.02 : 1.18;

    if (keepScore < required) continue;

    acceptedCuts.push(candidate.time);
    lastCut = candidate.time;
  }

  const cutTimes = acceptedCuts
    .concat(duration)
    .sort((left, right) => left - right)
    .filter((time, index, all) => index === 0 || time - all[index - 1] > 0.03);
  const sequence = clipOrder.length ? clipOrder : [0];

  return cutTimes.slice(0, -1).map((start, index) => {
    const end = cutTimes[index + 1] ?? duration;
    const segmentDuration = Math.max(0.03, end - start);
    const averageEnergy = averageEnergyBetween(analysis.energy, duration, start, end);
    const tone = classifyEnergyTone(averageEnergy, lowEnergyRange, highEnergyRange, energyReactive);
    const clipId = sequence[index % sequence.length] ?? 0;

    return {
      id: index,
      clipId,
      start,
      end,
      duration: segmentDuration,
      energy: averageEnergy,
      detailLabel: `C${String(clipId + 1).padStart(2, "0")} · ${tone === "high" ? "RUSH" : tone === "mid" ? "CUT" : "HOLD"}`,
      tone,
    };
  });
}

export function classifyEnergyTone(
  energy: number,
  lowEnergyRange: number,
  highEnergyRange: number,
  energyReactive: boolean
): ArrangementSegment["tone"] {
  if (!energyReactive) return "mid";
  if (energy < lowEnergyRange) return "low";
  if (energy >= highEnergyRange) return "high";
  return "mid";
}

export function abbreviateSectionLabel(label: string) {
  const normalized = label.trim().toLowerCase();
  if (!normalized) return "S";
  if (normalized.startsWith("intro")) return "I";
  if (normalized.startsWith("verse")) {
    const match = normalized.match(/\d+/);
    return match ? `V${match[0]}` : "V";
  }
  if (normalized.startsWith("chorus")) return "Ch";
  if (normalized.startsWith("bridge")) return "Br";
  if (normalized.startsWith("outro")) return "O";
  if (normalized.startsWith("drop")) return "Dr";
  return label.slice(0, 3);
}

export function getSegmentColor(segment: ArrangementSegment, shuffleMode: string) {
  const clipSeed = sv((segment.clipId + 1) * 7.13 + segment.start * 0.37);
  const modeBoost = shuffleMode === "motion" ? 1 : shuffleMode === "color" ? 0.82 : shuffleMode === "size" ? 0.72 : 0.64;
  const alpha = lerp(0.14, 0.32, clipSeed * modeBoost);

  if (segment.tone === "low") {
    return `linear-gradient(180deg, rgba(34, 34, 34, ${0.78 + alpha * 0.3}) 0%, rgba(14, 14, 14, 0.96) 100%)`;
  }

  if (segment.tone === "high") {
    return `linear-gradient(180deg, rgba(235, 116, 18, ${0.78 + alpha}) 0%, rgba(122, 48, 0, 0.96) 100%)`;
  }

  return `linear-gradient(180deg, rgba(126, 65, 16, ${0.72 + alpha * 0.7}) 0%, rgba(48, 25, 10, 0.96) 100%)`;
}

function createCandidate(
  source: CutCandidate["source"],
  time: number,
  energy: number[],
  waveform: number[],
  duration: number,
  strength: number
): CutCandidate {
  return {
    time,
    energy: energyAtTime(energy, duration, time),
    amplitude: amplitudeAtTime(waveform, duration, time),
    strength,
    source,
  };
}

function buildOfflineFftMarkers(energy: number[], duration: number) {
  if (!energy.length || duration <= 0) return [];

  const markers: number[] = [];
  let previous = energy[0] ?? 0;
  let cooldown = 0;

  for (let index = 1; index < energy.length; index += 1) {
    const current = energy[index] ?? 0;
    const diff = current - previous;
    previous = current;

    if (cooldown > 0) {
      cooldown -= 1;
      continue;
    }

    const historyStart = Math.max(0, index - 6);
    const history = energy.slice(historyStart, index);
    const localMean = history.reduce((sum, value) => sum + value, 0) / Math.max(1, history.length);

    if (diff > 0.08 && current > Math.max(0.12, localMean + 0.05)) {
      markers.push((index / Math.max(energy.length - 1, 1)) * duration);
      cooldown = 2;
    }
  }

  return markers;
}

function amplitudeAtTime(waveform: number[], duration: number, time: number) {
  if (!waveform.length || duration <= 0) return 0;
  const index = clamp(Math.floor((time / duration) * (waveform.length - 1)), 0, waveform.length - 1);
  return clamp(waveform[index] ?? 0, 0, 1);
}

function energyAtTime(energy: number[], duration: number, time: number) {
  if (!energy.length || duration <= 0) return 0;
  const index = clamp(Math.floor((time / duration) * (energy.length - 1)), 0, energy.length - 1);
  return clamp(energy[index] ?? 0, 0, 1);
}

function averageEnergyBetween(energy: number[], duration: number, start: number, end: number) {
  if (!energy.length || duration <= 0) return 0;

  const startIndex = clamp(Math.floor((start / duration) * (energy.length - 1)), 0, energy.length - 1);
  const endIndex = clamp(Math.max(startIndex + 1, Math.ceil((end / duration) * (energy.length - 1))), 0, energy.length);
  const slice = energy.slice(startIndex, endIndex);
  return slice.reduce((sum, value) => sum + value, 0) / Math.max(1, slice.length);
}

function uniqueSortedTimes(values: number[], duration: number) {
  return values
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= duration)
    .sort((left, right) => left - right)
    .filter((time, index, all) => index === 0 || Math.abs(time - all[index - 1]) > 0.015);
}

function medianInterval(values: number[]) {
  if (values.length < 2) return null;

  const intervals = values
    .slice(1)
    .map((time, index) => time - values[index])
    .filter((interval) => interval > 0.02);

  if (!intervals.length) return null;
  const sorted = [...intervals].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
