/**
 * Byte-level PCM WAV slicing — no decoder needed. Used to re-transcribe the
 * uncovered tail of a song: ASR models drop sung content deep into a long
 * file, but transcribe the same audio fine when it arrives as its own clip.
 */
export function sliceWavFromSeconds(bytes: Uint8Array, startSeconds: number): Uint8Array | null {
  if (bytes.length < 44 || startSeconds <= 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const readTag = (offset: number) =>
    String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);

  if (readTag(0) !== "RIFF" || readTag(8) !== "WAVE") return null;

  let offset = 12;
  let byteRate = 0;
  let blockAlign = 0;
  let audioFormat = 0;

  while (offset + 8 <= bytes.length) {
    const tag = readTag(offset);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;

    if (tag === "fmt " && chunkStart + 16 <= bytes.length) {
      audioFormat = view.getUint16(chunkStart, true);
      byteRate = view.getUint32(chunkStart + 8, true);
      blockAlign = view.getUint16(chunkStart + 12, true);
    } else if (tag === "data") {
      // 1 = integer PCM, 3 = IEEE float, 0xFFFE = extensible (usually PCM).
      if (!byteRate || !blockAlign || ![1, 3, 0xfffe].includes(audioFormat)) return null;
      const dataSize = Math.min(chunkSize, bytes.length - chunkStart);
      let sliceOffset = Math.floor(startSeconds * byteRate);
      sliceOffset -= sliceOffset % blockAlign;
      if (sliceOffset <= 0 || sliceOffset >= dataSize) return null;

      const newDataSize = dataSize - sliceOffset;
      const out = new Uint8Array(chunkStart + newDataSize);
      out.set(bytes.subarray(0, chunkStart), 0);
      out.set(bytes.subarray(chunkStart + sliceOffset, chunkStart + sliceOffset + newDataSize), chunkStart);

      const outView = new DataView(out.buffer);
      outView.setUint32(4, out.length - 8, true);
      outView.setUint32(chunkStart - 4, newDataSize, true);
      return out;
    }

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  return null;
}
