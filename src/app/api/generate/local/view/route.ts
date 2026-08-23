import { normalizeLocalGenerationUrl } from "@/components/studio/localGeneration";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to fetch generation assets.");
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider") ?? "swarmui";
  if (provider !== "swarmui") {
    return Response.json({ error: "SwarmUI is the only supported local asset provider." }, { status: 400 });
  }

  const swarmBase = getSwarmUrl();
  if (!swarmBase) return Response.json({ error: "SwarmUI is not configured." }, { status: 503 });

  const target = buildSwarmViewUrl(searchParams, swarmBase);
  if (!target) return Response.json({ error: "missing generation asset reference" }, { status: 400 });

  const upstream = await fetch(target);
  if (!upstream.ok) {
    return Response.json(
      { error: `Generation asset fetch failed (${upstream.status}).` },
      { status: upstream.status },
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? inferContentType(target),
      "Cache-Control": "no-store",
    },
  });
}

// SECURITY: assets must come from the configured SwarmUI origin only. Resolve the
// caller-supplied reference relative to that base; never accept absolute URLs.
function buildSwarmViewUrl(searchParams: URLSearchParams, swarmBase: string) {
  const path = searchParams.get("path");
  if (!path || path.startsWith("data:") || /^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  try {
    return new URL(path.replace(/^\/+/, ""), `${swarmBase}/`).toString();
  } catch {
    return null;
  }
}

function getSwarmUrl() {
  return normalizeLocalGenerationUrl(process.env.LOCAL_SWARMUI_URL ?? process.env.SWARMUI_URL);
}

function inferContentType(path: string) {
  if (/\.mp4(?:\?|$)/i.test(path)) return "video/mp4";
  if (/\.webm(?:\?|$)/i.test(path)) return "video/webm";
  if (/\.jpe?g(?:\?|$)/i.test(path)) return "image/jpeg";
  if (/\.gif(?:\?|$)/i.test(path)) return "image/gif";
  return "image/png";
}
