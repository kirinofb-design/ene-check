import { NextResponse } from "next/server";
import { auth } from "@/auth";

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
  const isLoggedIn = !!req.auth;
  const isAuthPage = nextUrl.pathname.startsWith("/auth");
  const isProtected = protectedRoutes.some((path) =>
    nextUrl.pathname.startsWith(path)
  );
  const requestId = req.headers.get("x-request-id") ?? createRequestId();

  if (isLoggedIn && isAuthPage) {
    const res = NextResponse.redirect(new URL("/dashboard", nextUrl.origin));
    res.headers.set("x-request-id", requestId);
    return res;
  }

  if (!isLoggedIn && isProtected) {
    const loginUrl = new URL("/auth/login", nextUrl.origin);
    loginUrl.searchParams.set("from", nextUrl.pathname);
    const res = NextResponse.redirect(loginUrl);
    res.headers.set("x-request-id", requestId);
    return res;
  }

  const res = NextResponse.next();
  res.headers.set("x-request-id", requestId);
  return res;
});

export const config = {
  matcher: ["/((?!api/health|_next/static|_next/image|favicon.ico).*)"],
};

