import { FUSION_SOLAR_STATIONS } from "@/lib/fusionSolarStations";

/**
 * ブラウザ側の収集オーケストレーション用（クライアントのみ）。
 * Vercel 本番は関数 maxDuration=300s のため Fusion を日×発電所バッチに分割する。
 */

/** Vercel 上で動いているか（*.vercel.app または Vercel ビルド時に注入される URL） */
export function isVercelHostedClient(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  if (h.endsWith(".vercel.app")) return true;
  const vercelUrl = process.env.NEXT_PUBLIC_VERCEL_URL?.trim();
  if (vercelUrl && vercelUrl.length > 0) return true;
  return process.env.NEXT_PUBLIC_VERCEL === "1";
}

/** FusionSolar を日×発電所バッチに分割するか（Vercel 本番向け） */
export function shouldSplitFusionByStationClient(): boolean {
  return isVercelHostedClient();
}

/** Vercel 本番: 1リクエストあたりの発電所数（300s 内に収める） */
export function getFusionStationsPerVercelBatch(): number {
  return isVercelHostedClient() ? 4 : FUSION_SOLAR_STATIONS.length;
}

/** 収集 API 1 回あたりの fetch 待ち上限（Vercel 関数 300s に合わせる） */
export function getCollectChunkFetchTimeoutMs(): number | undefined {
  return isVercelHostedClient() ? 295_000 : undefined;
}
