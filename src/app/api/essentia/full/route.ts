import { uploadFileToMediaGateway } from "@/lib/mediaGateway";
import { triggerEssentiaAnalysis } from "@/lib/triggerOrchestration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const mode = new URL(request.url).searchParams.get("mode") === "full" ? "full" : "fast";
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "Audio file is required." }, { status: 400 });
    }

    const uploaded = await uploadFileToMediaGateway({
      file,
      folder: "media-uploads/source-audio",
    });
    const handle = await triggerEssentiaAnalysis({
      bucket: uploaded.bucket,
      objectKey: uploaded.objectKey,
      sourceLabel: file.name,
      mode,
    });

    return Response.json({
      orchestration: "trigger.dev",
      runId: handle.id,
      status: "queued",
      storage: {
        storageProvider: "rustfs",
        storageBucket: uploaded.bucket,
        storagePath: uploaded.objectKey,
        storageUrl: uploaded.mediaUrl || uploaded.publicUrl,
        storageStatus: "uploaded",
        storageError: null,
      },
    }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Essentia orchestration failed";
    const status = /not configured|Missing RustFS media gateway env/i.test(message) ? 503 : 500;
    return Response.json({ error: message }, { status });
  }
}
