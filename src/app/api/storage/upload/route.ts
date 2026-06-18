import { uploadFileToMediaGateway } from "@/lib/mediaGateway";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const folder = formData.get("folder");

    if (!(file instanceof File)) {
      return Response.json({ error: "file required" }, { status: 400 });
    }

    const uploaded = await uploadFileToMediaGateway({
      file,
      folder: typeof folder === "string" ? folder : undefined,
    });

    return Response.json({
      storageProvider: "rustfs",
      ...uploaded,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    const status = /Missing RustFS media gateway env/i.test(message) ? 503 : 500;
    return Response.json({ error: message }, { status });
  }
}
