import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";

// `secret` をここで渡さない（空文字がビルドに埋め込まれると MissingSecret になるため）。
// next-auth が setEnvDefaults で AUTH_SECRET / NEXTAUTH_SECRET を読む。
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        try {
          const email = credentials?.email;
          const password = credentials?.password;

          if (typeof email !== "string" || typeof password !== "string") {
            return null;
          }

          const emailNorm = email.trim().toLowerCase();
          if (!emailNorm) {
            return null;
          }

          // パスワードルール: 8〜128文字、英字＋数字を含む
          const isValidFormat =
            typeof password === "string" &&
            password.length >= 8 &&
            password.length <= 128 &&
            /[A-Za-z]/.test(password) &&
            /[0-9]/.test(password);

          if (!isValidFormat) {
            return null;
          }

          const [{ prisma }, { verifyPassword }] = await Promise.all([
            import("@/lib/prisma"),
            import("@/lib/auth"),
          ]);

          const user = await prisma.user.findUnique({
            where: { email: emailNorm },
          });

          if (!user) {
            return null;
          }

          const isValid = await verifyPassword(password, user.password);
          if (!isValid) {
            return null;
          }

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
          };
        } catch (err) {
          console.error("[auth] Credentials authorize failed:", err);
          return null;
        }
      },
    }),
  ],
});
