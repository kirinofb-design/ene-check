import { FUSION_SOLAR_STATIONS } from "@/lib/fusionSolarStations";

/**
 * ブラウザ側の収集オーケストレーション用（クライアントのみ）。
 * Vercel 本番は関数 maxDuration=300s のため Fusion を日×発電所バッチに分割する。
 */

/** localhost / 127.0.0.1 で開発サーバーを開いているか */
export function isLocalDevClient(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

/** Vercel 上で動いているか（*.vercel.app）。localhost は常に false（.env の VERCEL_URL は無視） */
export function isVercelHostedClient(): boolean {
  if (typeof window === "undefined") return false;
  if (isLocalDevClient()) return false;
  const h = window.location.hostname;
  if (h.endsWith(".vercel.app")) return true;
  return process.env.NEXT_PUBLIC_VERCEL === "1";
}

/** FusionSolar を日×発電所バッチに分割するか（Vercel 本番向け） */
export function shouldSplitFusionByStationClient(): boolean {
  return isVercelHostedClient();
}

/** localhost では期間全体を1リクエストで取得（日ごと window だと月30日×7分で非現実的） */
export function shouldUseFusionFullRangeClient(): boolean {
  return !isVercelHostedClient();
}

export const FUSION_SOLAR_FULL_RANGE_POST_URL = "/api/collect/fusion-solar";

/** Vercel 本番: 1リクエストあたりの発電所数（300s 内に収める） */
export function getFusionStationsPerVercelBatch(): number {
  return isVercelHostedClient() ? 4 : FUSION_SOLAR_STATIONS.length;
}

/** localhost: 1リクエストあたりの発電所数（セッション切れを防ぐ） */
export function getLocalFusionStationBatchSize(): number {
  return isVercelHostedClient() ? FUSION_SOLAR_STATIONS.length : 4;
}

/** 収集 API 1 回あたりの fetch 待ち上限（Vercel 関数 300s に合わせる） */
export function getCollectChunkFetchTimeoutMs(): number | undefined {
  return isVercelHostedClient() ? 295_000 : undefined;
}

export function getLaplaceDaysPerChunk(): number {
  return isVercelHostedClient() ? 3 : 14;
}

export function getSmaDaysPerChunk(): number {
  return isVercelHostedClient() ? 1 : 31;
}

export function getLaplaceChunkDelayMs(): number {
  return isVercelHostedClient() ? 8000 : 1000;
}

export function getSmaChunkDelayMs(): number {
  return isVercelHostedClient() ? 4500 : 800;
}

export function getOrchestrationChillMs(): {
  afterEco: number;
  afterSma: number;
  afterLaplace: number;
  beforeFusion: number;
  betweenMonitors: number;
} {
  if (isVercelHostedClient()) {
    return {
      afterEco: 2800,
      afterSma: 5500,
      afterLaplace: 4500,
      beforeFusion: 3200,
      betweenMonitors: 2000,
    };
  }
  return {
    afterEco: 400,
    afterSma: 400,
    afterLaplace: 400,
    beforeFusion: 400,
    betweenMonitors: 400,
  };
}
