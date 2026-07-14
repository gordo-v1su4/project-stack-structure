import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk";

import type { GlitchMotionVectorParams } from "@/components/studio/ffglitchApi";
import { downloadHttpBytes } from "@/lib/httpDownload";
import { uploadFileToMediaGateway } from "@/lib/mediaGateway";

import { vm100HeavyQueue } from "./queues";
import { markWorkCompleted, markWorkRunning } from "./workMetadata";

const execFileAsync = promisify(execFile);

export type FfglitchPayload = {
  action: "probe" | "glitch";
  inputPath: string;
  sourceIdentity?: string;
  fileName?: string;
  outputPath?: string;
  glitchParams?: GlitchMotionVectorParams;
};

export const ffglitchTask = task({
  id: "ffglitch-transform",
  queue: vm100HeavyQueue,
  maxDuration: 900,
  retry: { maxAttempts: 1 },
  run: async (payload: FfglitchPayload, { ctx }) => {
    const gatewayUrl = process.env.FFMPEG_GATEWAY_URL?.trim().replace(/\/+$/, "");
    if (!gatewayUrl) throw new AbortTaskRunError("FFMPEG_GATEWAY_URL is required for Trigger FFglitch tasks.");
    if (!payload.inputPath?.trim()) throw new AbortTaskRunError("FFglitch inputPath is required.");
    if (payload.action === "glitch" && !payload.glitchParams) {
      throw new AbortTaskRunError("FFglitch glitchParams are required for a glitch operation.");
    }
    markWorkRunning(
      payload.action === "probe" ? "probing" : "transforming",
      payload.action === "probe" ? "Probing FFglitch compatibility" : "Applying FFglitch transform",
      { progressMode: "indeterminate" },
    );

    const apiKey = process.env.FFMPEG_GATEWAY_API_KEY?.trim();
    const source = await downloadHttpBytes(payload.inputPath, 180_000);
    const fileName = payload.fileName?.trim() || fileNameFromUrl(payload.inputPath);
    const workspace = await mkdtemp(path.join(os.tmpdir(), "stack-structure-ffglitch-"));
    try {
      const sourcePath = path.join(workspace, `source${path.extname(fileName) || ".mp4"}`);
      const compatiblePath = path.join(workspace, "ffglitch-input.avi");
      await writeFile(sourcePath, Buffer.from(source.bytes));
      await runFfmpeg([
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", sourcePath,
        "-map", "0:v:0",
        "-an",
        "-c:v", "mpeg4",
        "-q:v", "3",
        "-g", "12",
        "-bf", "0",
        "-pix_fmt", "yuv420p",
        compatiblePath,
      ], "FFglitch compatibility transcode");
      const compatibleBytes = await readFile(compatiblePath);

      const form = new FormData();
      form.set("file", new File([copyToArrayBuffer(compatibleBytes)], "ffglitch-input.avi", {
        type: "video/x-msvideo",
      }));

      const endpoint = payload.action === "probe"
        ? `${gatewayUrl}/ffglitch/probe`
        : `${gatewayUrl}/ffglitch/glitch?${new URLSearchParams({
            mode: payload.glitchParams!.mode,
            intensity: String(payload.glitchParams!.intensity),
            beatTimes: JSON.stringify(payload.glitchParams!.beatTimes ?? []),
          })}`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: apiKey ? { "X-API-Key": apiKey } : undefined,
        body: form,
        signal: AbortSignal.timeout(840_000),
      });
      const result = await readJson(response);
      if (!response.ok || result.success === false) {
        const detail = readString(result, "error") || readString(result, "detail") || response.statusText || "unknown provider error";
        const error = `${payload.action === "probe" ? "FFglitch probe" : "FFglitch transform"} failed (${response.status}): ${detail}`;
        throw response.status >= 400 && response.status < 500 ? new AbortTaskRunError(error) : new Error(error);
      }

      let durableOutput: Record<string, unknown> = {};
      if (payload.action === "glitch") {
        const downloadUrl = readString(result, "downloadUrl");
        if (!downloadUrl) throw new Error("FFglitch gateway returned no download URL.");
        const output = await downloadHttpBytes(
          new URL(downloadUrl, gatewayUrl).toString(),
          180_000,
          apiKey ? { "X-API-Key": apiKey } : {},
        );
        const glitchedPath = path.join(workspace, "glitched.avi");
        const finalPath = path.join(workspace, "glitched.mp4");
        await writeFile(glitchedPath, Buffer.from(output.bytes));
        await runFfmpeg([
          "-hide_banner", "-loglevel", "error", "-y",
          "-i", glitchedPath,
          "-i", sourcePath,
          "-map", "0:v:0",
          "-map", "1:a?",
          "-c:v", "libx264",
          "-preset", "veryfast",
          "-crf", "20",
          "-c:a", "aac",
          "-movflags", "+faststart",
          "-shortest",
          finalPath,
        ], "FFglitch browser-output transcode");
        const finalBytes = await readFile(finalPath);
        const outputName = `${path.parse(fileName).name || "ffglitch"}-glitched.mp4`;
        const storage = await uploadFileToMediaGateway({
          file: new File([copyToArrayBuffer(finalBytes)], outputName, { type: "video/mp4" }),
          folder: `media-uploads/generated/ffglitch/${ctx.run.id}`,
        });
        durableOutput = { storage, videoUrl: storage.mediaUrl || storage.publicUrl };
      }

      logger.info("FFglitch task completed", {
        triggerRunId: ctx.run.id,
        action: payload.action,
        inputPath: payload.inputPath,
      });
      markWorkCompleted(
        payload.action === "probe" ? "FFglitch probe completed" : "FFglitch output persisted",
        { completedItems: 1, totalItems: 1 },
      );
      return { ...result, ...durableOutput };
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  },
});

async function runFfmpeg(args: string[], operation: string) {
  try {
    await execFileAsync("ffmpeg", args, {
      timeout: 300_000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : String(error);
    throw new Error(`${operation} failed: ${stderr.slice(0, 500)}`);
  }
}

function copyToArrayBuffer(bytes: Uint8Array) {
  const output = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(output).set(bytes);
  return output;
}

function fileNameFromUrl(value: string) {
  try {
    return path.basename(new URL(value).pathname) || "source.mp4";
  } catch {
    return path.basename(value) || "source.mp4";
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text().catch(() => "");
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : { value };
  } catch {
    return { error: text.slice(0, 500) };
  }
}

function readString(value: Record<string, unknown>, key: string) {
  const item = value[key];
  return typeof item === "string" && item.trim() ? item.trim() : undefined;
}
