import { getHiggsfieldAccount } from "@/lib/higgsfieldGateway";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to check generation providers.");
  try {
    await getHiggsfieldAccount();
    return Response.json({ success: true, configured: true });
  } catch {
    return Response.json({ success: true, configured: false });
  }
}

export async function POST(request: Request) {
  void request;
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse();
  // Old clients cannot bypass exact-job quote and approval checks.
  return Response.json({ success: false, error: "Use the storyboard planner to quote and explicitly approve generation." }, { status: 409 });
}
