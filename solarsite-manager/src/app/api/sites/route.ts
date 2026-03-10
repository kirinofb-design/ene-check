import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

export async function GET() {
  await requireAuth();

  const sites = await prisma.site.findMany({
    orderBy: { siteName: "asc" },
  });

  return NextResponse.json({ data: sites });
}

export async function POST(request: Request) {
  await requireAuth();
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
  };

  return NextResponse.json({ data: site }, { status: 201 });
}

