import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { getMediaGatewayConfig } from "@/lib/mediaGateway";
import { estimateHiggsfieldImageCredits } from "@/lib/higgsfieldGateway";
import { triggerHiggsfieldGeneration } from "@/lib/triggerOrchestration";
import { signStoryboardApproval, storyboardJobHash, validateStoryboardJob, verifyStoryboardApproval } from "@/lib/storyboardApproval";
import { IMAGE_MODELS } from "@/components/studio/storyboardGeneration";

export const runtime = "nodejs";
export const maxDuration = 60;

function allowedHosts() {
  return [getMediaGatewayConfig()?.url, process.env.MEDIA_GATEWAY_PUBLIC_URL,
    ...(process.env.HIGGSFIELD_ALLOWED_IMAGE_HOSTS ?? "").split(",")].flatMap((value) => {
      try { return value?.trim() ? [new URL(value.includes("://") ? value.trim() : `https://${value.trim()}`).host] : []; }
      catch { return []; }
    });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in to review generation costs and approvals.");
  try {
    const body = await request.json();
    const job = validateStoryboardJob(body.job, allowedHosts());
    const secret = process.env.AUTH_SECRET;
    if (!secret) return Response.json({ error: "Approval signing is not configured." }, { status: 503 });
    if (body.action === "quote") {
      let credits: number | null = null;
      if (job.billing === "api-credits") {
        try { credits = await estimateHiggsfieldImageCredits(job.model, job.prompt); } catch { /* Fail closed on submit. */ }
      }
      const signed = signStoryboardApproval(job, user.id, credits ?? 0, secret);
      return Response.json({ ...signed, credits, guideUsd: IMAGE_MODELS[job.model].guideUsd2k });
    }
    if (body.action !== "submit" || body.approved !== true || typeof body.token !== "string") {
      return Response.json({ error: "Explicit approval of this exact job is required." }, { status: 409 });
    }
    if (job.billing !== "api-credits") return Response.json({ error: "Subscription jobs are manual handoffs, never API submissions." }, { status: 409 });
    const approval = verifyStoryboardApproval(body.token, job, user.id, secret);
    const currentCredits = await estimateHiggsfieldImageCredits(job.model, job.prompt);
    if (currentCredits === null || currentCredits > approval.credits) return Response.json({ error: "Provider cost is unavailable or increased. Review a new quote." }, { status: 409 });
    const handle = await triggerHiggsfieldGeneration({
      model: job.model, approvalKey: storyboardJobHash(job), title: job.title, prompt: job.prompt,
      inputImages: job.references.map(({ url, label }) => ({ url, label })),
      resolution: "2k", aspectRatio: "16:9",
      // No splitter, edit, retouch or upscale step for a fresh standalone image.
      splitRows: job.kind === "grid" ? 3 : undefined,
      splitCols: job.kind === "grid" ? 3 : undefined,
    });
    return Response.json({ runId: handle.id, status: "queued", credits: currentCredits }, { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Generation approval failed." }, { status: 400 });
  }
}
