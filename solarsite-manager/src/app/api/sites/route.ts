import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";

export async function GET(request: Request) {
  // Phase 3: アップロード画面の初期表示などで参照されるため
  // サイト一覧取得は認証なしでも許可する（読み取りのみ）。
  const sites = await prisma.site.findMany({
    orderBy: { siteName: "asc" },
  });
  return NextResponse.json({ data: sites });
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

    if (!siteName || !monitoringSystem) {
      return NextResponse.json(
        {
          error: {
            code: "BAD_REQUEST",
            message: "siteName, monitoringSystem は必須です。",
          },
        },
        { status: 400 }
      );
    }

    const normalizedCapacity =
      typeof capacity === "number" && Number.isFinite(capacity) && capacity >= 0 ? capacity : 0;
    const normalizedMonitoringUrl =
      typeof monitoringUrl === "string" ? monitoringUrl : "";

    const site = await prisma.site.create({
      data: {
        siteName,
        location: location ?? null,
        capacity: normalizedCapacity,
        monitoringSystem,
        monitoringUrl: normalizedMonitoringUrl,
      },
    });

    return NextResponse.json({ data: site }, { status: 201 });
  } catch (e) {
    return handleApiError(request, e);
  }
}

