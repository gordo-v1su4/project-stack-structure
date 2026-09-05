import sharp from "sharp";

// Decode metadata only. This path must never resize, edit, sharpen or upscale.
export async function verifyStandalone2kImage(file: File) {
  const metadata = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 40_000_000 }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width < 2000 || height < 1000 || Math.abs(width / height - 16 / 9) > 0.08) {
    throw new Error(`Returned image is ${width}×${height}, not a full 2K 16:9 image. Keep the result for review; do not upscale or automatically generate again.`);
  }
  return { width, height };
}
