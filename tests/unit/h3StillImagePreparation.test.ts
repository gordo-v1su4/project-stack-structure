import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { prepareH3StillImage } from "@/lib/h3StillImagePreparation";
import { h3StillDigest, h3StillNativePreparation } from "@/lib/h3StillProfile";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function fixture() {
  const pixels = Buffer.alloc(2048 * 1152 * 3);
  for (let y = 0; y < 1152; y++) for (let x = 0; x < 2048; x++) {
    const i = (y * 2048 + x) * 3;
    const color = y < 576 ? x < 1024 ? [255, 0, 0] : [0, 255, 0] : x < 1024 ? [0, 0, 255] : [255, 255, 0];
    if (x < 64 || x >= 1984 || y < 64 || y >= 1088) pixels.set([255, 0, 255], i);
    else pixels.set(color, i);
  }
  return sharp(pixels, { raw: { width: 2048, height: 1152, channels: 3 } }).png().toBuffer();
}

describe("actual local H3 still native preparation", () => {
  test("preserves master bytes and all edges, adds exact black rows, and binds deterministic actual pixels", async () => {
    const master = await fixture(), original = Buffer.from(master);
    const result = await prepareH3StillImage(master, sha(master));
    const repeated = await prepareH3StillImage(master, sha(master));
    expect(master.equals(original)).toBe(true);
    expect(result.master.bytes.equals(original)).toBe(true);
    expect(result.master.pngSha256).toBe(sha(original));
    expect(result.native.bytes.equals(repeated.native.bytes)).toBe(true);
    expect(result.preparation).toEqual(repeated.preparation);
    expect(result.preparation.body.contractSha256).toBe(h3StillNativePreparation(sha(master)).sha256);
    expect(result.preparation.sha256).toBe(h3StillDigest(result.preparation.body));
    const { data, info } = await sharp(result.native.bytes).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height, info.channels]).toEqual([1344, 768, 3]);
    const pixel = (x: number, y: number) => [...data.subarray((y * 1344 + x) * 3, (y * 1344 + x) * 3 + 3)];
    for (const y of [0, 1, 5, 762, 766, 767]) expect(data.subarray(y * 1344 * 3, (y + 1) * 1344 * 3).every(value => value === 0)).toBe(true);
    // The master perimeter survives on all sides; the derivative never crops it away.
    for (const [x, y] of [[0, 6], [1343, 6], [0, 761], [1343, 761], [672, 6], [672, 761], [0, 384], [1343, 384]]) expect(pixel(x, y)).toEqual([255, 0, 255]);
    expect(pixel(300, 200)).toEqual([255, 0, 0]); expect(pixel(1000, 200)).toEqual([0, 255, 0]);
    expect(pixel(300, 600)).toEqual([0, 0, 255]); expect(pixel(1000, 600)).toEqual([255, 255, 0]);
    const bgr = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i += 3) { bgr[i] = data[i + 2]; bgr[i + 1] = data[i + 1]; bgr[i + 2] = data[i]; }
    expect(result.native.pngSha256).toBe(sha(result.native.bytes));
    expect(result.native.decodedPixelSha256).toBe(sha(bgr));
    expect(result.native.nativeFrameSha256).toBe(createHash("sha256").update("(768, 1344, 3)").update(bgr).digest("hex"));
    const { nativePngFrameSha256 } = await import("@/lib/nativeFirstFrameSource");
    expect(await nativePngFrameSha256(result.native.bytes, result.native.pngSha256)).toBe(result.native.nativeFrameSha256);
  });

  test("rejects wrong bytes, dimensions, animated/trailing PNG, transparency and excessive bounds", async () => {
    const master = await fixture();
    await expect(prepareH3StillImage(master, "a".repeat(64))).rejects.toThrow("Master PNG bytes changed");
    const wrong = await sharp({ create: { width: 2048, height: 1151, channels: 3, background: "red" } }).png().toBuffer();
    await expect(prepareH3StillImage(wrong, sha(wrong))).rejects.toThrow("exact dimensions");
    const trailing = Buffer.concat([master, Buffer.from([0])]);
    await expect(prepareH3StillImage(trailing, sha(trailing))).rejects.toThrow("trailing data");
    const animated = Buffer.from(master); animated.write("acTL", 12, "ascii");
    await expect(prepareH3StillImage(animated, sha(animated))).rejects.toThrow();
    const transparent = await sharp({ create: { width: 2048, height: 1152, channels: 4, background: { r: 1, g: 2, b: 3, alpha: .5 } } }).png().toBuffer();
    await expect(prepareH3StillImage(transparent, sha(transparent))).rejects.toThrow("rejected the master");
    await expect(prepareH3StillImage(Buffer.alloc(32 * 1024 * 1024 + 1), "a".repeat(64))).rejects.toThrow("Invalid");
    for (const timeoutMs of [0, -1, 60_001, NaN]) await expect(prepareH3StillImage(master, sha(master), { timeoutMs })).rejects.toThrow("Invalid");
  });

  test("wall deadline kills and reaps the worker before returning a failure", async () => {
    const master = await fixture(), started = Date.now();
    await expect(prepareH3StillImage(master, sha(master), { timeoutMs: 1 })).rejects.toThrow("wall deadline");
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
