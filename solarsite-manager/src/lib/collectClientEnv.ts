import { FUSION_SOLAR_STATIONS } from "@/lib/fusionSolarStations";

/**
 * ブラウザ側の収集オーケストレーション用（クライアントのみ）。
 * Vercel 本番は関数 maxDuration=300s のため Fusion を日次 window API に分割する。
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

/**
 * FusionSolar を日次 window に分割するか。
 * 既定は false（開発と同じ期間一括・4+4）。`NEXT_PUBLIC_FUSION_DAY_WINDOW=1` で旧日次モード。
 */
export function shouldUseFusionDayWindowClient(): boolean {
  if (typeof window === "undefined") return false;
  return process.env.NEXT_PUBLIC_FUSION_DAY_WINDOW?.trim() === "1";
}

/** @deprecated 名称は歴史的経緯。true のときのみ日次 window */
export function shouldSplitFusionByStationClient(): boolean {
  return shouldUseFusionDayWindowClient();
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

/** 期間一括取得の1リクエストあたりの発電所数（本番は最初から4+4、開発は8一括→失敗時4+4） */
export function getFusionFullRangeBatchSize(): number {
  return isVercelHostedClient() ? 4 : FUSION_SOLAR_STATIONS.length;
}

/** @deprecated getFusionFullRangeBatchSize を使用 */
export function getLocalFusionStationBatchSize(): number {
  return getFusionFullRangeBatchSize();
}

/** 本番: 1発電所あたりの期間チャンク日数（300s 内に収める） */
export function getFusionStationChunkDays(): number {
  return isVercelHostedClient() ? 7 : 31;
}

/** 本番: 発電所×期間チャンク間の待機（ms） */
export function getFusionStationChunkDelayMs(): number {
  return isVercelHostedClient() ? 900 : 0;
}

/** localhost: Fusion バッチ間の待機（ms） */
export function getLocalFusionBatchDelayMs(): number {
  return isVercelHostedClient() ? 2000 : 0;
}

/** localhost ではコレクター間 prewarm を省略（Chromium 起動待ちを削減） */
export function shouldPrewarmBetweenCollectorsClient(): boolean {
  return isVercelHostedClient();
}

/** 収集 API 1 回あたりの fetch 待ち上限（Vercel 関数 300s に合わせる） */
export function getCollectChunkFetchTimeoutMs(): number | undefined {
  return isVercelHostedClient() ? 295_000 : undefined;
}

/** Vercel 本番: Fusion window API の最大再試行（5回×295s だと1日で25分超えフリーズしやすい） */
export function getFusionWindowMaxAttempts(): number {
  return isVercelHostedClient() ? 2 : 5;
}

export function getLaplaceDaysPerChunk(): number {
  // ラプラスは月単位 CSV 取得のため、期間分割しても 1 回あたりの負荷はほぼ同じ。本番も月一括にする。
  return 31;
}

export function getSmaDaysPerChunk(): number {
  return isVercelHostedClient() ? 1 : 31;
}

export function getLaplaceChunkDelayMs(): number {
  return isVercelHostedClient() ? 3000 : 0;
}

export function getSmaChunkDelayMs(): number {
  return isVercelHostedClient() ? 4500 : 0;
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
    afterEco: 0,
    afterSma: 0,
    afterLaplace: 0,
    beforeFusion: 0,
    betweenMonitors: 0,
  };
}
