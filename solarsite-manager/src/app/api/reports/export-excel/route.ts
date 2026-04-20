import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { ensureDbReachable } from "@/lib/ensureDbReachable";
import { utils, write } from "xlsx";

function systemLabel(monitoringSystem: string): string {
  // DB に保存されている monitoringSystem はプリセットID（eco-megane 等）を想定
  switch (monitoringSystem) {
    case "eco-megane":
      return "エコめがね";
    case "fusion-solar":
      return "Huawei FusionSolar";
    case "sunny-portal":
      return "SMA Sunny Portal";
    case "grand-arch":
      return "ラプラスシステム";
    case "solar-monitor-sf":
    case "solar-monitor-se":
      return "Solar Monitor";
    default:
      // 既に表示名が入っているケースも許容
      return monitoringSystem || "不明";
  }
}

function parseMonthParam(v: string | null): { year: number; month: number } | null {
  if (!v) return null;
  // YYYY-MM
  const m = /^(\d{4})-(\d{2})$/.exec(v);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]); // 1-12
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  return { year, month };
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function ymdSlash(ymdStr: string): string {
  // YYYY-MM-DD -> YYYY/MM/DD
  return ymdStr.replaceAll("-", "/");
}

function startOfMonthUtc(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
}

function endOfMonthUtc(year: number, month: number): Date {
  // 次月1日の 00:00 の直前（ここでは日付比較のため当日 23:59:59.999 を返す）
  const nextMonth = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  return new Date(nextMonth.getTime() - 1);
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000; // UTC+9
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 日本時間(JST, UTC+9)基準で「昨日」の終了 23:59:59.999 に相当する UTC の Date を返す。
 * 「当月は昨日まで」の上限に使用する。
 */
function yesterdayEndJstAsUtc(): Date {
  const nowMs = Date.now();
  // JST での「今日」の日数（epoch からの経過日数）
  const jstTodayDays = Math.floor((nowMs + JST_OFFSET_MS) / MS_PER_DAY);
  const jstYesterdayDays = jstTodayDays - 1;
  // JST の「昨日」の終了 = (昨日+1)日目の 00:00:00 JST の 1ms 前
  const endOfYesterdayJstMs = (jstYesterdayDays + 1) * MS_PER_DAY - JST_OFFSET_MS - 1;
  return new Date(endOfYesterdayJstMs);
}

function listDates(start: Date, end: Date): string[] {
  const out: string[] = [];
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 0, 0, 0, 0));
  const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 0, 0, 0, 0));
  while (cur.getTime() <= endDay.getTime()) {
    out.push(ymd(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export async function GET(request: Request) {
  try {
    await requireAuth(request);
    await ensureDbReachable(5);

    const { searchParams } = new URL(request.url);
    const monthParam = parseMonthParam(searchParams.get("month"));
    if (!monthParam) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "month=YYYY-MM を指定してください。" } },
        { status: 400 }
      );
    }

    const { year, month } = monthParam;
    const start = startOfMonthUtc(year, month);
    const monthEnd = endOfMonthUtc(year, month);
    // 「当月は昨日まで」の「昨日」を JST (UTC+9) 基準で計算
    const cutoff = yesterdayEndJstAsUtc();
    const end = monthEnd.getTime() < cutoff.getTime() ? monthEnd : cutoff;

    const dates = listDates(start, end);
    const dateHeaders = dates.map(ymdSlash);

    // 全発電所（全Site）を対象に出力
    const sites = await prisma.site.findMany({
      orderBy: [{ createdAt: "asc" }, { siteName: "asc" }],
      select: { id: true, siteName: true, monitoringSystem: true },
    });
    const siteIds = sites.map((s) => s.id);

    const records = siteIds.length
      ? await prisma.dailyGeneration.findMany({
          where: {
            siteId: { in: siteIds },
            date: { gte: start, lte: end },
          },
          select: { siteId: true, date: true, generation: true },
        })
      : [];

    const siteById = new Map(sites.map((s) => [s.id, s]));
    const pivot = new Map<string, Record<string, number>>();
    for (const d of dates) {
      pivot.set(d, {});
    }
    for (const r of records) {
      const d = ymd(r.date);
      const site = siteById.get(r.siteId);
      if (!site) continue;
      if (!pivot.has(d)) pivot.set(d, {});
      pivot.get(d)![site.id] = r.generation;
    }

    // 仕様変更: 発電所が行、日付が列
    // A列: 発電所名 / B列: システム名 / C列以降: 日付（YYYY/MM/DD）
    const aoa: (string | number)[][] = [];
    aoa.push(["発電所名", "システム名", ...dateHeaders]);

    for (const site of sites) {
      const row: (string | number)[] = [];
      row.push(site.siteName);
      row.push(systemLabel(site.monitoringSystem));
      for (const d of dates) {
        const v = pivot.get(d)?.[site.id] ?? 0;
        row.push(v);
      }
      aoa.push(row);
    }

    // 1シートにまとめる（列順固定）
    const ws = utils.aoa_to_sheet(aoa);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, `${year}-${String(month).padStart(2, "0")}`);

    const xlsxBuffer = write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const fileName = `generation_${year}-${String(month).padStart(2, "0")}.xlsx`;

    return new NextResponse(xlsxBuffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (e) {
    return handleApiError(request, e);
  }
}

