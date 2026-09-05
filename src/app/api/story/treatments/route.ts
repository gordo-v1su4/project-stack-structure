import { parseStoryTreatmentRequest } from "@/components/studio/storyTreatments";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { generateStoryTreatments } from "@/lib/storyTreatmentServer";
import type { SessionUser } from "@/lib/session";
import type { StoryTreatmentGenerationResult, StoryTreatmentRequest } from "@/components/studio/storyTreatments";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  return handleStoryTreatmentsPost(request);
}

export async function handleStoryTreatmentsPost(request: Request, dependencies: {
  getUser?: () => Promise<SessionUser | null>;
  generate?: (input: StoryTreatmentRequest) => Promise<StoryTreatmentGenerationResult>;
  apiKey?: string | null;
} = {}) {
  const user = await (dependencies.getUser ?? getSessionUser)();
  if (!user) return unauthorizedResponse("Sign in with GitHub to generate story treatments.");
  const apiKey = dependencies.apiKey === undefined ? process.env.OPENAI_API_KEY : dependencies.apiKey;
  if (!apiKey) {
    return Response.json({ success: false, error: "Story generation is not configured." }, { status: 503 });
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
