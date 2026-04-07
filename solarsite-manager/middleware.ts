import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

function createRequestId() {
  // セキュアなIDでなくても相関IDとして十分（ログ/問い合わせ用途）
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const protectedRoutes = [
  "/dashboard",
  "/upload",
  "/sites",
  "/alerts",
  "/reports",
  "/history",
  "/settings",
];

export default auth((req) => {
  const { nextUrl } = req;

  // NextAuth の既定 /api/auth/error は本番で 500 になることがある → /login へ（app/api/auth/error は Next の error 規約と衝突しうるのでミドルウェアで処理）
  if (nextUrl.pathname === "/api/auth/error") {
    const login = new URL("/login", nextUrl.origin);
    nextUrl.searchParams.forEach((value, key) => {
      login.searchParams.set(key, value);
    });
    return NextResponse.redirect(login);
  }

  const isLoggedIn = !!req.auth;
  const isAuthPage =
    nextUrl.pathname === "/login" ||
    nextUrl.pathname === "/signup" ||
    nextUrl.pathname === "/forgot-password" ||
    nextUrl.pathname.startsWith("/reset-password/");
  const isProtected = protectedRoutes.some((path) =>
    nextUrl.pathname.startsWith(path)
  );
  const requestId = req.headers.get("x-request-id") ?? createRequestId();

  if (isLoggedIn && isAuthPage) {
    const res = NextResponse.redirect(new URL("/reports", nextUrl.origin));
    res.headers.set("x-request-id", requestId);
    return res;
  }

  if (!isLoggedIn && isProtected) {
    const loginUrl = new URL("/login", nextUrl.origin);
    loginUrl.searchParams.set("from", nextUrl.pathname);
    const res = NextResponse.redirect(loginUrl);
    res.headers.set("x-request-id", requestId);
    return res;
  }

  const res = NextResponse.next();
  res.headers.set("x-request-id", requestId);
  return res;
});

// ほかの /api/auth/* は通さない（Edge と NextAuth の二重処理で 500 になりうる）。/api/auth/error だけ例外でリダイレクトする。
export const config = {
  matcher: [
    "/api/auth/error",
    "/((?!api/health|api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};

