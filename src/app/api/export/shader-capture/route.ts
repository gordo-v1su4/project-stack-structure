export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio");
    const shaderCaptureFile = formData.get("shaderCapture");
    const requestKey = String(formData.get("requestKey") || `webgpu-final-export-${Date.now()}`);

    if (!(audioFile instanceof File)) {
      return Response.json({ success: false, error: "Master audio file is required." }, { status: 400 });
    }

    if (!(shaderCaptureFile instanceof File)) {
      return Response.json({ success: false, error: "Shader capture video file is required." }, { status: 400 });
    }

    const [{ mkdir, writeFile }, os, path, { generateShaderCaptureMp4Export }, { probeMediaFile }] = await Promise.all([
      import("node:fs/promises"),
      import("node:os"),
      import("node:path"),
      import("@/components/studio/exportGeneration"),
      import("@/components/studio/mediaProbe"),
    ]);

    const uploadDir = path.join(os.tmpdir(), "project-stack-structure-final-export");
    await mkdir(uploadDir, { recursive: true });

    const safeRequestKey = sanitizeFileName(requestKey);
    const audioPath = path.join(uploadDir, `${safeRequestKey}-shader-audio${audioExtension(audioFile.name)}`);
    const capturePath = path.join(uploadDir, `${safeRequestKey}-shader-capture${videoExtension(shaderCaptureFile.name)}`);
    await Promise.all([
      writeFile(audioPath, Buffer.from(await audioFile.arrayBuffer())),
      writeFile(capturePath, Buffer.from(await shaderCaptureFile.arrayBuffer())),
    ]);

    const probeFn = async (filePath: string) => {
      const result = await probeMediaFile(filePath);
      return { duration: result.duration, hasVideo: result.hasVideo, hasAudio: result.hasAudio };
    };

    const asset = await generateShaderCaptureMp4Export({
      requestKey,
      audioPath,
      shaderCapturePath: capturePath,
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
        downloadFileName: asset.downloadFileName,
        hasAudio: asset.hasAudio,
        hasVideo: asset.hasVideo,
        shaderRenderSource: "browser-webgpu-capture",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown shader capture export error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "export";
}

function audioExtension(name: string) {
  return name.match(/\.(wav|mp3|m4a|aac|aif|aiff|flac)$/i)?.[0] ?? ".wav";
}

function videoExtension(name: string) {
  return name.match(/\.(webm|mp4|mov|m4v|mkv)$/i)?.[0] ?? ".webm";
}
