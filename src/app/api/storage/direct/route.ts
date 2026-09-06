import { DirectUploadError, finishDirectUpload, startDirectUpload } from "@/lib/directStorageUpload";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to upload media.");
  try {
    const raw = await request.text();
    if (raw.length > 12000) throw new DirectUploadError("Upload metadata is too large.");
    let payload;
    try { payload = JSON.parse(raw); } catch { throw new DirectUploadError("Valid upload metadata is required."); }
    if (!payload || typeof payload !== "object") throw new DirectUploadError("Valid upload metadata is required.");
    const result = payload.action === "start" ? await startDirectUpload(payload, user.id)
      : payload.action === "complete" || payload.action === "abort"
        ? await finishDirectUpload(payload.token, user.id, payload.action === "abort")
        : null;
    if (!result) throw new DirectUploadError("Unknown upload action.");
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // SDK errors may include signed URLs; do not return or log their details.
    return Response.json({ error: error instanceof DirectUploadError ? error.message : "Storage upload failed. Please retry." },
      { status: error instanceof DirectUploadError ? error.status : 502 });
  }
}
