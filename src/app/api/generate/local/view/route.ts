import { normalizeLocalGenerationUrl } from "@/components/studio/localGeneration";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider") ?? "swarmui";
  if (provider !== "swarmui") {
    return Response.json({ error: "SwarmUI is the only supported local asset provider." }, { status: 400 });
  }

  const target = buildSwarmViewUrl(searchParams);
  if (!target) return Response.json({ error: "missing generation asset reference" }, { status: 400 });

  const upstream = await fetch(target);
  if (!upstream.ok) {
    const text = await upstream.text();
    return Response.json({ error: `Generation asset fetch failed: ${text.slice(0, 200)}` }, { status: upstream.status });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? inferContentType(target),
      "Cache-Control": "no-store",
    },
  });
}

function buildSwarmViewUrl(searchParams: URLSearchParams) {
  const path = searchParams.get("path");
  if (!path || path.startsWith("data:")) return null;
  try {
    return new URL(path).toString();
  } catch {
    return `${getSwarmUrl()}/${path.replace(/^\/+/, "")}`;
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
