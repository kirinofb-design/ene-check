import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

export async function GET() {
  await requireAuth();

  const sites = await prisma.site.findMany({ orderBy: { siteName: "asc" } });

  const latestBySite: Record<
    string,
    { siteName: string; date: Date; generation: number; status: string | null }
  > = {};

  for (const site of sites) {
    const latest = await prisma.dailyGeneration.findFirst({
      where: { siteId: site.id },
      orderBy: { date: "desc" },
    });
    latestBySite[site.id] = {
      siteName: site.siteName,
      date: latest?.date ?? new Date(0),
      generation: latest?.generation ?? 0,
      status: latest?.status ?? null,
    };
  }

  return NextResponse.json({ data: latestBySite });
}
