import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk";

import { downloadMediaGatewayFile, uploadFileToMediaGateway, type MediaGatewayUploadResult } from "@/lib/mediaGateway";

import { vm100HeavyQueue } from "./queues";
import { markWorkCompleted, markWorkRunning } from "./workMetadata";

export type FfmpegInputRef = {
  bucket: string;
  objectKey: string;
  fileName: string;
  mimeType?: string;
};

export type FfmpegPreviewPayload = {
  operation: "concat" | "preview";
  requestKey: string;
  inputFiles: FfmpegInputRef[];
  segments?: Array<{ startTime: number; endTime: number; sourceIndex?: number }>;
  startTime?: number;
  endTime?: number;
};

export type FfmpegPreviewOutput = {
  requestKey: string;
  assetKey: string;
  duration: number;
  generatedAt: string;
  videoUrl: string;
  storage: MediaGatewayUploadResult;
};

export const ffmpegPreviewTask = task({
  id: "ffmpeg-preview-or-concat",
  queue: vm100HeavyQueue,
  maxDuration: 600,
  retry: { maxAttempts: 1 },
  run: async (payload: FfmpegPreviewPayload, { ctx }): Promise<FfmpegPreviewOutput> => {
    if (!payload.requestKey?.trim()) throw new AbortTaskRunError("FFmpeg preview requestKey is required.");
    if (!payload.inputFiles?.length) throw new AbortTaskRunError("FFmpeg preview requires at least one stored input file.");
    markWorkRunning("rendering", "Rendering preview", { progressMode: "indeterminate" });

    const gatewayUrl = requireEnv("FFMPEG_GATEWAY_URL").replace(/\/+$/, "");
    const apiKey = process.env.FFMPEG_GATEWAY_API_KEY?.trim();
    const headers: Record<string, string> = apiKey ? { "X-API-Key": apiKey } : {};
    const files = await Promise.all(payload.inputFiles.map(async (input) => {
      const source = await downloadMediaGatewayFile({
        bucket: input.bucket,
        objectKey: input.objectKey,
        fileName: input.fileName,
      });
      return new File([source.bytes], input.fileName, { type: input.mimeType || source.mime });
    }));

    const form = new FormData();
    form.set("file", files[0]!);
    files.forEach((file, index) => form.set(`file:${index}`, file));
    if (payload.segments) form.set("segments", JSON.stringify(payload.segments));

    const endpoint = payload.operation === "concat"
      ? `${gatewayUrl}/ffmpeg/concat?segments=${encodeURIComponent(JSON.stringify(payload.segments ?? []))}`
      : `${gatewayUrl}/ffmpeg/preview?startTime=${payload.startTime ?? 0}&endTime=${payload.endTime ?? 1}`;
    const response = await fetch(endpoint, { method: "POST", headers, body: form, signal: AbortSignal.timeout(540_000) });
    const result = await readJson(response);
    if (!response.ok || result.success === false) {
      throw providerError("FFmpeg gateway", response, result);
    }

    const downloadUrl = readString(result, "downloadUrl");
    if (!downloadUrl) throw new Error("FFmpeg gateway returned no download URL.");
    let outputUrl = new URL(downloadUrl, gatewayUrl).toString();
    let outputResponse = await fetch(outputUrl, { headers, signal: AbortSignal.timeout(180_000) });
    // The current concat gateway can report /download/<id>.mp4 while the
    // output it actually wrote is <id>-part0.mp4. Only fall back on a 404 and
    // derive the alternate name from the gateway-owned outputPath basename.
    if (outputResponse.status === 404) {
      const outputPath = readString(result, "outputPath");
      const outputName = outputPath?.split(/[\\/]/).pop();
      if (outputName) {
        outputUrl = new URL(`/download/${encodeURIComponent(outputName)}`, gatewayUrl).toString();
        outputResponse = await fetch(outputUrl, { headers, signal: AbortSignal.timeout(180_000) });
      }
    }
    if (!outputResponse.ok) throw new Error(`FFmpeg output download failed (${outputResponse.status}).`);
    const output = new File([await outputResponse.blob()], `${sanitize(payload.requestKey)}.mp4`, { type: "video/mp4" });
    const storage = await uploadFileToMediaGateway({
      file: output,
      folder: `media-uploads/generated/previews/${sanitize(payload.requestKey)}`,
    });

    logger.info("FFmpeg preview persisted", {
      triggerRunId: ctx.run.id,
      requestKey: payload.requestKey,
      objectKey: storage.objectKey,
    });
    markWorkCompleted("Preview persisted", { completedItems: 1, totalItems: 1 });
    return {
      requestKey: payload.requestKey,
      // The app treats assetKey as an addressable preview URL. Keep the
      // durable object key inside `storage` while returning the public media
      // URL so the browser never depends on a Trigger worker's temp path.
      assetKey: storage.mediaUrl || storage.publicUrl,
      duration: readNumber(result, "duration") ?? requestedDuration(payload),
      generatedAt: new Date().toISOString(),
      videoUrl: storage.mediaUrl || storage.publicUrl,
      storage,
    };
  },
});

function requestedDuration(payload: FfmpegPreviewPayload) {
  if (payload.operation === "preview") {
    return Math.max(0, (payload.endTime ?? 1) - (payload.startTime ?? 0));
  }
  return (payload.segments ?? []).reduce(
    (total, segment) => total + Math.max(0, segment.endTime - segment.startTime),
    0,
  );
}

function requireEnv(key: string) {
  const value = process.env[key]?.trim();
  if (!value) throw new AbortTaskRunError(`Missing required environment variable: ${key}`);
  return value;
}

function sanitize(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "preview";
}

function providerError(operation: string, response: Response, payload: Record<string, unknown>) {
  const detail = readString(payload, "error") || response.statusText || "unknown provider error";
  const message = `${operation} failed (${response.status}): ${detail}`;
  return response.status >= 400 && response.status < 500 ? new AbortTaskRunError(message) : new Error(message);
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

function readNumber(value: Record<string, unknown>, key: string) {
  const item = value[key];
  return typeof item === "number" && Number.isFinite(item) ? item : undefined;
}
