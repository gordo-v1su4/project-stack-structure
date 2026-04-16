export const runtime = "nodejs";

const FFMPEG_GATEWAY_URL = process.env.FFMPEG_GATEWAY_URL?.trim().replace(/\/+$/, "") ?? "";
const FFMPEG_GATEWAY_API_KEY = process.env.FFMPEG_GATEWAY_API_KEY?.trim() ?? "";

interface PreviewSectionRequest {
  inputPath?: string;
  requestKey?: string;
  startTime?: number;
  endTime?: number;
  segments?: Array<{
    inputPath: string;
    startTime: number;
    endTime: number;
  }>;
}

export async function POST(request: Request) {
  const payload = (await request.json()) as PreviewSectionRequest;
  const requestKey = payload.requestKey ?? `preview-${Date.now()}`;

  if (FFMPEG_GATEWAY_URL) {
    return gatewayPreview(payload, requestKey);
  }

  return localPreview(payload, requestKey);
}

async function gatewayPreview(payload: PreviewSectionRequest, requestKey: string) {
  const headers: Record<string, string> = {};
  if (FFMPEG_GATEWAY_API_KEY) headers["X-API-Key"] = FFMPEG_GATEWAY_API_KEY;

  try {
    if (payload.segments && payload.segments.length > 0) {
      const { listMediaFixtures } = await import("@/components/studio/mediaProbe");
      const inventory = listMediaFixtures();
      const defaultInputPath = inventory.video[0];

      const firstInput = payload.segments[0]?.inputPath || defaultInputPath;
      if (!firstInput) {
        return Response.json({ success: false, error: "No video input available." }, { status: 400 });
      }

      const fileBuffer = await import("node:fs/promises").then((fs) => fs.readFile(firstInput));
      const ext = firstInput.match(/\.[^.]+$/)?.[0] ?? ".mp4";
      const file = new File([fileBuffer], `source${ext}`, { type: "video/mp4" });

      const uploadForm = new FormData();
      uploadForm.set("file", new Blob([fileBuffer], { type: "video/mp4" }), `source${ext}`);

      const uploadResponse = await fetch(`${FFMPEG_GATEWAY_URL}/upload`, {
        method: "POST",
        headers,
        body: uploadForm,
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        return Response.json({ success: false, error: `Gateway upload failed: ${errorText.slice(0, 200)}` }, { status: uploadResponse.status });
      }

      const uploadResult = (await uploadResponse.json()) as { fileId?: string };
      if (!uploadResult.fileId) {
        return Response.json({ success: false, error: "Gateway upload returned no fileId." }, { status: 500 });
      }

      const segments = payload.segments.map((seg) => ({
        startTime: seg.startTime ?? 0,
        endTime: seg.endTime ?? 1,
      }));

      const concatForm = new FormData();
      concatForm.set("file", new Blob([], { type: "application/octet-stream" }), "dummy.mp4");
      concatForm.set("segments", JSON.stringify(segments));

      const concatResponse = await fetch(`${FFMPEG_GATEWAY_URL}/ffmpeg/concat`, {
        method: "POST",
        headers,
        body: concatForm,
      });

      if (!concatResponse.ok) {
        const errorText = await concatResponse.text();
        return Response.json({ success: false, error: `Gateway concat failed: ${errorText.slice(0, 200)}` }, { status: concatResponse.status });
      }

      const concatResult = (await concatResponse.json()) as {
        success?: boolean;
        downloadUrl?: string;
        duration?: number;
        error?: string;
      };

      if (!concatResult.success || !concatResult.downloadUrl) {
        return Response.json({ success: false, error: concatResult.error ?? "Gateway concat failed." }, { status: 500 });
      }

      const videoUrl = `${FFMPEG_GATEWAY_URL}${concatResult.downloadUrl}`;

      return Response.json({
        success: true,
        asset: {
          requestKey,
          assetKey: videoUrl,
          duration: concatResult.duration ?? 0,
          generatedAt: new Date().toISOString(),
        },
      });
    }

    const inputPath = payload.inputPath;
    if (!inputPath) {
      return Response.json({ success: false, error: "No video input available." }, { status: 400 });
    }

    const fileBuffer = await import("node:fs/promises").then((fs) => fs.readFile(inputPath));
    const ext = inputPath.match(/\.[^.]+$/)?.[0] ?? ".mp4";

    const previewForm = new FormData();
    previewForm.set("file", new Blob([fileBuffer], { type: "video/mp4" }), `source${ext}`);

    const previewResponse = await fetch(
      `${FFMPEG_GATEWAY_URL}/ffmpeg/preview?startTime=${payload.startTime ?? 0}&endTime=${payload.endTime ?? 1}`,
      { method: "POST", headers, body: previewForm },
    );

    if (!previewResponse.ok) {
      const errorText = await previewResponse.text();
      return Response.json({ success: false, error: `Gateway preview failed: ${errorText.slice(0, 200)}` }, { status: previewResponse.status });
    }

    const previewResult = (await previewResponse.json()) as {
      success?: boolean;
      downloadUrl?: string;
      duration?: number;
      size?: number;
      error?: string;
    };

    if (!previewResult.success || !previewResult.downloadUrl) {
      return Response.json({ success: false, error: previewResult.error ?? "Gateway preview failed." }, { status: 500 });
    }

    const videoUrl = `${FFMPEG_GATEWAY_URL}${previewResult.downloadUrl}`;

    return Response.json({
      success: true,
      asset: {
        requestKey,
        assetKey: videoUrl,
        duration: previewResult.duration ?? 0,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown gateway preview error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}

async function localPreview(payload: PreviewSectionRequest, requestKey: string) {
  const { generateConcatPreview, generateSectionPreview } = await import("@/components/studio/previewGeneration");
  const { listMediaFixtures, probeMediaFile } = await import("@/components/studio/mediaProbe");

  const probeFn = async (filePath: string) => {
    const result = await probeMediaFile(filePath);
    return { duration: result.duration, hasVideo: result.hasVideo };
  };

  const inventory = listMediaFixtures();
  const defaultInputPath = inventory.video[0];

  try {
    if (payload.segments && payload.segments.length > 0) {
      const segments = payload.segments.map((segment) => ({
        inputPath: segment.inputPath || defaultInputPath || "",
        startTime: segment.startTime ?? 0,
        endTime: segment.endTime ?? 1,
      }));

      const asset = await generateConcatPreview({
        segments,
        requestKey,
        probeFn,
      });

      return Response.json({ success: true, asset });
    }

    const inputPath = payload.inputPath ?? defaultInputPath;
    if (!inputPath) {
      return Response.json({ success: false, error: "No video fixture available for preview generation." }, { status: 400 });
    }

    const asset = await generateSectionPreview({
      inputPath,
      requestKey,
      startTime: payload.startTime ?? 0,
      endTime: payload.endTime ?? 1,
      probeFn,
    });

    return Response.json({ success: true, asset });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown preview generation error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}