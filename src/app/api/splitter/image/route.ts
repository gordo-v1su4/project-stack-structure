import { triggerImageSplitter } from "@/lib/triggerOrchestration";
import { uploadFileToMediaGateway } from "@/lib/mediaGateway";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";

export const runtime = "nodejs";

const MAX_SPLIT_IMAGE_BYTES = 50 * 1024 * 1024;

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to split images.");
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "Image file is required." }, { status: 400 });
    }
    if (file.size > MAX_SPLIT_IMAGE_BYTES) {
      return Response.json({ error: "Image exceeds the maximum allowed size." }, { status: 413 });
    }

    const rows = readNumber(formData.get("rows"));
    const cols = readNumber(formData.get("cols"));
    if (!rows || !cols) {
      return Response.json({ error: "Fixed image splitting requires rows and cols." }, { status: 400 });
    }

    const source = await uploadFileToMediaGateway({
      file,
      folder: "media-uploads/generated/image-splits/sources",
    });
    const handle = await triggerImageSplitter({
      bucket: source.bucket,
      objectKey: source.objectKey,
      fileName: file.name || "source-image.png",
      mimeType: file.type || source.mime,
      options: {
        mode: "fixed",
        rows,
        cols,
        gutterPx: readNumber(formData.get("gutter_px") ?? formData.get("gutterPx")),
      },
    });

    return Response.json({ success: true, orchestration: "trigger.dev", runId: handle.id, status: "queued" }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image split failed";
    return Response.json({ error: message }, { status: /Image file is required/i.test(message) ? 400 : 502 });
  }
}

function readNumber(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
