export const runtime = "nodejs";

const FFMPEG_GATEWAY_URL = process.env.FFMPEG_GATEWAY_URL?.trim().replace(/\/+$/, "") ?? "";
const FFMPEG_GATEWAY_API_KEY = process.env.FFMPEG_GATEWAY_API_KEY?.trim() ?? "";

interface GatewaySegment {
  startTime: number;
  endTime: number;
}

export async function POST(request: Request) {
  if (!FFMPEG_GATEWAY_URL) {
    return Response.json(
      { success: false, error: "FFmpeg Gateway is not configured. Set FFMPEG_GATEWAY_URL." },
      { status: 503 },
    );
  }

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

    const headers: Record<string, string> = {};
    if (FFMPEG_GATEWAY_API_KEY) headers["X-API-Key"] = FFMPEG_GATEWAY_API_KEY;

    const uploadForm = new FormData();
    uploadForm.set("file", new Blob([await file.arrayBuffer()], { type: file.type }), file.name);

    const uploadResponse = await fetch(`${FFMPEG_GATEWAY_URL}/upload`, {
      method: "POST",
      headers,
      body: uploadForm,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      return Response.json(
        { success: false, error: `Gateway upload failed: ${errorText.slice(0, 200)}` },
        { status: uploadResponse.status },
      );
    }

    const uploadPayload = (await uploadResponse.json()) as { fileId?: string; error?: string };
    if (!uploadPayload.fileId) {
      return Response.json(
        { success: false, error: `Gateway upload returned no fileId: ${uploadPayload.error ?? "unknown"}` },
        { status: 500 },
      );
    }

    const fileId = uploadPayload.fileId;

    const concatPayload = {
      fileId,
      segments: JSON.stringify(segments),
    };

    const concatForm = new FormData();
    concatForm.set("file", new Blob([], { type: "application/octet-stream" }), "dummy.mp4");
    concatForm.set("segments", concatPayload.segments);

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

    const concatPayload = (await concatResponse.json()) as {
      success?: boolean;
      fileId?: string;
      downloadUrl?: string;
      duration?: number;
      error?: string;
    };

    if (!concatPayload.success) {
      return Response.json(
        { success: false, error: concatPayload.error ?? "Gateway concat returned failure." },
        { status: 500 },
      );
    }

    const videoUrl = concatPayload.downloadUrl
      ? `${FFMPEG_GATEWAY_URL}${concatPayload.downloadUrl}`
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
        requestKey,
        assetKey: videoUrl,
        duration: concatPayload.duration ?? 0,
        generatedAt: new Date().toISOString(),
        videoUrl,
        gatewayFileId: concatPayload.fileId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown gateway preview error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
