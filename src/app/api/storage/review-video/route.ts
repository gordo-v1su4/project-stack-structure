import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { canReadMediaObject } from "@/lib/studioMediaAccess";
import { assertReviewVideoSource, pinReviewVideoSource, readPreparedReviewVideo } from "@/lib/preparedReviewVideoStore";
import { studioMediaStorage } from "@/lib/studioProjectObjectStore";
import { triggerReviewVideo } from "@/lib/triggerOrchestration";

export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store" };

async function handle(request: Request, submit: boolean) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse();
  let input: { bucket?: unknown; objectKey?: unknown; intentId?: unknown };
  try {
    if (submit) {
      if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "JSON is required." }, { status: 415, headers });
      const reader = request.body?.getReader(); if (!reader) throw new Error("Missing body.");
      const chunks: Uint8Array[] = []; let size = 0;
      try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
        if (size > 4096) { await reader.cancel(); throw new Error("Body too large."); } chunks.push(part.value); } }
      finally { reader.releaseLock(); }
      input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!input || typeof input.intentId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.intentId)) throw new Error("Invalid intent.");
    } else {
      const query = new URL(request.url).searchParams; input = { bucket: query.get("bucket"), objectKey: query.get("objectKey") };
    }
    if (typeof input.bucket !== "string" || typeof input.objectKey !== "string") throw new Error("Missing source.");
    assertReviewVideoSource({ ownerId: user.id, bucket: input.bucket, objectKey: input.objectKey, etag: '"validation"', bytes: 1 });
  } catch { return Response.json({ error: "Invalid review-video request." }, { status: 400, headers }); }
  const bucket = input.bucket as string, objectKey = input.objectKey as string;
  try {
    if (bucket !== studioMediaStorage().bucket) return Response.json({ error: "Invalid media bucket." }, { status: 400, headers });
    if (!await canReadMediaObject({ userId: user.id, bucket, objectKey })) return Response.json({ error: "Video does not belong to the current user." }, { status: 403, headers });
    const source = await pinReviewVideoSource(user.id, bucket, objectKey);
    const prepared = await readPreparedReviewVideo(source);
    if (prepared) return Response.json({ status: "ready", prepared }, { headers });
    if (!submit) return Response.json({ status: "unprepared" }, { headers });
    const run = await triggerReviewVideo(source, input.intentId as string);
    return Response.json({ status: "queued", orchestration: "trigger.dev", runId: run.id }, { status: 202, headers });
  } catch {
    return Response.json({ error: "Review media is unavailable; the original clip is unchanged." }, { status: 503, headers });
  }
}
export const GET = (request: Request) => handle(request, false);
export const POST = (request: Request) => handle(request, true);
