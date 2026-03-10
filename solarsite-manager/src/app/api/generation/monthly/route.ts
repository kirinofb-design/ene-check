import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

export async function GET(request: Request) {
  await requireAuth();

  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get("siteId");
  const year = searchParams.get("year");

  const where: Record<string, unknown> = {};
  if (siteId) where.siteId = siteId;
  if (year) {
    const y = parseInt(year, 10);
    where.date = {
      gte: new Date(y, 0, 1),
      lt: new Date(y + 1, 0, 1),
    };
  }

  const records = await prisma.dailyGeneration.findMany({
    where,
    select: { date: true, generation: true, siteId: true },
  });

  const byMonth: Record<string, { siteId: string; month: string; total: number }[]> = {};
  for (const r of records) {
    const month = `${r.date.getFullYear()}-${String(r.date.getMonth() + 1).padStart(2, "0")}`;
    if (!byMonth[month]) byMonth[month] = [];
    const existing = byMonth[month].find((x) => x.siteId === r.siteId);
    if (existing) existing.total += r.generation;
    else byMonth[month].push({ siteId: r.siteId, month, total: r.generation });
  }

  const data = Object.entries(byMonth).map(([month, items]) => ({ month, items }));

  return NextResponse.json({ data });
}
