import { parseStoryTreatmentRequest } from "@/components/studio/storyTreatments";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { isStoryTreatmentConfigured } from "@/lib/storyTreatmentGateway";
import { generateStoryTreatments } from "@/lib/storyTreatmentServer";
import type { SessionUser } from "@/lib/session";
import type { StoryTreatmentGenerationResult, StoryTreatmentRequest } from "@/components/studio/storyTreatments";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  return handleStoryTreatmentsPost(request);
}

export async function handleStoryTreatmentsPost(request: Request, dependencies: {
  getUser?: () => Promise<SessionUser | null>;
  generate?: (input: StoryTreatmentRequest) => Promise<StoryTreatmentGenerationResult>;
  isConfigured?: boolean;
} = {}) {
  const user = await (dependencies.getUser ?? getSessionUser)();
  if (!user) return unauthorizedResponse("Sign in with GitHub to generate story treatments.");
  const configured = dependencies.isConfigured ?? isStoryTreatmentConfigured();
  if (!configured) {
    return Response.json({
      success: false,
      error: "Story generation is not configured. Set SCENE_CAPTION_SMART_GATEWAY_URL and Trigger.dev credentials.",
    }, { status: 503 });
  }

  let input: StoryTreatmentRequest;
  try {
    input = parseStoryTreatmentRequest(await request.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Story treatment request is invalid.";
    return Response.json({ success: false, error: message }, { status: 400 });
  }

  try {
    const result = await (dependencies.generate ?? generateStoryTreatments)(input);
    return Response.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Story treatment generation failed.";
    return Response.json({ success: false, error: message }, { status: 502 });
  }
}
