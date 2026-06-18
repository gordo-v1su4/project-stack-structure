import { getMediaGatewayVideoJobResult } from "@/lib/mediaGateway";

export const runtime = "nodejs";

type Params = { params: Promise<{ jobId: string }> };

export async function GET(_request: Request, context: Params) {
  try {
    const { jobId } = await context.params;
    const result = await getMediaGatewayVideoJobResult({ jobId });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Video job result failed";
    const status = /Missing RustFS media gateway env/i.test(message) ? 503 : /409/.test(message) ? 409 : /404/.test(message) ? 404 : 500;
    return Response.json({ error: message }, { status });
  }
}
