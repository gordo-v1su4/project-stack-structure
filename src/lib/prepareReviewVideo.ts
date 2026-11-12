import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { REVIEW_VIDEO_RECIPE, type ReviewVideoMetadata } from "@/components/studio/reviewVideo";

const execute = promisify(execFile);
const MAX_SOURCE = 512 * 1024 * 1024, MAX_PROXY = 64 * 1024 * 1024;
const FORMATS = "mov,matroska,webm,avi,mpeg,mpegts";
const HASH = /^[a-f0-9]{64}$/;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type ProbeStream = { index?: number; codec_type?: string; codec_name?: string; width?: number; height?: number;
  duration?: string; start_time?: string; avg_frame_rate?: string; r_frame_rate?: string; sample_aspect_ratio?: string;
  nb_read_frames?: string; color_transfer?: string; disposition?: { attached_pic?: number }; side_data_list?: Array<{ rotation?: number }> };
type Probe = { streams?: ProbeStream[]; format?: { duration?: string; start_time?: string } };
type Options = { expectedSha256?: string; signal?: AbortSignal; tempRoot?: string;
  onStage?: (stage: "probe" | "proxy" | "poster" | "sprite" | "verify") => void };

export class ReviewVideoPreparationError extends Error {
  constructor(message: string, readonly code: "source-changed" | "unsupported" | "process-failed" | "cancelled") { super(message); }
}

const ratio = (value: string | undefined) => {
  if (!value) return 0;
  const parts = value.split(/[/:]/).map(Number);
  const result = parts.length === 2 ? parts[0] / parts[1] : parts[0];
  return Number.isFinite(result) && result > 0 ? result : 0;
};
function cancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new ReviewVideoPreparationError("Review media preparation was cancelled.", "cancelled");
}
async function run(program: "ffmpeg" | "ffprobe", args: string[], stage: string, signal?: AbortSignal) {
  cancelled(signal);
  try {
    const result = await execute(program === "ffmpeg" ? process.env.FFMPEG_PATH || program : process.env.FFPROBE_PATH || program, args,
      { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 90_000, windowsHide: true, signal });
    return result.stdout;
  } catch {
    cancelled(signal);
    throw new ReviewVideoPreparationError(`Review media preparation failed during ${stage}.`, "process-failed");
  }
}
async function probe(file: string, signal?: AbortSignal): Promise<Probe> {
  const text = await run("ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", FORMATS,
    "-threads", "2", "-count_frames", "-show_entries", "stream=index,codec_type,codec_name,width,height,duration,start_time,avg_frame_rate,r_frame_rate,sample_aspect_ratio,nb_read_frames,color_transfer:stream_disposition=attached_pic:stream_side_data=rotation:format=duration,start_time", "-of", "json", "-i", file], "probe", signal);
  try { return JSON.parse(text) as Probe; } catch { throw new ReviewVideoPreparationError("Review media probe returned invalid metadata.", "process-failed"); }
}
function videoInfo(value: Probe) {
  const stream = value.streams?.find(item => item.codec_type === "video" && !item.disposition?.attached_pic);
  const duration = Number(stream?.duration ?? value.format?.duration);
  const width = stream?.width ?? 0, height = stream?.height ?? 0;
  const frameCount = Number(stream?.nb_read_frames);
  const frameRate = ratio(stream?.avg_frame_rate) || ratio(stream?.r_frame_rate);
  const startTime = Number(stream?.start_time ?? value.format?.start_time ?? 0);
  const rotation = ((stream?.side_data_list?.find(item => item.rotation !== undefined)?.rotation ?? 0) % 360 + 360) % 360;
  const sampleAspect = ratio(stream?.sample_aspect_ratio) || 1;
  if (!stream || !Number.isSafeInteger(stream.index) || !Number.isFinite(duration) || duration <= 0 || duration > 600
    || width < 2 || height < 2 || width * height > 40_000_000 || width > 8192 || height > 8192
    || !Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > 72_000 || frameRate <= 0 || frameRate > 120
    || !Number.isFinite(startTime) || ![0, 90, 180, 270].includes(rotation) || sampleAspect > 100
    || ["smpte2084", "arib-std-b67"].includes(stream.color_transfer ?? "")) {
    throw new ReviewVideoPreparationError("This source is outside the supported review-proxy bounds; the original remains available.", "unsupported");
  }
  return { stream, duration, width, height, frameCount, frameRate, startTime, rotation, sampleAspect };
}
async function boundedFile(file: string, limit: number) {
  if ((await stat(file)).size > limit) throw new ReviewVideoPreparationError("Prepared review media exceeds its size limit.", "unsupported");
  const bytes = new Uint8Array(await readFile(file));
  if (!bytes.byteLength || bytes.byteLength > limit) throw new ReviewVideoPreparationError("Prepared review media has an invalid size.", "unsupported");
  return bytes;
}

/** Internal worker helper. Callers resolve authorized durable objects to a private local input first. */
export async function prepareReviewVideo(sourceFile: string, options: Options = {}) {
  cancelled(options.signal);
  const source = resolve(sourceFile), sourceStat = await stat(source);
  if (!sourceStat.isFile() || sourceStat.size < 1 || sourceStat.size > MAX_SOURCE
    || options.expectedSha256 !== undefined && !HASH.test(options.expectedSha256)) {
    throw new ReviewVideoPreparationError("Invalid review media source.", "unsupported");
  }
  const hash = createHash("sha256");
  let sourceBytes = 0;
  for await (const chunk of createReadStream(source)) {
    cancelled(options.signal); sourceBytes += chunk.length;
    if (sourceBytes > MAX_SOURCE) throw new ReviewVideoPreparationError("Review media source exceeds its byte limit.", "unsupported");
    hash.update(chunk);
  }
  const sourceSha256 = hash.digest("hex");
  if (options.expectedSha256 && sourceSha256 !== options.expectedSha256) throw new ReviewVideoPreparationError("Review media source changed.", "source-changed");
  options.onStage?.("probe");
  const original = videoInfo(await probe(source, options.signal));
  const root = resolve(options.tempRoot ?? (process.platform === "win32" ? join(process.cwd(), ".tmp/review-media") : tmpdir()));
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "stack-review-video-"));
  try {
    const proxyFile = join(directory, "proxy.mp4"), posterFile = join(directory, "poster.png"), spriteFile = join(directory, "sprite.jpg");
    const aspect = original.width * original.sampleAspect / original.height;
    const displayAspect = original.rotation === 90 || original.rotation === 270 ? 1 / aspect : aspect;
    const scaledWidth = displayAspect >= 16 / 9 ? 640 : Math.max(2, Math.floor(360 * displayAspect / 2) * 2);
    const scaledHeight = displayAspect >= 16 / 9 ? Math.max(2, Math.floor(640 / displayAspect / 2) * 2) : 360;
    options.onStage?.("proxy");
    await run("ffmpeg", ["-hide_banner", "-nostdin", "-v", "error", "-y", "-protocol_whitelist", "file,pipe", "-format_whitelist", FORMATS,
      "-threads", "2", "-i", source, "-map", `0:${original.stream.index}`, "-an", "-sn", "-dn", "-map_metadata", "-1",
      "-filter_threads", "1", "-vf", `scale=${scaledWidth}:${scaledHeight},setsar=1,pad=640:360:(ow-iw)/2:(oh-ih)/2,setpts=PTS-STARTPTS`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-threads", "2", "-g", "24",
      "-fps_mode", "passthrough", "-enc_time_base", "-1", "-movflags", "+faststart", "-fs", String(MAX_PROXY), proxyFile], "proxy", options.signal);
    const proxyProbe = await probe(proxyFile, options.signal), prepared = videoInfo(proxyProbe);
    if (prepared.stream.codec_name !== "h264" || prepared.rotation !== 0 || prepared.sampleAspect !== 1
      || prepared.width !== 640 || prepared.height !== 360 || prepared.frameCount !== original.frameCount
      || proxyProbe.streams?.some(stream => stream.codec_type === "audio") || Math.abs(prepared.duration - original.duration) > 2 / original.frameRate) {
      throw new ReviewVideoPreparationError("The review proxy changed the source frame count or timing.", "process-failed");
    }
    options.onStage?.("poster");
    await run("ffmpeg", ["-hide_banner", "-nostdin", "-v", "error", "-y", "-protocol_whitelist", "file,pipe", "-i", proxyFile,
      "-vf", "scale=320:180", "-frames:v", "1", "-threads", "1", posterFile], "poster", options.signal);
    const poster = new Uint8Array(await sharp(await boundedFile(posterFile, 2 * 1024 * 1024)).webp({ quality: 75, effort: 3 }).toBuffer());
    options.onStage?.("sprite");
    await run("ffmpeg", ["-hide_banner", "-nostdin", "-v", "error", "-y", "-protocol_whitelist", "file,pipe", "-i", proxyFile,
      "-vf", `fps=${32 / prepared.duration}:start_time=0,scale=160:90,tpad=stop_mode=clone:stop=32,tile=8x4:nb_frames=32`,
      "-frames:v", "1", "-q:v", "4", "-threads", "1", spriteFile], "sprite", options.signal);
    options.onStage?.("verify");
    const proxy = await boundedFile(proxyFile, MAX_PROXY), sprite = await boundedFile(spriteFile, 4 * 1024 * 1024);
    const spriteInfo = await sharp(sprite).metadata();
    if (spriteInfo.width !== 1280 || spriteInfo.height !== 360) throw new ReviewVideoPreparationError("Review scrub sheet has invalid dimensions.", "process-failed");
    cancelled(options.signal);
    const metadata: ReviewVideoMetadata = { version: 1, recipe: REVIEW_VIDEO_RECIPE,
      source: { sha256: sourceSha256, bytes: sourceBytes, width: original.width, height: original.height, duration: original.duration,
        startTime: original.startTime, frameCount: original.frameCount, frameRate: original.frameRate, rotation: original.rotation },
      proxy: { sha256: digest(proxy), bytes: proxy.byteLength, width: 640, height: 360, mime: "video/mp4", duration: prepared.duration,
        frameCount: prepared.frameCount, sourceTimeOffset: original.startTime - prepared.startTime },
      poster: { sha256: digest(poster), bytes: poster.byteLength, width: 320, height: 180, mime: "image/webp" },
      sprite: { sha256: digest(sprite), bytes: sprite.byteLength, width: 1280, height: 360, mime: "image/jpeg", columns: 8, rows: 4, count: 32,
        times: Array.from({ length: 32 }, (_, index) => original.startTime + index * prepared.duration / 32) } };
    return { metadata, bytes: { proxy, poster, sprite } };
  } finally {
    if (!resolve(directory).startsWith(root + sep)) throw new Error("Review preparation cleanup escaped its temporary root.");
    await rm(directory, { recursive: true, force: true });
  }
}
