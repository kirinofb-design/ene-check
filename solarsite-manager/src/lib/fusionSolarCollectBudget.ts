import { capCollectWallBudgetMs } from "@/lib/collectTimeouts";

/**
 * FusionSolar は発電所×月で重い。Vercel maxDuration（300s）に収めつつ、
 * 長期間リクエストでも過小 budget で途中打ち切りにならないよう段階的に確保する（本番・開発共通）。
 */
export function diffDaysInclusiveYmd(startDate: string, endDate: string): number {
  const s = Date.parse(`${startDate}T00:00:00.000Z`);
  const e = Date.parse(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return 0;
  return Math.floor((e - s) / (24 * 60 * 60 * 1000)) + 1;
}

export function getFusionSolarWallBudgetMs(startDate: string, endDate: string): number {
  const days = diffDaysInclusiveYmd(startDate, endDate);
  if (days <= 0) return capCollectWallBudgetMs(270_000);
  if (days <= 3) return capCollectWallBudgetMs(150_000);
  if (days <= 7) return capCollectWallBudgetMs(180_000);
  if (days <= 14) return capCollectWallBudgetMs(220_000);
  return capCollectWallBudgetMs(270_000);
}
