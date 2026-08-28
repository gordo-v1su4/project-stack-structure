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
