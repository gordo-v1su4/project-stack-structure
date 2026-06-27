import { splitImageWithGateway, uploadImageSplitPanelsToMediaGateway } from "@/lib/imageSplitterGateway";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "Image file is required." }, { status: 400 });
    }

    const rows = readNumber(formData.get("rows"));
    const cols = readNumber(formData.get("cols"));
    if (!rows || !cols) {
      return Response.json({ error: "Fixed image splitting requires rows and cols." }, { status: 400 });
    }

    const split = await splitImageWithGateway({
      file,
      options: {
        mode: "fixed",
        rows,
        cols,
        gutterPx: readNumber(formData.get("gutter_px") ?? formData.get("gutterPx")),
      },
    });
    const persisted = await uploadImageSplitPanelsToMediaGateway({ split });

    return Response.json({ success: true, ...persisted });
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
