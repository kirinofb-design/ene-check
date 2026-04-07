import type { NextAuthConfig } from "next-auth";

/**
 * Edge 互換（Prisma / bcrypt を含まない）。middleware のみここを参照する。
 * 実際の Credentials authorize は auth.ts で定義する。
 */
export const authConfig = {
  trustHost: true,
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as { id?: string }).id;
        (token as { role?: string }).role = (user as { role?: string }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = (token as { id?: string }).id;
        (session.user as { role?: string }).role = (token as { role?: string })
          .role;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
