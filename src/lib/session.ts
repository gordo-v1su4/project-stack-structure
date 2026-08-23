import { auth } from "@/auth";

export type SessionUser = {
  id: string;
  login?: string;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const id = session?.user?.id?.trim();
  if (!id || !session) return null;
  return { id, login: session.user.login };
}

export function unauthorizedResponse(message = "Sign in with GitHub to use this endpoint.") {
  return Response.json({ success: false, error: message }, { status: 401 });
}
