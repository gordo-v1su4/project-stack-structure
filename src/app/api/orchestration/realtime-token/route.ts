import { auth as triggerAuth } from "@trigger.dev/sdk";

import { auth as applicationAuth } from "@/auth";
import { assertTriggerConfigured } from "@/lib/triggerOrchestration";
import { workActivityReadScopeForUser, workActivityTagForUser } from "@/lib/workActivityAuth";

export const runtime = "nodejs";

export async function GET() {
  const session = await applicationAuth();
  const userId = session?.user?.id?.trim();
  if (!userId) {
    return Response.json(
      { success: false, error: "Sign in with GitHub to view work activity." },
      { status: 401 },
    );
  }

  assertTriggerConfigured();
  const accessToken = await triggerAuth.createPublicToken({
    scopes: workActivityReadScopeForUser(userId),
    realtime: { skipColumns: ["payload", "output"] },
    expirationTime: "15m",
  });
  return Response.json({
    success: true,
    accessToken,
    baseURL: process.env.TRIGGER_API_URL!.trim().replace(/\/+$/, ""),
    tag: workActivityTagForUser(userId),
    expiresAt: Date.now() + 15 * 60 * 1_000,
  });
}
