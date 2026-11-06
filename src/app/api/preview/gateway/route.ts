import { getMediaGatewayConfig, uploadFileToMediaGateway } from "@/lib/mediaGateway";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { triggerFfmpegPreview } from "@/lib/triggerOrchestration";
import { scopeMediaUploadFolder } from "@/lib/essentiaUpload";
import { assertExportInputOwnership, resolveDurableInput } from "@/lib/exportInputs";

export const runtime = "nodejs";

type GatewaySegment = {
  startTime: number;
  endTime: number;
  sourceIndex?: number;
};

type GatewayInputRef = { bucket: string; objectKey: string };

function parseGatewayInputRef(value: unknown): GatewayInputRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("ref is not an object");
  const record = value as Record<string, unknown>;
  if (typeof record.bucket !== "string" || typeof record.objectKey !== "string") {
    throw new Error("ref requires string bucket and objectKey");
  }
  return { bucket: record.bucket.trim(), objectKey: record.objectKey };
}

function resolveRefsToInputs(refs: GatewayInputRef[]) {
  const config = getMediaGatewayConfig();
  if (!config) {
    throw new Error("RustFS media gateway env is not configured; durable preview references cannot be resolved.");
  }
  return refs.map((ref) => {
    const { objectKey } = resolveDurableInput(ref, "video/mp4");
    return {
      bucket: ref.bucket,
      objectKey,
      fileName: objectKey.split("/").pop() || "source.mp4",
      mimeType: "video/mp4",
    };
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to render previews.");
  try {
    const formData = await request.formData();
    const primary = formData.get("file");
    const refsRaw = formData.get("refs");
    const segmentsRaw = formData.get("segments");
    const requestKey = String(formData.get("requestKey") || `preview-${Date.now()}`);

    let parsedRefs: GatewayInputRef[] | null = null;
    if (typeof refsRaw === "string" && refsRaw.trim()) {
      try {
        const value = JSON.parse(refsRaw) as unknown;
        if (!Array.isArray(value) || !value.length) throw new Error("refs must be a non-empty array");
        parsedRefs = value.map(parseGatewayInputRef);
      } catch {
        return Response.json({ success: false, error: "refs must be a non-empty array of {bucket, objectKey}." }, { status: 400 });
      }
    }

    if (!parsedRefs && !(primary instanceof File)) {
      return Response.json({ success: false, error: "Durable refs or a video file are required." }, { status: 400 });
    }
    if (typeof segmentsRaw !== "string" || !segmentsRaw.trim()) return Response.json({ success: false, error: "Segments are required." }, { status: 400 });

    const segments = JSON.parse(segmentsRaw) as GatewaySegment[];
    if (!Array.isArray(segments) || !segments.length) return Response.json({ success: false, error: "No segments provided." }, { status: 400 });

    let inputFiles: Awaited<ReturnType<typeof uploadClientFilesToInputs>>;
    if (parsedRefs) {
      inputFiles = resolveRefsToInputs(parsedRefs);
    } else {
      inputFiles = await uploadClientFilesToInputs(formData, primary as File, requestKey, user.id);
    }
    try { assertExportInputOwnership(inputFiles, user.id); }
    catch (error) { return Response.json({ success: false, error: (error as Error).message }, { status: 403 }); }

    const handle = await triggerFfmpegPreview({
      operation: "concat",
      requestKey,
      inputFiles,
      segments,
    });
    return Response.json({
      success: true,
      queued: true,
      orchestration: "trigger.dev",
      runId: handle.id,
      requestKey,
    }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gateway preview failed.";
    return Response.json({ success: false, error: message }, { status: /not configured|Missing RustFS/i.test(message) ? 503 : 500 });
  }
}

async function uploadClientFilesToInputs(formData: FormData, primary: File, requestKey: string, ownerId: string) {
  const indexedFiles = [...formData.entries()]
    .map(([key, value]) => {
      const match = key.match(/^file:(\d+)$/);
      return match && value instanceof File ? { index: Number(match[1]), file: value } : null;
    })
    .filter((entry): entry is { index: number; file: File } => entry !== null)
    .sort((left, right) => left.index - right.index);
  const files = indexedFiles.length ? indexedFiles.map((entry) => entry.file) : [primary];

  return Promise.all(files.map(async (file) => {
    const uploaded = await uploadFileToMediaGateway({
      file,
      folder: scopeMediaUploadFolder(`media-uploads/preview-inputs/${sanitize(requestKey)}`, ownerId),
    });
    return {
      bucket: uploaded.bucket,
      objectKey: uploaded.objectKey,
      fileName: file.name,
      mimeType: file.type || "video/mp4",
    };
  }));
}

function sanitize(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "preview";
}
