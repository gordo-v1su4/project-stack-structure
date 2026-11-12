import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { prepareReviewVideo } from "@/lib/prepareReviewVideo";

const execute = promisify(execFile);
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg", ffprobe = process.env.FFPROBE_PATH || "ffprobe";
const run = (program: string, args: string[]) => execute(program, args, { timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true });
const available = await Promise.all([ffmpeg, ffprobe].map(program => run(program, ["-version"]).then(() => true, () => false)));
const mediaTest = available.every(Boolean) ? test : test.skip;
const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");

async function workspace(work: (folder: string) => Promise<void>) {
  const root = resolve(".tmp/review-video-tests");
  await mkdir(root, { recursive: true });
  const folder = await mkdtemp(join(root, "run-"));
  try { await work(folder); }
  finally {
    if (!resolve(folder).startsWith(root + sep)) throw new Error("Test cleanup escaped its workspace.");
    await rm(folder, { recursive: true, force: true });
  }
}
async function frameTimes(file: string) {
  const { stdout } = await run(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_frames", "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", file]);
  return (JSON.parse(String(stdout)).frames as Array<{ best_effort_timestamp_time: string }>).map(frame => Number(frame.best_effort_timestamp_time));
}

mediaTest("review derivatives preserve VFR frame timing, strip audio and leave the source unchanged", async () => workspace(async folder => {
  const source = join(folder, "source.mp4"), proxy = join(folder, "checked.mp4"), scratch = join(folder, "scratch");
  await run(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24:duration=2",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-vf", "select='not(mod(n,3))+not(mod(n,5))',setpts=PTS+0.25/TB",
    "-fps_mode", "vfr", "-c:v", "libx264", "-threads", "2", "-c:a", "aac", source]);
  const original = await readFile(source), expectedSha256 = sha(original);
  const { metadata, bytes } = await prepareReviewVideo(source, { expectedSha256, tempRoot: scratch });
  await writeFile(proxy, bytes.proxy);
  const originalTimes = await frameTimes(source), proxyTimes = await frameTimes(proxy);
  expect(originalTimes.length).toBeGreaterThan(10);
  expect(new Set(originalTimes.slice(1).map((time, index) => (time - originalTimes[index]).toFixed(4))).size).toBeGreaterThan(1);
  expect(proxyTimes.length).toBe(originalTimes.length);
  for (let index = 0; index < originalTimes.length; index++) {
    expect(Math.abs(proxyTimes[index] + metadata.proxy.sourceTimeOffset - originalTimes[index])).toBeLessThan(0.0001);
  }
  const { stdout } = await run(ffprobe, ["-v", "error", "-show_streams", "-of", "json", proxy]);
  expect((JSON.parse(String(stdout)).streams as Array<{ codec_type: string }>).map(stream => stream.codec_type)).toEqual(["video"]);
  expect(metadata.source.sha256).toBe(expectedSha256);
  expect(metadata.proxy.frameCount).toBe(originalTimes.length);
  expect(metadata.sprite.times[0]).toBe(metadata.source.startTime);
  expect(metadata.sprite.times[31]).toBeLessThan(metadata.source.startTime + metadata.source.duration);
  expect(metadata.sprite.times).toHaveLength(32);
  expect(metadata.proxy.sha256).toBe(sha(bytes.proxy));
  expect(metadata.poster.sha256).toBe(sha(bytes.poster));
  expect(metadata.sprite.sha256).toBe(sha(bytes.sprite));
  expect(await sharp(bytes.poster).metadata()).toMatchObject({ width: 320, height: 180, format: "webp" });
  expect(await sharp(bytes.sprite).metadata()).toMatchObject({ width: 1280, height: 360, format: "jpeg" });
  expect(sha(await readFile(source))).toBe(expectedSha256);
  expect(await readdir(scratch)).toEqual([]);
}), 60_000);

mediaTest("rotation is displayed upright inside a 16:9 frame without stretching", async () => workspace(async folder => {
  const landscape = join(folder, "landscape.mp4"), rotated = join(folder, "rotated.mp4");
  await run(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:size=320x180:rate=12:duration=1", "-c:v", "libx264", "-threads", "2", landscape]);
  await run(ffmpeg, ["-v", "error", "-y", "-display_rotation:v:0", "90", "-i", landscape, "-c", "copy", rotated]);
  const { metadata, bytes } = await prepareReviewVideo(rotated, { tempRoot: join(folder, "scratch") });
  expect([90, 270]).toContain(metadata.source.rotation);
  const { data, info } = await sharp(bytes.poster).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)];
  expect(Math.max(...pixel(5, 90))).toBeLessThan(12);
  expect(pixel(160, 90)[0]).toBeGreaterThan(200);
  expect(Math.max(...pixel(314, 90))).toBeLessThan(12);
}), 60_000);

mediaTest("mismatched hashes, cancellation and unsupported media do not leave temporary derivatives", async () => workspace(async folder => {
  const source = join(folder, "source.mp4"), scratch = join(folder, "scratch");
  await run(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=12:duration=1", "-c:v", "libx264", "-threads", "2", source]);
  await expect(prepareReviewVideo(source, { expectedSha256: "0".repeat(64), tempRoot: scratch })).rejects.toMatchObject({ code: "source-changed" });
  const controller = new AbortController();
  await expect(prepareReviewVideo(source, { tempRoot: scratch, signal: controller.signal, onStage: stage => { if (stage === "proxy") controller.abort(); } }))
    .rejects.toMatchObject({ code: "cancelled" });
  expect(await readdir(scratch)).toEqual([]);
  await expect(prepareReviewVideo(join(folder, "missing.mp4"), { signal: AbortSignal.abort(), tempRoot: scratch })).rejects.toMatchObject({ code: "cancelled" });
  const hdr = join(folder, "hdr.mp4");
  await run(ffmpeg, ["-v", "error", "-y", "-i", source, "-c", "copy", "-bsf:v", "h264_metadata=transfer_characteristics=16", hdr]);
  await expect(prepareReviewVideo(hdr, { tempRoot: scratch })).rejects.toMatchObject({ code: "unsupported" });
  expect(await readdir(scratch)).toEqual([]);
}), 60_000);
