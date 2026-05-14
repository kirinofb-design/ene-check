function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseYmdUtc(ymd: string): Date | null {
  if (!isYmd(ymd)) return null;
  const [y, m, d] = ymd.split("-").map((v) => Number(v));
  if (!y || !m || !d) return null;
  const dt = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function fmtYmdUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 指定期間を暦月の境界で切った [{startDate,endDate}, ...]（Fusion 分割用） */
export function eachCalendarMonthSliceInRange(startYmd: string, endYmd: string): { startDate: string; endDate: string }[] {
  const start = parseYmdUtc(startYmd);
  const end = parseYmdUtc(endYmd);
  if (!start || !end || start.getTime() > end.getTime()) return [];

  const out: { startDate: string; endDate: string }[] = [];
  let cur = new Date(start.getTime());
  while (cur.getTime() <= end.getTime()) {
    const y = cur.getUTCFullYear();
    const m0 = cur.getUTCMonth();
    const first = new Date(Date.UTC(y, m0, 1));
    const last = new Date(Date.UTC(y, m0 + 1, 0));
    const sliceStart = cur.getTime() < first.getTime() ? first : cur;
    const sliceEnd = end.getTime() < last.getTime() ? end : last;
    if (sliceStart.getTime() <= sliceEnd.getTime()) {
      out.push({ startDate: fmtYmdUtc(sliceStart), endDate: fmtYmdUtc(sliceEnd) });
    }
    cur = new Date(Date.UTC(y, m0 + 1, 1));
  }
  return out;
}

/** 連続日を最大 maxInclusiveDays 日ずつに切る（ラプラス等の分割用） */
export function eachMaxDaySliceInRange(
  startYmd: string,
  endYmd: string,
  maxInclusiveDays: number
): { startDate: string; endDate: string }[] {
  const start = parseYmdUtc(startYmd);
  const end = parseYmdUtc(endYmd);
  if (!start || !end || start.getTime() > end.getTime()) return [];
  const span = Math.max(1, Math.floor(maxInclusiveDays));

  const out: { startDate: string; endDate: string }[] = [];
  let cur = new Date(start.getTime());
  const dayMs = 24 * 60 * 60 * 1000;
  while (cur.getTime() <= end.getTime()) {
    const sliceEnd = new Date(cur.getTime() + (span - 1) * dayMs);
    const capped = sliceEnd.getTime() > end.getTime() ? end : sliceEnd;
    out.push({ startDate: fmtYmdUtc(cur), endDate: fmtYmdUtc(capped) });
    cur = new Date(capped.getTime() + dayMs);
  }
  return out;
}
