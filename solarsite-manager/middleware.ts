import {
  NextResponse,
  type NextRequest,
  type NextFetchEvent,
  type NextMiddleware,
} from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

function createRequestId() {
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

/** auth() ラッパー内より前に /api/auth/error を処理しないと Edge 上で 500 になりうる */
const withAuth = auth((req) => {
  const { nextUrl } = req;
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

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  if (request.nextUrl.pathname === "/api/auth/error") {
    const login = new URL("/login", request.nextUrl.origin);
    request.nextUrl.searchParams.forEach((value, key) => {
      login.searchParams.set(key, value);
    });
    return NextResponse.redirect(login);
  }
  return (withAuth as unknown as NextMiddleware)(request, event);
}

// ほかの /api/auth/* は通さない。/api/auth/error だけ上でリダイレクトする。
export const config = {
  matcher: [
    "/api/auth/error",
    "/((?!api/health|api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
