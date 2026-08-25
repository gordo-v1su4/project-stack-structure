import { getMediaGatewayConfig, normalizeMediaPath, uploadFileToMediaGateway } from "@/lib/mediaGateway";
import { authorizeMediaObject } from "@/lib/mediaOwnership";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { triggerFinalExport } from "@/lib/triggerOrchestration";

export const runtime = "nodejs";

type DurableExportInput = { bucket: string; objectKey: string; fileName: string; mimeType: string };

function resolveDurableInput(entry: unknown, mimeType: string): DurableExportInput {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Durable reference must be an object.");
  const record = entry as Record<string, unknown>;
  if (typeof record.bucket !== "string" || typeof record.objectKey !== "string") {
    throw new Error("Durable reference requires string bucket and objectKey.");
  }
  const config = getMediaGatewayConfig();
  if (!config) throw new Error("RustFS media gateway env is not configured; durable export references cannot be resolved.");
  const objectKey = normalizeMediaPath(record.objectKey);
  if (!objectKey || objectKey.length > 512) throw new Error("Invalid durable reference object key.");
  if (record.bucket.trim() !== config.bucket) throw new Error(`Durable reference bucket must be ${config.bucket}.`);
  return { bucket: record.bucket.trim(), objectKey, fileName: objectKey.split("/").pop() || "input.bin", mimeType };
}

function resolveDurableInputs(entries: unknown, mimeType: string): DurableExportInput[] {
  if (!Array.isArray(entries) || !entries.length) throw new Error("Durable references must be a non-empty array.");
  return entries.map((entry) => resolveDurableInput(entry, mimeType));
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to run final exports.");
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio");
    const segmentsRaw = formData.get("segments");
    const requestKey = String(formData.get("requestKey") || `final-export-${Date.now()}`);
    if (typeof segmentsRaw !== "string" || !segmentsRaw.trim()) return Response.json({ success: false, error: "Export segments are required." }, { status: 400 });
    const segments = JSON.parse(segmentsRaw) as Array<Record<string, unknown>>;
    if (!Array.isArray(segments) || !segments.length) return Response.json({ success: false, error: "No export segments provided." }, { status: 400 });

    const audioRefRaw = formData.get("audioRef");
    const videoRefsRaw = formData.get("videoRefs");
    let audio: DurableExportInput;
    let videos: DurableExportInput[];
    if (audioRefRaw !== null || videoRefsRaw !== null) {
      // Media already lives in RustFS; validate refs instead of re-uploading bytes.
      if (typeof audioRefRaw !== "string" || typeof videoRefsRaw !== "string") {
        return Response.json({ success: false, error: "Durable references require both audioRef and videoRefs." }, { status: 400 });
      }
      let parsedAudio: unknown;
      let parsedVideos: unknown;
      try {
        parsedAudio = JSON.parse(audioRefRaw);
        parsedVideos = JSON.parse(videoRefsRaw);
      } catch {
        return Response.json({ success: false, error: "Durable references are not valid JSON." }, { status: 400 });
      }
      try {
        audio = resolveDurableInput(parsedAudio, "audio/wav");
        videos = resolveDurableInputs(parsedVideos, "video/mp4");
      } catch (error) {
        return Response.json({ success: false, error: error instanceof Error ? error.message : "Invalid durable references." }, { status: 400 });
      }
      // Shared worker credentials mean every referenced object must belong to
      // the caller, or any authenticated user could export another user's media.
      // Pre-scoping legacy keys migrate into the ownership ledger on first use.
      const refObjectKeys = [audio.objectKey, ...videos.map((video) => video.objectKey)];
      const ownershipResults = await Promise.all(
        refObjectKeys.map((objectKey) => authorizeMediaObject({ bucket: audio.bucket, objectKey, ownerId: user.id })),
      );
      if (ownershipResults.some((authorized) => !authorized)) {
        return Response.json({ success: false, error: "Durable references must point at objects uploaded by the current user." }, { status: 403 });
      }
    } else {
      if (!(audioFile instanceof File)) return Response.json({ success: false, error: "Master audio file is required." }, { status: 400 });
      const inputFiles = [...formData.entries()]
        .map(([key, value]) => {
          const match = key.match(/^file:(\d+)$/);
          return match && value instanceof File ? { index: Number(match[1]), file: value } : null;
        })
        .filter((entry): entry is { index: number; file: File } => entry !== null)
        .sort((left, right) => left.index - right.index)
        .map((entry) => entry.file);
      if (!inputFiles.length) return Response.json({ success: false, error: "At least one source video file is required." }, { status: 400 });
      audio = await uploadInput(audioFile, `media-uploads/export-inputs/${sanitize(requestKey)}`);
      videos = await Promise.all(inputFiles.map((file) => uploadInput(file, `media-uploads/export-inputs/${sanitize(requestKey)}`)));
    }

    const handle = await triggerFinalExport({
      requestKey,
      audio,
      videos,
      segments: segments.map((segment) => ({
        sourceIndex: numberValue(segment.sourceIndex) ?? 0,
        startTime: numberValue(segment.startTime) ?? 0,
        endTime: numberValue(segment.endTime) ?? 0,
        musicStart: numberValue(segment.musicStart),
        musicEnd: numberValue(segment.musicEnd),
        label: typeof segment.label === "string" ? segment.label : undefined,
      })),
      effectCues: parseJsonField(formData.get("shaderCues")) as unknown[] | undefined,
      accentKinds: parseJsonField(formData.get("accentKinds")) as Record<string, string> | undefined,
      beats: parseJsonField(formData.get("beats")) as number[] | undefined,
      lyricChunks: parseJsonField(formData.get("lyricChunks")) as Array<{ id?: string; index?: number; start: number; end: number; text?: string }> | undefined,
      shaderPresetId: String(formData.get("shaderPresetId") || "balanced-music-video"),
    });
    return Response.json({ success: true, queued: true, orchestration: "trigger.dev", runId: handle.id, requestKey }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Final export failed.";
    return Response.json({ success: false, error: message }, { status: /not configured|Missing RustFS/i.test(message) ? 503 : 500 });
  }
}

async function uploadInput(file: File, folder: string) {
  const uploaded = await uploadFileToMediaGateway({ file, folder });
  return { bucket: uploaded.bucket, objectKey: uploaded.objectKey, fileName: file.name, mimeType: file.type || "application/octet-stream" };
}

function parseJsonField(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return JSON.parse(value) as unknown;
}

function numberValue(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function sanitize(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "export";
}
