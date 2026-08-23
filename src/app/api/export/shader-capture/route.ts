import { uploadFileToMediaGateway } from "@/lib/mediaGateway";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { triggerShaderCaptureExport } from "@/lib/triggerOrchestration";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to run shader exports.");
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio");
    const shaderCaptureFile = formData.get("shaderCapture");
    const requestKey = String(formData.get("requestKey") || `webgpu-final-export-${Date.now()}`);
    if (!(audioFile instanceof File)) return Response.json({ success: false, error: "Master audio file is required." }, { status: 400 });
    if (!(shaderCaptureFile instanceof File)) return Response.json({ success: false, error: "Shader capture video file is required." }, { status: 400 });

    const folder = `media-uploads/export-inputs/${sanitize(requestKey)}`;
    const [audioUpload, captureUpload] = await Promise.all([
      uploadFileToMediaGateway({ file: audioFile, folder }),
      uploadFileToMediaGateway({ file: shaderCaptureFile, folder }),
    ]);
    const handle = await triggerShaderCaptureExport({
      requestKey,
      audio: { bucket: audioUpload.bucket, objectKey: audioUpload.objectKey, fileName: audioFile.name, mimeType: audioFile.type || "audio/wav" },
      shaderCapture: { bucket: captureUpload.bucket, objectKey: captureUpload.objectKey, fileName: shaderCaptureFile.name, mimeType: shaderCaptureFile.type || "video/webm" },
    });
    return Response.json({ success: true, queued: true, orchestration: "trigger.dev", runId: handle.id, requestKey }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shader capture export failed.";
    return Response.json({ success: false, error: message }, { status: /not configured|Missing RustFS/i.test(message) ? 503 : 500 });
  }
}

function sanitize(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "export";
}
