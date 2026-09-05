import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { parseArgs } from "node:util";

const execFileAsync = promisify(execFile);

const { values } = parseArgs({
  options: {
    video: { type: "string" },
    first: { type: "string" },
    last: { type: "string" },
    "audit-dir": { type: "string", default: ".tmp/e2e-validation/minimax-h3-video-audit" },
    result: { type: "string" },
  },
  strict: true,
});

for (const name of ["video", "first", "last"] as const) {
  if (!values[name]) throw new Error(`--${name} is required`);
}

const videoPath = resolve(values.video!);
const firstPath = resolve(values.first!);
const lastPath = resolve(values.last!);
const auditDir = resolve(values["audit-dir"]!);
const resultPath = resolve(values.result ?? join(auditDir, "benchmark.json"));
await mkdir(auditDir, { recursive: true });

const probe = JSON.parse(await run("ffprobe", [
  "-v", "error",
  "-count_frames",
  "-show_entries", "stream=index,codec_name,codec_type,width,height,r_frame_rate,avg_frame_rate,nb_frames,nb_read_frames,duration",
  "-show_entries", "format=duration,size,bit_rate",
  "-of", "json",
  videoPath,
])) as {
  streams?: Array<Record<string, string | number>>;
  format?: Record<string, string | number>;
};

const videoStream = probe.streams?.find((stream) => stream.codec_type === "video");
if (!videoStream) throw new Error("ffprobe did not find a video stream");
const frameCount = Number(videoStream.nb_read_frames ?? videoStream.nb_frames);
if (!Number.isFinite(frameCount) || frameCount < 2) throw new Error("Video frame count is unavailable");

const generatedStart = join(auditDir, "generated-start.png");
const generatedEnd = join(auditDir, "generated-end.png");
const trajectory = join(auditDir, "trajectory-8up.png");
await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", videoPath, "-vf", "select='eq(n,0)'", "-frames:v", "1", generatedStart]);
await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", videoPath, "-vf", `select='eq(n,${frameCount - 1})'`, "-frames:v", "1", generatedEnd]);

const trajectoryFrames = Array.from({ length: 8 }, (_, index) => Math.round(index * (frameCount - 1) / 7));
const trajectorySelect = trajectoryFrames.map((frame) => `eq(n,${frame})`).join("+");
await run("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y", "-i", videoPath,
  "-vf", `select='${trajectorySelect}',scale=448:256,tile=4x2`,
  "-frames:v", "1", trajectory,
]);

const startSsim = await imageMetric("ssim", firstPath, generatedStart, /All:([0-9.]+)/);
const endSsim = await imageMetric("ssim", lastPath, generatedEnd, /All:([0-9.]+)/);
const startPsnr = await imageMetric("psnr", firstPath, generatedStart, /average:([0-9.]+)/);
const endPsnr = await imageMetric("psnr", lastPath, generatedEnd, /average:([0-9.]+)/);
const motion = await consecutiveFrameMotion(videoPath, frameCount);

const automatedChecks = {
  codec: videoStream.codec_name === "h264",
  dimensions: Number(videoStream.width) === 1344 && Number(videoStream.height) === 768,
  frameRate: String(videoStream.avg_frame_rate ?? videoStream.r_frame_rate) === "24/1",
  frameCount: frameCount === 124,
  startBoundary: startSsim >= 0.70,
  endBoundary: endSsim >= 0.80,
  noEndpointSnap: motion.finalTransition <= motion.p95,
};

const report = {
  schema: "stack-structure.minimax-h3-video-benchmark.v1",
  createdAt: new Date().toISOString(),
  video: videoPath,
  anchors: { first: firstPath, last: lastPath },
  media: {
    codec: videoStream.codec_name,
    width: Number(videoStream.width),
    height: Number(videoStream.height),
    frameRate: videoStream.avg_frame_rate ?? videoStream.r_frame_rate,
    frames: frameCount,
    durationSeconds: Number(videoStream.duration ?? probe.format?.duration),
    bytes: Number(probe.format?.size),
  },
  boundaryFidelity: {
    start: { ssim: startSsim, psnr: startPsnr },
    end: { ssim: endSsim, psnr: endPsnr },
  },
  motion,
  automatedChecks,
  automatedGate: Object.values(automatedChecks).every(Boolean) ? "pass" : "fail",
  manualGatesRequired: [
    "same subject identities throughout",
    "same person count throughout",
    "screen direction and intended action remain correct",
    "environment geometry remains coherent",
    "motion is physically plausible with no freezes or teleports",
    "no visible cut or endpoint snap",
    "prompt and edit intent are followed",
  ],
  artifacts: { generatedStart, generatedEnd, trajectory },
  note: "Automated pass is a local acceptance gate, not proof of parity with a paid Seedance control render.",
};

await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ result: resultPath, ...report }, null, 2));

async function imageMetric(filter: "ssim" | "psnr", reference: string, generated: string, pattern: RegExp) {
  const output = await run("ffmpeg", ["-hide_banner", "-i", reference, "-i", generated, "-lavfi", filter, "-f", "null", "NUL"]);
  const match = output.match(pattern);
  if (!match) throw new Error(`Could not parse ${filter.toUpperCase()} for ${basename(generated)}`);
  return Number(match[1]);
}

async function consecutiveFrameMotion(path: string, frames: number) {
  const filter = `[0:v]split=2[prev][curr];[prev]trim=start_frame=0:end_frame=${frames - 1},setpts=PTS-STARTPTS[p];[curr]trim=start_frame=1:end_frame=${frames},setpts=PTS-STARTPTS[c];[p][c]blend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG`;
  const output = await run("ffmpeg", ["-hide_banner", "-loglevel", "info", "-i", path, "-filter_complex", filter, "-f", "null", "NUL"]);
  const values = Array.from(output.matchAll(/YAVG=([0-9.]+)/g), (match) => Number(match[1]));
  if (values.length !== frames - 1) throw new Error(`Expected ${frames - 1} motion pairs, found ${values.length}`);
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const p95 = sorted[Math.floor((sorted.length - 1) * 0.95)];
  const finalTransition = values.at(-1)!;
  return {
    pairs: values.length,
    meanAbsLumaDiff: mean,
    p95,
    maximum: sorted.at(-1)!,
    finalTransition,
    finalVsMeanRatio: finalTransition / mean,
    finalBelowP95: finalTransition <= p95,
  };
}

async function run(command: string, args: string[]) {
  const result = await execFileAsync(command, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}
