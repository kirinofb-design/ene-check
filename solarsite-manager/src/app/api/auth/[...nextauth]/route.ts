import { NextResponse, type NextRequest } from "next/server";
import { handlers } from "@/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    return await handlers.GET(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown auth GET error";
    console.error("[auth route GET] failed:", err);
    return NextResponse.json(
      { error: "AUTH_GET_FAILED", message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    return await handlers.POST(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown auth POST error";
    console.error("[auth route POST] failed:", err);
    return NextResponse.json(
      { error: "AUTH_POST_FAILED", message },
      { status: 500 }
    );
  }
}

