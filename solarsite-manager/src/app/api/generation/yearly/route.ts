import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

export async function GET(request: Request) {
  await requireAuth();

  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get("siteId");

  const where: Record<string, unknown> = {};
  if (siteId) where.siteId = siteId;

  const records = await prisma.dailyGeneration.findMany({
    where,
    select: { date: true, generation: true, siteId: true },
  });

  const byYear: Record<string, Record<string, number>> = {};
  for (const r of records) {
    const y = String(r.date.getFullYear());
    if (!byYear[y]) byYear[y] = {};
    byYear[y][r.siteId] = (byYear[y][r.siteId] ?? 0) + r.generation;
  }

  const data = Object.entries(byYear).map(([year, bySite]) => ({
    year,
    bySite,
  }));

  return NextResponse.json({ data });
}
