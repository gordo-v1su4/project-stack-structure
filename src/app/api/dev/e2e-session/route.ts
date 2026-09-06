import { encode } from "@auth/core/jwt";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Development-only session bootstrap for local fixture review in a fresh browser
 * (Cursor embedded browser, Playwright, etc.) without OAuth redirect setup.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ success: false, error: "AUTH_SECRET is not configured." }, { status: 500 });
  }

  const ownerId = process.env.STACK_STRUCTURE_E2E_USER_ID?.trim() || "github-e2e-local";
  const login = process.env.STACK_STRUCTURE_E2E_LOGIN?.trim() || "e2e-local";
  const token = await encode({
    token: {
      sub: ownerId,
      ownerId,
      login,
      name: login,
    },
    secret,
    salt: "authjs.session-token",
  });

  const redirectTarget = new URL("/", request.url);
  (await cookies()).set("authjs.session-token", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: redirectTarget.protocol === "https:",
  });
  return NextResponse.redirect(redirectTarget);
}
