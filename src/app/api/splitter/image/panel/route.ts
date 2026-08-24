import { buildImageSplitterPanelSourceUrl, buildSplitterRequestHeaders, getImageSplitterBaseUrl } from "@/lib/imageSplitterGateway";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";

export const runtime = "nodejs";

const SAFE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to fetch split panels.");
  try {
    const url = new URL(request.url);
    const splitId = url.searchParams.get("splitId")?.trim() ?? "";
    const assetPath = url.searchParams.get("assetPath")?.trim() ?? "";
    if (!splitId || !assetPath) {
      return Response.json({ error: "splitId and assetPath are required." }, { status: 400 });
    }
    if (!SAFE_SEGMENT.test(splitId)) {
      return Response.json({ error: "Invalid splitId." }, { status: 400 });
    }
    if (assetPath.split("/").some((segment) => !segment || segment === "." || segment === ".." || !SAFE_SEGMENT.test(segment))) {
      return Response.json({ error: "Invalid assetPath." }, { status: 400 });
    }

    const response = await fetch(buildImageSplitterPanelSourceUrl(getImageSplitterBaseUrl(), splitId, assetPath), {
      headers: await buildSplitterRequestHeaders(),
    });
    if (!response.ok) {
      return Response.json(
        { error: `Image splitter panel fetch failed (${response.status}).` },
        { status: response.status },
      );
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
