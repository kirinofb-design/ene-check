import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

export async function GET(request: Request) {
  await requireAuth();

  const { searchParams } = new URL(request.url);
  const resolved = searchParams.get("resolved") === "true";

  const alerts = await prisma.alert.findMany({
    where: resolved ? {} : { resolvedAt: null },
    include: { site: { select: { siteName: true } } },
    orderBy: { detectedAt: "desc" },
  });

  return NextResponse.json({ data: alerts });
}
