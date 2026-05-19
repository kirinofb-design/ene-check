/**
 * データ収集のタイムアウト（本番・開発で同一）。
 * Vercel の route maxDuration=300s に合わせ、壁時計は 270s を上限とする。
 */
export const COLLECT_ROUTE_MAX_DURATION_MS = 300_000;

/** 関数全体の壁時計上限（maxDuration より余裕を持たせる） */
export const COLLECT_WALL_BUDGET_MAX_MS = 270_000;

export const FUSION_SOLAR_DEFAULT_WALL_BUDGET_MS = COLLECT_WALL_BUDGET_MAX_MS;
export const FUSION_SOLAR_STATION_MONTH_ATTEMPT_TIMEOUT_MS = 180_000;
export const FUSION_SOLAR_STATION_MONTH_ATTEMPT_MIN_MS = 10_000;
export const FUSION_SOLAR_LOGIN_COMPLETION_TIMEOUT_MS = 25_000;
export const FUSION_SOLAR_LOGIN_FORM_HARD_TIMEOUT_MS = 70_000;
export const FUSION_SOLAR_AUTO_LOGIN_TIMEOUT_MS = 20_000;
export const FUSION_SOLAR_REPORT_PAGE_READY_TIMEOUT_MS = 35_000;

export function capCollectWallBudgetMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return FUSION_SOLAR_DEFAULT_WALL_BUDGET_MS;
  return Math.min(ms, COLLECT_WALL_BUDGET_MAX_MS);
}
