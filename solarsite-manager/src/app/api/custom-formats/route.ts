import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";

export async function GET(request: Request) {
  try {
    await requireAuth(request);

    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get("siteId");
    const monitoringSystem = searchParams.get("monitoringSystem");

    const formats = await prisma.customFormat.findMany({
      where: {
        ...(siteId ? { siteId } : {}),
        ...(monitoringSystem ? { monitoringSystem } : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ data: formats });
  } catch (e) {
    return handleApiError(request, e);
  }
}

export async function POST(request: Request) {
  try {
    await requireAuth(request);
    const body = await request.json();

    const {
      name,
      monitoringSystem,
      siteId,
      config,
    } = body as {
      name?: string;
      monitoringSystem?: string;
      siteId?: string | null;
      config?: unknown;
    };

    if (!name || !monitoringSystem) {
      return NextResponse.json(
        {
          error: {
            code: "BAD_REQUEST",
            message: "name と monitoringSystem は必須です。",
          },
        },
        { status: 400 }
      );
    }

    const created = await prisma.customFormat.create({
      data: {
        name,
        monitoringSystem,
        siteId: siteId ?? null,
        config: JSON.stringify(config ?? {}),
      },
    });

    return NextResponse.json({ data: created }, { status: 201 });
  } catch (e) {
    return handleApiError(request, e);
  }
}

