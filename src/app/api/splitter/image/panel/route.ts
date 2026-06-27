import { buildImageSplitterPanelSourceUrl, getImageSplitterBaseUrl } from "@/lib/imageSplitterGateway";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const splitId = url.searchParams.get("splitId")?.trim();
    const assetPath = url.searchParams.get("assetPath")?.trim();
    if (!splitId || !assetPath) {
      return Response.json({ error: "splitId and assetPath are required." }, { status: 400 });
    }

    const response = await fetch(buildImageSplitterPanelSourceUrl(getImageSplitterBaseUrl(), splitId, assetPath));
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return Response.json({ error: `Image splitter panel fetch failed (${response.status}): ${text.slice(0, 300)}` }, { status: response.status });
    }

    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "image/png",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image splitter panel fetch failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
