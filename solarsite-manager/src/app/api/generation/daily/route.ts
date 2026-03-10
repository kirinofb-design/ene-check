import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

export async function GET(request: Request) {
  await requireAuth();

  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get("siteId");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  const where: Record<string, unknown> = {};

  if (siteId) where.siteId = siteId;

  if (startDate || endDate) {
    where.date = {};
    if (startDate) (where.date as Record<string, Date>).gte = new Date(startDate);
    if (endDate) (where.date as Record<string, Date>).lte = new Date(endDate);
  }

  const data = await prisma.dailyGeneration.findMany({
    where,
    orderBy: { date: "asc" },
    include: { site: { select: { siteName: true } } },
  });

  return NextResponse.json({ data });
}
