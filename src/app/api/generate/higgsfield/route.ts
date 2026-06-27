import { createNanoBananaProGrid, getHiggsfieldAccount, type HiggsfieldInputImage, type HiggsfieldResolution } from "@/lib/higgsfieldGateway";

export const runtime = "nodejs";

export async function GET() {
  try {
    const account = await getHiggsfieldAccount();
    return Response.json({ success: true, account });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Higgsfield account check failed";
    return Response.json({ success: false, error: message }, { status: /Missing Higgsfield auth/i.test(message) ? 503 : 502 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      prompt?: unknown;
      title?: unknown;
      characterName?: unknown;
      aspectRatio?: unknown;
      resolution?: unknown;
      inputImages?: unknown;
      splitRows?: unknown;
      splitCols?: unknown;
    };

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return Response.json({ success: false, error: "prompt is required" }, { status: 400 });
    const inputImages = normalizeInputImages(body.inputImages);
    if (!inputImages.length) return Response.json({ success: false, error: "At least one input image URL is required." }, { status: 400 });

    const asset = await createNanoBananaProGrid({
      prompt,
      inputImages,
      characterName: typeof body.characterName === "string" ? body.characterName.trim() : undefined,
      title: typeof body.title === "string" ? body.title.trim() : undefined,
      aspectRatio: typeof body.aspectRatio === "string" && body.aspectRatio.trim() ? body.aspectRatio.trim() : "16:9",
      resolution: normalizeResolution(body.resolution),
      splitRows: normalizeInt(body.splitRows, 1, 24) ?? 3,
      splitCols: normalizeInt(body.splitCols, 1, 24) ?? 3,
    });

    return Response.json({ success: true, asset });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Higgsfield generation failed";
    return Response.json({ success: false, error: message }, { status: 502 });
  }
}

function normalizeInputImages(value: unknown): HiggsfieldInputImage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url.trim() : "";
    if (!url) return [];
    return [{
      id: typeof record.id === "string" ? record.id.trim() : undefined,
      url,
      type: record.type === "media_input" ? "media_input" : undefined,
      label: typeof record.label === "string" ? record.label.trim() : undefined,
    }];
  });
}

function normalizeResolution(value: unknown): HiggsfieldResolution {
  return value === "1k" || value === "4k" ? value : "2k";
}

function normalizeInt(value: unknown, min: number, max: number) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) return undefined;
  return Math.min(max, Math.max(min, Math.trunc(numeric)));
}
