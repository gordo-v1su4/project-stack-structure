import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { readStudioProject } from "@/lib/studioProjectStore";
import { getMediaGatewayConfig } from "@/lib/mediaGateway";
import { validateSavedGenerationScope } from "@/lib/generationScopeServer";
import { H3RequestError, materializeH3Job, parseH3Request } from "@/lib/h3GenerationServer";
import { pinH3JobReferences } from "@/lib/h3JobStore";
import { sourceConfirmationBaselineSha256 } from "@/components/studio/sourceConfirmationClient";
import { registerNativeFirstFrame, readNativeFirstFrameReceipt, readNativeFirstFrameReceiptForJob } from "@/lib/nativeFirstFrameSource";
export const runtime = "nodejs";
const failure = (error: unknown) => Response.json({ error: error instanceof H3RequestError ? error.message : "Exact native-source verification is unavailable. No generation was submitted." }, { status: error instanceof H3RequestError ? error.status : 503, headers: { "cache-control": "no-store" } });
export async function POST(request: Request) {
  const user = await getSessionUser(); if (!user) return unauthorizedResponse();
  try {
    const text = await request.text(); if (text.length > 24000) throw new H3RequestError("Native-source metadata exceeds its bound.");
    const input = JSON.parse(text), shot = parseH3Request(input.shot);
    if (shot.conditioning || !["sface-yunet-joint-frontal-v2", "sface-yunet-foreground-frontal-v2"].includes(shot.identityPolicyFamily ?? "")) throw new H3RequestError("Choose a frontal v2 shot before freezing its native source.");
    const saved = await readStudioProject(user.id, shot.projectId, { fresh: true }), config = getMediaGatewayConfig();
    if (!saved?.revision || !config) throw new H3RequestError("Reload the owned saved project before freezing this frame.", 409);
    await validateSavedGenerationScope(user.id, saved);
    const target = await pinH3JobReferences(materializeH3Job(user.id, saved, shot, config.bucket));
    const baselineSha256 = sourceConfirmationBaselineSha256(saved.draft);
    const isCurrent = async () => { const fresh = await readStudioProject(user.id, shot.projectId, { fresh: true });
      return Boolean(fresh && fresh.revision === saved.revision && sourceConfirmationBaselineSha256(fresh.draft) === baselineSha256); };
    const result = await registerNativeFirstFrame({ ownerId: user.id, saved, target, shot, source: input.source, upload: input.upload,
      expectedSha256: input.expectedSha256, baselineSha256, isCurrent });
    return Response.json({ success: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return failure(error); }
}
export async function GET(request: Request) {
  const user = await getSessionUser(); if (!user) return unauthorizedResponse();
  try {
    const query = new URL(request.url).searchParams, projectId = query.get("projectId"), id = query.get("receiptId"), jobId = query.get("jobId");
    if (!projectId || !(id || jobId) || !await readStudioProject(user.id, projectId, { fresh: true })) throw new H3RequestError("Project not found.", 404);
    const receipt = id ? await readNativeFirstFrameReceipt(user.id, projectId, id) : await readNativeFirstFrameReceiptForJob(user.id, projectId, jobId!);
    if (!receipt) throw new H3RequestError("Native-source receipt not found.", 404);
    return Response.json({ success: true, sourceReceipt: receipt }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return failure(error); }
}
