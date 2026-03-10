import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";

export async function GET() {
  // GET は Request を受け取らないため、未認証時の詳細な 401 応答はここでは行わない。
  // ただし例外で落ちないように最低限ガードする。
  try {
    await requireAuth();
    const sites = await prisma.site.findMany({
      orderBy: { siteName: "asc" },
    });
    return NextResponse.json({ data: sites });
  } catch {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "ログインが必要です。" } },
      { status: 401 }
    );
  }
}

export async function POST(request: Request) {
  try {
    await requireAuth(request);
    const body = await request.json();

    const {
      siteName,
      location,
      capacity,
      monitoringSystem,
      monitoringUrl,
    } = body as {
      siteName?: string;
      location?: string;
      capacity?: number;
      monitoringSystem?: string;
      monitoringUrl?: string;
    };

    if (
      !siteName ||
      typeof capacity !== "number" ||
      capacity <= 0 ||
      !monitoringSystem ||
      !monitoringUrl
    ) {
      return NextResponse.json(
        {
          error: {
            code: "BAD_REQUEST",
            message:
              "siteName, capacity(>0), monitoringSystem, monitoringUrl は必須です。",
          },
        },
        { status: 400 }
      );
    }

    const site = await prisma.site.create({
      data: {
        siteName,
        location: location ?? null,
        capacity,
        monitoringSystem,
        monitoringUrl,
      },
    });

    return NextResponse.json({ data: site }, { status: 201 });
  } catch (e) {
    return handleApiError(request, e);
  }
}

