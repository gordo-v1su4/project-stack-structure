import { Mp3Encoder } from "lamejs";

/**
 * Vocal stems are only a transcription reference for Deepgram — the original
 * WAV always stays untouched for the final export. Vercel caps serverless
 * request bodies at ~4.5MB, so large stems are downmixed to mono and encoded
 * to MP3 in the browser before upload; ASR quality at 128kbps mono is more
 * than sufficient, and the payload shrinks ~20x.
 */
export async function transcodeWavToMp3ForTranscription(
  file: File,
  options: { onStatus?: (status: string) => void; kbps?: number } = {},
): Promise<File> {
  const kbps = options.kbps ?? 128;
  options.onStatus?.("Decoding audio for transcription copy…");
  const arrayBuffer = await file.arrayBuffer();
  const context = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(arrayBuffer);
  } finally {
    void context.close();
  }

  options.onStatus?.("Encoding MP3 transcription copy…");
  const channels = Math.min(decoded.numberOfChannels, 2);
  const left = decoded.getChannelData(0);
  const right = channels > 1 ? decoded.getChannelData(1) : null;
  const encoder = new Mp3Encoder(channels, decoded.sampleRate, kbps);
  const blockSize = 1152 * 100;
  const encoded: Uint8Array[] = [];

  for (let offset = 0; offset < left.length; offset += blockSize) {
    const end = Math.min(offset + blockSize, left.length);
    const l = floatTo16(left.subarray(offset, end));
    const r = right ? floatTo16(right.subarray(offset, end)) : undefined;
    const chunk = r
      ? encoder.encodeBuffer(l, r)
      : encoder.encodeBuffer(l);
    if (chunk.length) encoded.push(new Uint8Array(chunk));
  }
  const tail = encoder.flush();
  if (tail.length) encoded.push(new Uint8Array(tail));

  const mp3Name = `${file.name.replace(/\.[^.]+$/, "")}.transcription.mp3`;
  return new File(encoded as BlobPart[], mp3Name, { type: "audio/mpeg" });
}

function floatTo16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]!));
    out[index] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out;
}
