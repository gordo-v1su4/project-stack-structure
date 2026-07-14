import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  session: { strategy: "jwt" },
  callbacks: {
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
});
