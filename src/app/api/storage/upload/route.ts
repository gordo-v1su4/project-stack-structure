import { auth } from "@/auth";
import { scopeEssentiaChunkUploadFolder } from "@/lib/essentiaUpload";
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

    const requestedFolder = typeof folder === "string" ? folder : undefined;
    const isEssentiaChunkUpload = requestedFolder?.startsWith("media-uploads/source-audio/chunks/") ?? false;
    const session = isEssentiaChunkUpload ? await auth() : null;
    if (isEssentiaChunkUpload && !session?.user?.id) {
      return Response.json({ error: "Sign in with GitHub to upload audio chunks." }, { status: 401 });
    }
    const uploadFolder = session?.user?.id
      ? scopeEssentiaChunkUploadFolder(requestedFolder, session.user.id)
      : requestedFolder;
    if (isEssentiaChunkUpload && !uploadFolder) {
      return Response.json({ error: "A valid audio chunk upload folder is required." }, { status: 400 });
    }

    const uploaded = await uploadFileToMediaGateway({
      file,
      folder: uploadFolder ?? undefined,
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
