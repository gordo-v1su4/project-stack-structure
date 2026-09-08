import { execFile } from "node:child_process";
import { writeFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { probeMediaFile } from "./mediaProbe";
import type { ExportTimelineSegment } from "./exportGeneration";
const exec = promisify(execFile);

/** Mix selected source intervals onto an already assembled master, preserving originals. */
export async function mixClipAudio(params: {
  audioPath: string; segments: ExportTimelineSegment[]; outputPath: string; ffmpegPath?: string;
  probeFn?: (path: string) => Promise<{ hasAudio?: boolean }>;
}): Promise<string> {
  const enabled = params.segments.filter(segment => segment.useClipAudio === true);
  if (!enabled.length) return params.audioPath;
  const audible = new Set<string>();
  for (const source of new Set(enabled.map(segment => segment.inputPath))) {
    if ((await (params.probeFn ?? probeMediaFile)(source)).hasAudio === true) audible.add(source);
  }
  if (!audible.size) return params.audioPath;
  const inputs = [...audible];
  const duration = params.segments.reduce((sum, segment) => sum + segment.endTime - segment.startTime, 0);
  const graphs = [`[0:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${duration}[master]`];
  const labels = ["[master]"];
  let cursor = 0;
  for (const [index, segment] of params.segments.entries()) {
    if (segment.useClipAudio === true && audible.has(segment.inputPath)) {
      const label = `clip${index}`;
      graphs.push(`[${inputs.indexOf(segment.inputPath) + 1}:a]atrim=start=${segment.startTime}:end=${segment.endTime},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(cursor * 48000)}S:all=1[${label}]`);
      labels.push(`[${label}]`);
    }
    cursor += segment.endTime - segment.startTime;
  }
  graphs.push(`${labels.join("")}amix=inputs=${labels.length}:duration=first:normalize=0:dropout_transition=0[out]`);
  const script = `${params.outputPath}.filter.txt`;
  await writeFile(script, graphs.join(";"), "utf8");
  const args = ["-y", "-i", params.audioPath, ...inputs.flatMap(input => ["-i", input]), "-/filter_complex", script, "-map", "[out]", "-c:a", "pcm_f32le", params.outputPath];
  try {
    try { await exec(params.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg", args); }
    catch (error) {
      if (!String((error as { stderr?: string }).stderr).includes("Unrecognized option '/filter_complex'")) throw error;
      await exec(params.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg", args.map(arg => arg === "-/filter_complex" ? "-filter_complex_script" : arg));
    }
  } finally { await rm(script, { force: true }); }
  return params.outputPath;
}
