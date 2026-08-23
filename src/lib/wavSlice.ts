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

/**
 * Merges byte-split WAV parts back into one valid RIFF stream. Chunked uploads
 * cut the file at arbitrary offsets, so every part after the first carries a
 * stale header; only the first header is kept and the data sizes are summed.
 * Returns null when the parts are not PCM WAV (callers fall back to raw
 * concatenation for opaque formats).
 */
export function concatWavChunks(parts: Uint8Array[]): Uint8Array | null {
  if (!parts.length) return null;

  const first = parts[0]!;
  if (first.length < 44) return null;
  const firstView = new DataView(first.buffer, first.byteOffset, first.byteLength);
  const readTag = (source: Uint8Array, offset: number) =>
    String.fromCharCode(source[offset]!, source[offset + 1]!, source[offset + 2]!, source[offset + 3]!);

  if (readTag(first, 0) !== "RIFF" || readTag(first, 8) !== "WAVE") return null;

  let headerSize = 0;
  let dataSize = 0;
  let dataHeaderOffset = -1;
  {
    let offset = 12;
    while (offset + 8 <= first.length) {
      const tag = readTag(first, offset);
      const chunkSize = firstView.getUint32(offset + 4, true);
      const chunkStart = offset + 8;
      if (tag === "data") {
        headerSize = chunkStart;
        dataHeaderOffset = offset;
        dataSize = chunkSize;
        break;
      }
      offset = chunkStart + chunkSize + (chunkSize % 2);
    }
  }
  if (dataHeaderOffset < 0 || headerSize <= 0) return null;

  const firstDataSize = Math.min(dataSize, first.length - headerSize);
  let totalData = firstDataSize;
  for (let partIndex = 1; partIndex < parts.length; partIndex += 1) {
    const part = parts[partIndex]!;
    const partView = new DataView(part.buffer, part.byteOffset, part.byteLength);
    let offset = 12;
    let partData = 0;
    let matched = false;
    while (offset + 8 <= part.length) {
      const tag = readTag(part, offset);
      const chunkSize = partView.getUint32(offset + 4, true);
      const chunkStart = offset + 8;
      if (tag === "data") {
        partData = Math.min(chunkSize, part.length - chunkStart);
        matched = true;
        break;
      }
      offset = chunkStart + chunkSize + (chunkSize % 2);
    }
    if (!matched) return null;
    totalData += partData;
  }

  const out = new Uint8Array(headerSize + totalData);
  out.set(first.subarray(0, headerSize), 0);
  out.set(first.subarray(headerSize, headerSize + firstDataSize), headerSize);
  let cursor = headerSize + firstDataSize;
  for (let partIndex = 1; partIndex < parts.length; partIndex += 1) {
    const part = parts[partIndex]!;
    const partView = new DataView(part.buffer, part.byteOffset, part.byteLength);
    let offset = 12;
    while (offset + 8 <= part.length) {
      const tag = readTag(part, offset);
      const chunkSize = partView.getUint32(offset + 4, true);
      const chunkStart = offset + 8;
      if (tag === "data") {
        const partData = Math.min(chunkSize, part.length - chunkStart);
        out.set(part.subarray(chunkStart, chunkStart + partData), cursor);
        cursor += partData;
        break;
      }
      offset = chunkStart + chunkSize + (chunkSize % 2);
    }
  }

  const outView = new DataView(out.buffer);
  outView.setUint32(4, out.length - 8, true);
  outView.setUint32(dataHeaderOffset + 4, totalData, true);
  return out;
}
