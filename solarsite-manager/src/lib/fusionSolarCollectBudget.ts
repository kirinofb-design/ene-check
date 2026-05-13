/**
 * FusionSolar は発電所×月で重い。本番では Vercel maxDuration（300s）に収めつつ、
 * 長期間リクエストでも 90s のような過小 budget で途中打ち切りにならないよう段階的に確保する。
 * 非本番は undefined を返し、collector 側の既定 / FUSION_SOLAR_COLLECT_BUDGET_MS を使う。
 */
export function diffDaysInclusiveYmd(startDate: string, endDate: string): number {
  const s = Date.parse(`${startDate}T00:00:00.000Z`);
  const e = Date.parse(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return 0;
  return Math.floor((e - s) / (24 * 60 * 60 * 1000)) + 1;
}

export function getFusionSolarWallBudgetMs(startDate: string, endDate: string): number | undefined {
  if (process.env.NODE_ENV !== "production") return undefined;
  const days = diffDaysInclusiveYmd(startDate, endDate);
  if (days <= 0) return 270_000;
  if (days <= 3) return 150_000;
  if (days <= 7) return 180_000;
  if (days <= 14) return 220_000;
  return 270_000;
}
