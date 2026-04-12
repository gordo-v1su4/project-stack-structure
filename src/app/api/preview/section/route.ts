import { generateConcatPreview, generateSectionPreview, type ProbeFn } from "@/components/studio/previewGeneration";
import type { ConcatPreviewSegment } from "@/components/studio/previewGeneration";

export const runtime = "nodejs";

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

async function getProbeFn(): Promise<ProbeFn> {
  const { probeMediaFile } = await import("@/components/studio/mediaProbe");
  return async (filePath: string) => {
    const result = await probeMediaFile(filePath);
    return { duration: result.duration, hasVideo: result.hasVideo };
  };
}

async function getDefaultInputPath() {
  const { listMediaFixtures } = await import("@/components/studio/mediaProbe");
  const inventory = listMediaFixtures();
  return inventory.video[0];
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as PreviewSectionRequest;
    const [probeFn, defaultInputPath] = await Promise.all([getProbeFn(), getDefaultInputPath()]);

    if (payload.segments && payload.segments.length > 0) {
      const segments: ConcatPreviewSegment[] = payload.segments.map((segment) => ({
        inputPath: segment.inputPath || defaultInputPath || "",
        startTime: segment.startTime ?? 0,
        endTime: segment.endTime ?? 1,
      }));

      const asset = await generateConcatPreview({
        segments,
        requestKey: payload.requestKey ?? `preview-${Date.now()}`,
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
      requestKey: payload.requestKey ?? `preview-${Date.now()}`,
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
