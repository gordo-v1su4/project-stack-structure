export const SEEDANCE_AUDIO_HANDLE_SECONDS = 2;

export type SeedanceAudioReferenceWindow = {
  clipStart: number;
  clipEnd: number;
  duration: number;
  handleBefore: number;
  handleAfter: number;
  sectionStartOffset: number;
  sectionEndOffset: number;
};

export type SeedanceMediaProbeSummary = {
  duration: number;
  size: number;
  hasAudio: boolean;
  hasVideo: boolean;
};

const MIN_SOURCE_BYTES = 4_096;
const MIN_VIDEO_REFERENCE_BYTES = 16_384;
const DURATION_TOLERANCE_SECONDS = 0.25;

export function validateSeedanceAudioSource(
  probe: SeedanceMediaProbeSummary,
  window: Pick<SeedanceAudioReferenceWindow, "clipEnd">,
) {
  if (!probe.hasAudio) {
    throw new Error("The selected master-audio object does not contain an audio stream. Replace it with the real song file before preparing Video_1.");
  }
  if (!Number.isFinite(probe.duration) || probe.duration + DURATION_TOLERANCE_SECONDS < window.clipEnd) {
    throw new Error("The selected master-audio object does not cover the requested song placement.");
  }
  if (!Number.isFinite(probe.size) || probe.size < MIN_SOURCE_BYTES) {
    throw new Error("The selected master-audio object is empty or truncated.");
  }
}

export function validateSeedanceVideoReference(
  probe: SeedanceMediaProbeSummary,
  window: Pick<SeedanceAudioReferenceWindow, "duration">,
) {
  if (!probe.hasVideo || !probe.hasAudio) {
    throw new Error("Video_1 must contain both a black video stream and the selected song audio stream.");
  }
  if (!Number.isFinite(probe.duration) || probe.duration + DURATION_TOLERANCE_SECONDS < window.duration) {
    throw new Error("Video_1 is shorter than the requested song window and handles.");
  }
  if (!Number.isFinite(probe.size) || probe.size < MIN_VIDEO_REFERENCE_BYTES) {
    throw new Error("Video_1 is empty or truncated.");
  }
}

export function resolveSeedanceAudioReferenceWindow(params: {
  songStart: number;
  songEnd: number;
  songDuration: number;
  handleSeconds?: number;
}): SeedanceAudioReferenceWindow {
  const { songStart, songEnd, songDuration } = params;
  const handleSeconds = params.handleSeconds ?? SEEDANCE_AUDIO_HANDLE_SECONDS;
  if (![songStart, songEnd, songDuration, handleSeconds].every(Number.isFinite)) {
    throw new Error("Seedance audio timing values must be finite numbers.");
  }
  if (songDuration <= 0) throw new Error("The master song duration must be greater than zero.");
  if (songStart < 0 || songEnd <= songStart || songEnd > songDuration) {
    throw new Error("The selected Seedance section must be inside the master song.");
  }
  if (handleSeconds < 0 || handleSeconds > 10) {
    throw new Error("Seedance audio handles must be between zero and ten seconds.");
  }

  const clipStart = roundTime(Math.max(0, songStart - handleSeconds));
  const clipEnd = roundTime(Math.min(songDuration, songEnd + handleSeconds));
  const handleBefore = roundTime(songStart - clipStart);
  const handleAfter = roundTime(clipEnd - songEnd);
  return {
    clipStart,
    clipEnd,
    duration: roundTime(clipEnd - clipStart),
    handleBefore,
    handleAfter,
    sectionStartOffset: handleBefore,
    sectionEndOffset: roundTime(handleBefore + songEnd - songStart),
  };
}

export function buildSeedanceAudioPlacementKey(params: {
  audioObjectKey: string;
  songStart: number;
  songEnd: number;
  songDuration: number;
  handleSeconds?: number;
}) {
  const handleSeconds = params.handleSeconds ?? SEEDANCE_AUDIO_HANDLE_SECONDS;
  return [
    params.audioObjectKey.trim(),
    roundTime(params.songStart).toFixed(3),
    roundTime(params.songEnd).toFixed(3),
    roundTime(params.songDuration).toFixed(3),
    roundTime(handleSeconds).toFixed(3),
  ].join(":");
}

function roundTime(value: number) {
  return Math.round(value * 1_000) / 1_000;
}
