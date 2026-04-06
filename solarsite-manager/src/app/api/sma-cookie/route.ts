import { NextResponse } from "next/server";
import { getServerSession, requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";

function isLegacySmaCookieUniqueError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message ?? "";
  return message.includes("userId_plantName") || message.includes("SmaCookieCacheWhereUniqueInput");
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    if (!session?.user || !(session.user as { id?: string }).id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = (session.user as { id: string }).id;
    const body = (await request.json()) as { formsLogin?: string };
    const formsLogin = body?.formsLogin;
    if (!formsLogin) {
      return NextResponse.json({ error: "formsLogin is required" }, { status: 400 });
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const cookieJson = JSON.stringify([
      {
        name: ".SunnyPortalFormsLogin",
        value: formsLogin,
        domain: "www.sunnyportal.com",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);

    // 新スキーマ(userId @unique)を優先しつつ、
    // 旧クライアント(userId+plantName 複合 unique)でも保存できるようフォールバックする。
    const smaCookieCache = prisma.smaCookieCache as any;
    try {
      await smaCookieCache.upsert({
        where: { userId },
        create: { userId, cookieJson, expiresAt },
        update: { cookieJson, expiresAt },
      });
    } catch (error) {
      if (!isLegacySmaCookieUniqueError(error)) {
        throw error;
      }
      await smaCookieCache.upsert({
        where: { userId_plantName: { userId, plantName: "" } },
        create: { userId, plantName: "", cookieJson, expiresAt },
        update: { cookieJson, expiresAt },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("sma-cookie POST error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const session = await requireAuth(request);
    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "ログインが必要です。" } },
        { status: 401 }
      );
    }

    const row = await prisma.smaCookieCache.findFirst({
      where: { userId },
      select: { expiresAt: true },
    });

    if (!row) {
      return NextResponse.json({ ok: true, exists: false });
    }

    const now = Date.now();
    const expiresInMs = row.expiresAt.getTime() - now;
    const exists = expiresInMs > 0;

    return NextResponse.json({
      ok: true,
      exists,
      expiresAt: row.expiresAt.toISOString(),
      expiresInHours: Math.max(0, expiresInMs) / (1000 * 60 * 60),
    });
  } catch (e) {
    return handleApiError(request, e);
  }
}

