import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { getMediaGatewayConfig, uploadFileToMediaGateway } from "@/lib/mediaGateway";
import { splitImageWithGateway, uploadImageSplitPanelsToMediaGateway } from "@/lib/imageSplitterGateway";
import { validateStoryboardJob } from "@/lib/storyboardApproval";
import { verifyStandalone2kImage } from "@/lib/storyboardImageMetadata";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse();
  try {
    const body = await request.json();
    const hosts = [getMediaGatewayConfig()?.url, process.env.MEDIA_GATEWAY_PUBLIC_URL,
      ...(process.env.HIGGSFIELD_ALLOWED_IMAGE_HOSTS ?? "").split(",")].flatMap((value) => {
        try { return value?.trim() ? [new URL(value.includes("://") ? value.trim() : `https://${value.trim()}`).host] : []; } catch { return []; }
      });
    const job = validateStoryboardJob(body.job, hosts);
    const url = new URL(body.url);
    if (url.protocol !== "https:" || url.username || url.password || !hosts.includes(url.host)) throw new Error("Upload the image to the configured RustFS storage first.");
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
    const mime = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!response.ok || !["image/png", "image/jpeg", "image/webp"].includes(mime)) throw new Error("The URL must return a PNG, JPEG or WebP image.");
    const maxBytes = 32 * 1024 * 1024;
    if (Number(response.headers.get("content-length")) > maxBytes) throw new Error("Image exceeds 32 MB.");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty image.");
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error("Image exceeds 32 MB."); }
      chunks.push(new Uint8Array(value));
    }
    const extension = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
    const file = new File(chunks, `storyboard-return.${extension}`, { type: mime });
    const dimensions = await verifyStandalone2kImage(file);
    const fullStorage = await uploadFileToMediaGateway({ file, folder: `media-uploads/generated/storyboards/${user.id}/${crypto.randomUUID()}` });
    const split = job.kind === "grid"
      ? (await uploadImageSplitPanelsToMediaGateway({ split: await splitImageWithGateway({ file, options: { mode: "fixed", rows: 3, cols: 3, gutterPx: 0 } }) })).manifest
      : undefined;
    return Response.json({ asset: { id: `manual:${job.id}`, provider: "higgsfield", model: job.model,
      title: job.title, prompt: job.prompt, createdAt: new Date().toISOString(), status: "completed",
      mediaKind: "image", resolution: "2k", aspectRatio: "16:9", ...dimensions, fullStorage, split, reviewStatus: "pending" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Image return failed." }, { status: 400 });
  }
}
