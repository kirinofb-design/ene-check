import { capCollectWallBudgetMs, COLLECT_WALL_BUDGET_MAX_LOCAL_MS } from "@/lib/collectTimeouts";

function isVercelRuntimeEnv(): boolean {
  return process.env.VERCEL === "1" || process.env.VERCEL === "true";
}

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

/** 期間×発電所の保存件数がこれ未満なら不完全（部分成功）とみなす */
export function computeFusionExpectedMinRecords(
  startDate: string,
  endDate: string,
  stationCount: number
): number {
  const days = diffDaysInclusiveYmd(startDate, endDate);
  if (days <= 0 || stationCount <= 0) return 1;
  // 1発電所×N日は全日必須（月別表のページ欠けを検知して再試行させる）
  if (stationCount === 1) return days;
  // 本番 window API（1日×N発電所）は欠測1件でも再試行させるため全件必須
  if (days === 1) return stationCount;
  return Math.max(1, Math.floor(days * stationCount * 0.85));
}

export function getFusionSolarWallBudgetMs(startDate: string, endDate: string): number {
  // localhost / 自前ホストは 300s 制限が無いので、全発電所を1リクエストで取りきれる大きな予算にする
  if (!isVercelRuntimeEnv()) return capCollectWallBudgetMs(COLLECT_WALL_BUDGET_MAX_LOCAL_MS);
  const days = diffDaysInclusiveYmd(startDate, endDate);
  if (days <= 0) return capCollectWallBudgetMs(270_000);
  // 日単位 window API（1日=全8発電所）では 150s だと後半の発電所が欠落しやすい
  if (days <= 1) return capCollectWallBudgetMs(270_000);
  if (days <= 3) return capCollectWallBudgetMs(240_000);
  if (days <= 7) return capCollectWallBudgetMs(220_000);
  if (days <= 14) return capCollectWallBudgetMs(250_000);
  return capCollectWallBudgetMs(270_000);
}
