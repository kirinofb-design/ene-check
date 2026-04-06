import bcrypt from "bcryptjs";
import type { Session } from "next-auth";
import { auth } from "@/auth";

export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 10;
  return bcrypt.hash(password, saltRounds);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// 認証済みセッションを取得（未ログイン時は null）
export async function getServerSession(): Promise<Session | null> {
  return auth();
}

// 未認証ならエラーを投げる（API 用）
export async function requireAuth(request?: Request): Promise<Session> {
  // Route Handler では Request を渡すと環境によってセッション解決が不安定になることがあるため、
  // 引数は受け取るが常に auth()（引数なし）でセッションを解決する。
  // ※ middleware 側で保護する/同一オリジン Cookie を前提にする。
  void request;
  const session = await auth();
  if (!session || !session.user) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}

