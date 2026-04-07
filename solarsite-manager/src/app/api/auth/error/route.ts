import { NextRequest, NextResponse } from "next/server";

/** NextAuth 既定の error レスポンスが環境によって 500 になるため、/login へ寄せる */
export const runtime = "nodejs";

function redirectToLogin(req: NextRequest) {
  const url = new URL("/login", req.nextUrl.origin);
  const err = req.nextUrl.searchParams.get("error");
  if (err) {
    url.searchParams.set("error", err);
  }
  return NextResponse.redirect(url);
}

export function GET(req: NextRequest) {
  return redirectToLogin(req);
}

export function POST(req: NextRequest) {
  return redirectToLogin(req);
}
