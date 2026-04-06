import { listMediaFixtures } from "@/components/studio/mediaProbe";
import { generateSectionPreview } from "@/components/studio/previewGeneration";

export const runtime = "nodejs";

interface PreviewSectionRequest {
  inputPath?: string;
  requestKey?: string;
  startTime?: number;
  endTime?: number;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as PreviewSectionRequest;
    const inventory = listMediaFixtures();
    const inputPath = payload.inputPath ?? inventory.video[0];

    if (!inputPath) {
      return Response.json({ success: false, error: "No video fixture available for preview generation." }, { status: 400 });
    }

    const asset = await generateSectionPreview({
      inputPath,
      requestKey: payload.requestKey ?? `preview-${Date.now()}`,
      startTime: payload.startTime ?? 0,
      endTime: payload.endTime ?? 1,
    });

    return Response.json({ success: true, asset });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown preview generation error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
