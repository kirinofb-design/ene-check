import { NextResponse } from "next/server";
import iconv from "iconv-lite";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

function parseDateParam(v: string | null): Date | null {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// CSV フィールドを安全にエスケープ（カンマ/改行/ダブルクォート対応）
function escapeCsv(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  const escaped = s.replace(/"/g, '""');
  return /[",\r\n]/.test(escaped) ? `"${escaped}"` : escaped;
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
        escapeCsv(r.site?.siteName ?? ""),
        escapeCsv(r.date.toISOString().slice(0, 10)),
        r.generation, // 数値はそのまま
        escapeCsv(r.status ?? ""),
        escapeCsv(r.notes ?? ""),
      ].join(",")
    ),
  ];

  const csvUtf8 = lines.join("\r\n");
  // Excel での文字化けを避けるため Shift-JIS でエンコード
  const csvShiftJis = iconv.encode(csvUtf8, "shift_jis");

  return new NextResponse(csvShiftJis, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=Shift_JIS",
      "Content-Disposition": `attachment; filename="generation_export.csv"`,
    },
  });
}

