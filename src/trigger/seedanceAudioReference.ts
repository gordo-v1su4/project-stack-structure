import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk";

import { resolveSeedanceAudioReferenceWindow, type SeedanceAudioReferenceWindow } from "@/components/studio/seedanceAudioReference";
import { downloadMediaGatewayFile, uploadFileToMediaGateway, type MediaGatewayUploadResult } from "@/lib/mediaGateway";

import { MEDIA_ASSEMBLY_MACHINE, mediaAssemblyQueue } from "./queues";
import { markWorkCompleted, markWorkRunning } from "./workMetadata";

const execFileAsync = promisify(execFile);

export type SeedanceAudioReferencePayload = {
  requestKey: string;
  audio: {
    bucket: string;
    objectKey: string;
    fileName: string;
    mimeType?: string;
  };
  songStart: number;
  songEnd: number;
  songDuration: number;
  handleSeconds?: number;
};

export type SeedanceAudioReferenceOutput = SeedanceAudioReferenceWindow & {
  requestKey: string;
  generatedAt: string;
  videoUrl: string;
  storage: MediaGatewayUploadResult;
};

export const seedanceAudioReferenceTask = task({
  id: "ffmpeg-seedance-audio-reference",
  queue: mediaAssemblyQueue,
  machine: MEDIA_ASSEMBLY_MACHINE,
  maxDuration: 900,
  retry: { maxAttempts: 1 },
  run: async (payload: SeedanceAudioReferencePayload, { ctx }): Promise<SeedanceAudioReferenceOutput> => {
    if (!payload.requestKey?.trim()) throw new AbortTaskRunError("Seedance audio reference requestKey is required.");
    if (!payload.audio?.bucket?.trim() || !payload.audio.objectKey?.trim()) {
      throw new AbortTaskRunError("Seedance audio reference requires one durable master-audio object.");
    }
    let window: SeedanceAudioReferenceWindow;
    try {
      window = resolveSeedanceAudioReferenceWindow(payload);
    } catch (error) {
      throw new AbortTaskRunError(error instanceof Error ? error.message : "Invalid Seedance audio timing window.");
    }

    markWorkRunning("rendering", "Preparing Seedance timing reference", { progressMode: "indeterminate" });
    const workspace = await mkdtemp(path.join(os.tmpdir(), "stack-structure-seedance-audio-"));
    try {
      const source = await downloadMediaGatewayFile({
        bucket: payload.audio.bucket,
        objectKey: payload.audio.objectKey,
        fileName: payload.audio.fileName,
      });
      const inputExtension = path.extname(payload.audio.fileName) || ".audio";
      const inputPath = path.join(workspace, `master${inputExtension}`);
      const outputPath = path.join(workspace, `${sanitize(payload.requestKey)}.mp4`);
      await writeFile(inputPath, Buffer.from(source.bytes));

      await execFileAsync(process.env.FFMPEG_PATH ?? "ffmpeg", [
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-ss", String(window.clipStart),
        "-t", String(window.duration),
        "-i", inputPath,
        "-f", "lavfi",
        "-i", `color=c=black:s=1280x720:r=24:d=${window.duration}`,
        "-map", "1:v:0",
        "-map", "0:a:0",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-ar", "48000",
        "-shortest",
        "-movflags", "+faststart",
        outputPath,
      ]);

      const output = await readFile(outputPath);
      const storage = await uploadFileToMediaGateway({
        file: new File([output], `${sanitize(payload.requestKey)}.mp4`, { type: "video/mp4" }),
        folder: `media-uploads/generated/seedance-audio-reference/${sanitize(payload.requestKey)}`,
      });
      const videoUrl = storage.mediaUrl || storage.publicUrl;
      logger.info("Seedance audio reference persisted", {
        triggerRunId: ctx.run.id,
        requestKey: payload.requestKey,
        objectKey: storage.objectKey,
        songStart: payload.songStart,
        songEnd: payload.songEnd,
        clipStart: window.clipStart,
        clipEnd: window.clipEnd,
      });
      markWorkCompleted("Seedance timing reference ready", { completedItems: 1, totalItems: 1 });
      return { ...window, requestKey: payload.requestKey, generatedAt: new Date().toISOString(), videoUrl, storage };
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  },
});

function sanitize(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "seedance-audio-reference";
}
