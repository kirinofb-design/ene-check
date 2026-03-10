import { NextResponse } from "next/server";
import { auth } from "@/auth";

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

  if (isLoggedIn && isAuthPage) {
    return NextResponse.redirect(new URL("/dashboard", nextUrl.origin));
  }

  if (!isLoggedIn && isProtected) {
    const loginUrl = new URL("/auth/login", nextUrl.origin);
    loginUrl.searchParams.set("from", nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api/health|_next/static|_next/image|favicon.ico).*)"],
};

