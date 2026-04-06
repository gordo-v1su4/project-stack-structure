import { readFile } from "node:fs/promises";
import path from "node:path";

import { resolveAllowedPreviewAssetPath } from "@/components/studio/previewAssetPath";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const assetKey = url.searchParams.get("assetKey");

  if (!assetKey) {
    return Response.json({ success: false, error: "Missing assetKey query parameter." }, { status: 400 });
  }

  const assetPath = resolveAllowedPreviewAssetPath(assetKey);
  if (!assetPath) {
    return Response.json({ success: false, error: "Preview asset path is not allowed." }, { status: 400 });
  }

  try {
    const file = await readFile(assetPath);
    return new Response(file, {
      headers: {
        "content-type": getPreviewContentType(assetPath),
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown preview asset read error";
    const status = /no such file|ENOENT/i.test(message) ? 404 : 500;
    return Response.json({ success: false, error: message }, { status });
  }
}

function getPreviewContentType(assetPath: string) {
  switch (path.extname(assetPath).toLowerCase()) {
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    default:
      return "application/octet-stream";
  }
}
