import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

function parseDateParam(v: string | null): Date | null {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(request: Request) {
  await requireAuth(request);

  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get("siteId");
  const startDate = parseDateParam(searchParams.get("startDate"));
  const endDate = parseDateParam(searchParams.get("endDate"));

  const rows = await prisma.dailyGeneration.findMany({
    where: {
      ...(siteId ? { siteId } : {}),
      ...(startDate || endDate
        ? {
            date: {
              gte: startDate ?? undefined,
              lte: endDate ?? undefined,
            },
          }
        : {}),
    },
    include: {
      site: {
        select: { siteName: true },
      },
    },
    orderBy: [{ siteId: "asc" }, { date: "asc" }],
  });

  const header = [
    "siteName",
    "date",
    "generation_kWh",
    "status",
    "notes",
  ];

  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [
        `"${r.site?.siteName ?? ""}"`,
        r.date.toISOString().slice(0, 10),
        r.generation,
        r.status ?? "",
        r.notes ? `"${r.notes.replace(/"/g, '""')}"` : "",
      ].join(",")
    ),
  ];

  const csv = lines.join("\r\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="generation_export.csv"`,
    },
  });
}

