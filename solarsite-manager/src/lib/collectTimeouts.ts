/**
 * データ収集のタイムアウト（本番・開発で同一）。
 * Vercel の route maxDuration=300s に合わせ、壁時計は 270s を上限とする。
 */
export const COLLECT_ROUTE_MAX_DURATION_MS = 300_000;

/** 関数全体の壁時計上限（Vercel は maxDuration=300s に合わせ 270s 上限） */
export const COLLECT_WALL_BUDGET_MAX_MS = 270_000;

/**
 * localhost / 自前ホストには Vercel の 300s 制限が無いため、1リクエストで
 * 全発電所を取りきれるよう壁時計上限を大きく取る（既定 25 分）。
 */
export const COLLECT_WALL_BUDGET_MAX_LOCAL_MS = 1_500_000;

function isVercelRuntimeEnv(): boolean {
  return process.env.VERCEL === "1" || process.env.VERCEL === "true";
}

function wallBudgetMaxMs(): number {
  return isVercelRuntimeEnv() ? COLLECT_WALL_BUDGET_MAX_MS : COLLECT_WALL_BUDGET_MAX_LOCAL_MS;
}

export const FUSION_SOLAR_DEFAULT_WALL_BUDGET_MS = COLLECT_WALL_BUDGET_MAX_MS;
export const FUSION_SOLAR_STATION_MONTH_ATTEMPT_TIMEOUT_MS = 180_000;
export const FUSION_SOLAR_STATION_MONTH_ATTEMPT_MIN_MS = 10_000;
export const FUSION_SOLAR_LOGIN_COMPLETION_TIMEOUT_MS = 25_000;
export const FUSION_SOLAR_LOGIN_FORM_HARD_TIMEOUT_MS = 70_000;
/** Vercel 冷起動 Chromium は遅いため本番のみ長め */
export const FUSION_SOLAR_AUTO_LOGIN_TIMEOUT_MS = 20_000;
export const FUSION_SOLAR_AUTO_LOGIN_TIMEOUT_VERCEL_MS = 55_000;
export const FUSION_SOLAR_REPORT_PAGE_READY_TIMEOUT_MS = 35_000;

export function capCollectWallBudgetMs(ms: number): number {
  const max = wallBudgetMaxMs();
  if (!Number.isFinite(ms) || ms <= 0) return max;
  return Math.min(ms, max);
}
