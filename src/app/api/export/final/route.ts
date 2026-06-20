export const runtime = "nodejs";

interface ExportRequestSegment {
  sourceIndex?: number;
  startTime: number;
  endTime: number;
  musicStart?: number;
  musicEnd?: number;
  label?: string;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio");
    const segmentsRaw = formData.get("segments");
    const cuesRaw = formData.get("shaderCues");
    const beatsRaw = formData.get("beats");
    const lyricChunksRaw = formData.get("lyricChunks");
    const shaderPresetId = String(formData.get("shaderPresetId") || "balanced-music-video");
    const requestKey = String(formData.get("requestKey") || `final-export-${Date.now()}`);

    if (!(audioFile instanceof File)) {
      return Response.json({ success: false, error: "Master audio file is required." }, { status: 400 });
    }

    if (!segmentsRaw) {
      return Response.json({ success: false, error: "Export segments are required." }, { status: 400 });
    }

    const inputFiles = await readInputVideoFiles(formData);
    if (!inputFiles.length) {
      return Response.json({ success: false, error: "At least one source video file is required." }, { status: 400 });
    }

    const parsedSegments = JSON.parse(String(segmentsRaw)) as ExportRequestSegment[];
    if (!Array.isArray(parsedSegments) || parsedSegments.length === 0) {
      return Response.json({ success: false, error: "No export segments provided." }, { status: 400 });
    }

    const [{ mkdir, writeFile }, os, path, { generateMusicVideoExport }, { probeMediaFile }] = await Promise.all([
      import("node:fs/promises"),
      import("node:os"),
      import("node:path"),
      import("@/components/studio/exportGeneration"),
      import("@/components/studio/mediaProbe"),
    ]);

    const uploadDir = path.join(os.tmpdir(), "project-stack-structure-final-export");
    await mkdir(uploadDir, { recursive: true });

    const audioPath = path.join(uploadDir, `${sanitizeFileName(requestKey)}-audio${audioExtension(audioFile.name)}`);
    await writeFile(audioPath, Buffer.from(await audioFile.arrayBuffer()));

    const inputPaths = await Promise.all(inputFiles.map(async (inputFile, index) => {
      const inputPath = path.join(uploadDir, `${sanitizeFileName(requestKey)}-${index}${videoExtension(inputFile.name)}`);
      await writeFile(inputPath, Buffer.from(await inputFile.arrayBuffer()));
      return inputPath;
    }));

    const probeFn = async (filePath: string) => {
      const result = await probeMediaFile(filePath);
      return { duration: result.duration, hasVideo: result.hasVideo, hasAudio: result.hasAudio };
    };

    const asset = await generateMusicVideoExport({
      requestKey,
      audioPath,
      segments: parsedSegments.map((segment) => ({
        inputPath: inputPaths[segment.sourceIndex ?? 0] ?? inputPaths[0]!,
        startTime: segment.startTime,
        endTime: segment.endTime,
        musicStart: segment.musicStart,
        musicEnd: segment.musicEnd,
        label: segment.label,
      })),
      effectCues: cuesRaw ? JSON.parse(String(cuesRaw)) : undefined,
      beats: beatsRaw ? JSON.parse(String(beatsRaw)) : undefined,
      lyricChunks: lyricChunksRaw ? JSON.parse(String(lyricChunksRaw)) : undefined,
      shaderPresetId,
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
        effectCues: asset.effectCues,
        effectFilter: asset.effectFilter,
        shaderPresetId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown final export error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}

async function readInputVideoFiles(formData: FormData): Promise<File[]> {
  return [...formData.entries()]
    .map(([key, value]) => {
      const match = key.match(/^file:(\d+)$/);
      if (!match || !(value instanceof File)) return null;
      return { index: Number(match[1]), file: value };
    })
    .filter((entry): entry is { index: number; file: File } => entry !== null)
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.file);
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "export";
}

function audioExtension(name: string) {
  return name.match(/\.(wav|mp3|m4a|aac|aif|aiff|flac)$/i)?.[0] ?? ".wav";
}

function videoExtension(name: string) {
  return name.match(/\.(mp4|mov|m4v|webm|mkv)$/i)?.[0] ?? ".mp4";
}
