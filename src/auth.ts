import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";
import { authRedirectProxyUrl, canonicalAuthRedirect } from "@/lib/authRequest";

const configuredAuthUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;

export const authConfig = {
  providers: [GitHub],
  redirectProxyUrl: authRedirectProxyUrl(configuredAuthUrl),
  session: { strategy: "jwt" },
  callbacks: {
    redirect({ url, baseUrl }) {
      return canonicalAuthRedirect(url, baseUrl, configuredAuthUrl);
    },
    jwt({ token, profile }) {
      if (profile?.id !== undefined) token.ownerId = `github-${profile.id}`;
      if (typeof profile?.login === "string") token.login = profile.login;
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = typeof token.ownerId === "string" ? token.ownerId : token.sub ?? "";
        session.user.login = typeof token.login === "string" ? token.login : undefined;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
