export const runtime = "nodejs";

const FFMPEG_GATEWAY_URL = process.env.FFMPEG_GATEWAY_URL?.trim().replace(/\/+$/, "") ?? "";
const FFMPEG_GATEWAY_API_KEY = process.env.FFMPEG_GATEWAY_API_KEY?.trim() ?? "";

interface GatewaySegment {
  startTime: number;
  endTime: number;
  sourceIndex?: number;
}

interface GatewayInputFile {
  buffer: ArrayBuffer;
  name: string;
  type: string;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const segmentsRaw = formData.get("segments");
    const requestKey = (formData.get("requestKey") as string) ?? `preview-${Date.now()}`;

    if (!(file instanceof File)) {
      return Response.json({ success: false, error: "Video file is required." }, { status: 400 });
    }

    if (!segmentsRaw) {
      return Response.json({ success: false, error: "Segments are required." }, { status: 400 });
    }

    const segments = JSON.parse(segmentsRaw as string) as GatewaySegment[];

    if (!segments.length) {
      return Response.json({ success: false, error: "No segments provided." }, { status: 400 });
    }

    const inputFiles = await readInputFiles(formData, file);

    if (FFMPEG_GATEWAY_URL && inputFiles.length === 1) {
      const gatewayResponse = await gatewayConcatPreview({
        fileBuffer: inputFiles[0].buffer,
        fileName: inputFiles[0].name,
        fileType: inputFiles[0].type,
        requestKey,
        segments,
      });
      if (gatewayResponse.ok) return gatewayResponse;
      console.warn("[PreviewGateway] Remote gateway failed; falling back to local FFmpeg preview.");
    } else if (FFMPEG_GATEWAY_URL) {
      console.warn("[PreviewGateway] Multi-source preview requested; using local FFmpeg concat.");
    }

    return localConcatPreview({
      inputFiles,
      requestKey,
      segments,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown gateway preview error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}

async function readInputFiles(formData: FormData, fallbackFile: File): Promise<GatewayInputFile[]> {
  const indexedFiles = [...formData.entries()]
    .map(([key, value]) => {
      const match = key.match(/^file:(\d+)$/);
      if (!match || !(value instanceof File)) return null;
      return { index: Number(match[1]), file: value };
    })
    .filter((entry): entry is { index: number; file: File } => entry !== null)
    .sort((a, b) => a.index - b.index);

  const files = indexedFiles.length > 0 ? indexedFiles.map((entry) => entry.file) : [fallbackFile];
  return Promise.all(
    files.map(async (inputFile) => ({
      buffer: await inputFile.arrayBuffer(),
      name: inputFile.name,
      type: inputFile.type,
    })),
  );
}

async function gatewayConcatPreview(params: {
  fileBuffer: ArrayBuffer;
  fileName: string;
  fileType: string;
  requestKey: string;
  segments: GatewaySegment[];
}) {
  const headers: Record<string, string> = {};
  if (FFMPEG_GATEWAY_API_KEY) headers["X-API-Key"] = FFMPEG_GATEWAY_API_KEY;

  const concatForm = new FormData();
  concatForm.set("file", new Blob([params.fileBuffer], { type: params.fileType || "video/mp4" }), params.fileName);
  concatForm.set("segments", JSON.stringify(params.segments));

  const concatResponse = await fetch(`${FFMPEG_GATEWAY_URL}/ffmpeg/concat`, {
    method: "POST",
    headers,
    body: concatForm,
  });

  if (!concatResponse.ok) {
    const errorText = await concatResponse.text();
    return Response.json(
      { success: false, error: `Gateway concat failed: ${errorText.slice(0, 200)}` },
      { status: concatResponse.status },
    );
  }

  const concatResult = (await concatResponse.json()) as {
    success?: boolean;
    fileId?: string;
    downloadUrl?: string;
    duration?: number;
    error?: string;
  };

  if (!concatResult.success) {
    return Response.json(
      { success: false, error: concatResult.error ?? "Gateway concat returned failure." },
      { status: 500 },
    );
  }

  const videoUrl = concatResult.downloadUrl
    ? `${FFMPEG_GATEWAY_URL}${concatResult.downloadUrl}`
    : null;

  if (!videoUrl) {
    return Response.json(
      { success: false, error: "Gateway concat returned no download URL." },
      { status: 500 },
    );
  }

  return Response.json({
    success: true,
    asset: {
      requestKey: params.requestKey,
      assetKey: videoUrl,
      duration: concatResult.duration ?? 0,
      generatedAt: new Date().toISOString(),
      videoUrl,
      gatewayFileId: concatResult.fileId,
    },
  });
}

async function localConcatPreview(params: {
  inputFiles: GatewayInputFile[];
  requestKey: string;
  segments: GatewaySegment[];
}) {
  const [{ mkdir, writeFile }, os, path, { generateConcatPreview }, { probeMediaFile }] = await Promise.all([
    import("node:fs/promises"),
    import("node:os"),
    import("node:path"),
    import("@/components/studio/previewGeneration"),
    import("@/components/studio/mediaProbe"),
  ]);

  const uploadDir = path.join(os.tmpdir(), "project-stack-structure-browser-previews");
  await mkdir(uploadDir, { recursive: true });
  const inputPaths = await Promise.all(
    params.inputFiles.map(async (inputFile, index) => {
      const extension = inputFile.name.match(/\.[^.]+$/)?.[0] ?? ".mp4";
      const inputPath = path.join(uploadDir, `${sanitizeFileName(params.requestKey)}-${index}${extension}`);
      await writeFile(inputPath, Buffer.from(inputFile.buffer));
      return inputPath;
    }),
  );

  const probeFn = async (filePath: string) => {
    const result = await probeMediaFile(filePath);
    return { duration: result.duration, hasVideo: result.hasVideo };
  };

  const asset = await generateConcatPreview({
    requestKey: params.requestKey,
    segments: params.segments.map((segment) => ({
      inputPath: inputPaths[segment.sourceIndex ?? 0] ?? inputPaths[0],
      startTime: segment.startTime,
      endTime: segment.endTime,
    })),
    probeFn,
  });

  return Response.json({
    success: true,
    asset: {
      requestKey: asset.requestKey,
      assetKey: asset.assetKey,
      duration: asset.duration,
      generatedAt: asset.generatedAt,
      videoUrl: `/api/preview/asset?assetKey=${encodeURIComponent(asset.assetKey)}`,
    },
  });
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "preview";
}
