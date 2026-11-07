import { expect, test } from "bun:test";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { nativePngFrameSha256 } from "@/lib/nativeFirstFrameSource";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("decoded pixel hashing matches OpenCV shape-prefix and BGR channel order exactly", async () => {
  const rgb = Buffer.alloc(1344 * 768 * 3), bgr = Buffer.alloc(rgb.length);
  for (let i = 0; i < rgb.length; i += 3) { rgb[i] = i % 251; rgb[i + 1] = (i + 71) % 253; rgb[i + 2] = (i + 139) % 255;
    bgr[i] = rgb[i + 2]; bgr[i + 1] = rgb[i + 1]; bgr[i + 2] = rgb[i]; }
  const png = await sharp(rgb, { raw: { width: 1344, height: 768, channels: 3 } }).png().toBuffer();
  const expected = createHash("sha256").update("(768, 1344, 3)").update(bgr).digest("hex");
  expect(await nativePngFrameSha256(png, hash(png))).toBe(expected);
  rgb[0] ^= 1;
  const changed = await sharp(rgb, { raw: { width: 1344, height: 768, channels: 3 } }).png().toBuffer();
  expect(await nativePngFrameSha256(changed, hash(changed))).not.toBe(expected);
  await expect(nativePngFrameSha256(png, hash(changed))).rejects.toThrow();
});
test("wrong shape, transparent or truncated PNGs cannot produce a source proof", async () => {
  for (const png of [await sharp({ create: { width: 1343, height: 768, channels: 3, background: "black" } }).png().toBuffer(),
    await sharp({ create: { width: 1344, height: 768, channels: 3, background: "black" } }).withIccProfile("p3").png().toBuffer(),
    await sharp({ create: { width: 1344, height: 768, channels: 4, background: { r: 0, g: 0, b: 0, alpha: .5 } } }).png().toBuffer(), Buffer.from("truncated")]) {
    await expect(nativePngFrameSha256(png, hash(png))).rejects.toThrow();
  }
});
