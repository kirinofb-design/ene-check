import { eachMaxDaySliceInRange } from "@/lib/collectDateChunks";
import {
  getFusionFullRangeBatchSize,
  getFusionStationChunkDays,
  isVercelHostedClient,
  shouldUseFusionDayWindowClient,
} from "@/lib/collectClientEnv";
import { FUSION_SOLAR_STATIONS } from "@/lib/fusionSolarStations";

/** 同一 Fusion チャンクがこの時間動かなければ「停止の可能性」を表示 */
export const FUSION_CHUNK_STALL_WARN_MS = 15 * 60 * 1000;
/** この時間進捗が変わらなければブラウザ側で fetch を自動中断（一括取得のみ。個別Fusionは手動取消） */
export const FUSION_CHUNK_STALL_ABORT_MS = 45 * 60 * 1000;

/** Fusion のブラウザ側リクエスト数 */
export function countFusionClientBatches(rangeStart: string, rangeEnd: string): number {
  if (shouldUseFusionDayWindowClient()) {
    return eachMaxDaySliceInRange(rangeStart, rangeEnd, 1).length;
  }
  if (isVercelHostedClient()) {
    const periodSlices = eachMaxDaySliceInRange(rangeStart, rangeEnd, getFusionStationChunkDays()).length;
    return FUSION_SOLAR_STATIONS.length * periodSlices;
  }
  const batchSize = getFusionFullRangeBatchSize();
  return Math.ceil(FUSION_SOLAR_STATIONS.length / batchSize);
}

/** @deprecated countFusionClientBatches を使用 */
export function countFusionVercelBatches(rangeStart: string, rangeEnd: string): number {
  return countFusionClientBatches(rangeStart, rangeEnd);
}

/** 本番一括取得のおおよその所要時間（分） */
export function estimateProdFullCollectMinutes(
  rangeStart: string,
  rangeEnd: string
): { min: number; max: number } {
  const fusionBatches = countFusionClientBatches(rangeStart, rangeEnd);
  const nonFusionMin = 12;
  const nonFusionMax = 25;
  const perFusionBatchMin = shouldUseFusionDayWindowClient() ? 2 : isVercelHostedClient() ? 3 : 8;
  const perFusionBatchMax = shouldUseFusionDayWindowClient() ? 4 : isVercelHostedClient() ? 6 : 18;
  return {
    min: Math.round(nonFusionMin + fusionBatches * perFusionBatchMin),
    max: Math.round(nonFusionMax + fusionBatches * perFusionBatchMax),
  };
}

export function formatProdCollectTimeHint(rangeStart: string, rangeEnd: string): string | null {
  if (!isVercelHostedClient()) return null;
  const { min, max } = estimateProdFullCollectMinutes(rangeStart, rangeEnd);
  const fusionBatches = countFusionClientBatches(rangeStart, rangeEnd);
  const fusionOnly = formatFusionOnlyTimeHint(rangeStart, rangeEnd);
  const fusionUnit = shouldUseFusionDayWindowClient()
    ? `${fusionBatches} 日分`
    : `${fusionBatches} リクエスト（1発電所×${getFusionStationChunkDays()}日・日別取得）`;
  const allHint = `全データ一括（本番）: おおよそ ${min}〜${max} 分（FusionSolar は ${fusionUnit}）。`;
  return fusionOnly ? `${allHint}\n${fusionOnly}` : allHint;
}

/** FusionSolar 個別取得の所要時間目安（本番） */
export function formatFusionOnlyTimeHint(rangeStart: string, rangeEnd: string): string | null {
  if (!isVercelHostedClient()) return null;
  if (shouldUseFusionDayWindowClient()) {
    const days = countFusionClientBatches(rangeStart, rangeEnd);
    if (days <= 0) return null;
    const min = Math.max(5, Math.round(days * 2.5));
    const max = Math.max(min + 10, Math.round(days * 7));
    return `FusionSolar 個別取得（本番）: ${days} 日分でおおよそ ${min}〜${max} 分。進捗は日ごとに更新されます。タブを閉じないでください。`;
  }
  const chunks = countFusionClientBatches(rangeStart, rangeEnd);
  const min = Math.max(20, Math.round(chunks * 3));
  const max = Math.max(min + 10, Math.round(chunks * 6));
  return `FusionSolar 個別取得（本番）: ${chunks} リクエスト（8発電所×${getFusionStationChunkDays()}日区切り）でおおよそ ${min}〜${max} 分。1件あたり数分かかります。タブを閉じないでください。`;
}

export function fusionChunkStallWarning(
  stepKey: string,
  chunkKey: string,
  chunkChangedAtMs: number,
  nowMs: number = Date.now()
): string | null {
  if (stepKey !== "fusion-solar") return null;
  if (!chunkKey || chunkChangedAtMs <= 0) return null;
  const elapsed = nowMs - chunkChangedAtMs;
  if (elapsed < FUSION_CHUNK_STALL_WARN_MS) return null;
  const mins = Math.floor(elapsed / 60_000);
  return `※ FusionSolar の進捗（${chunkKey}）が ${mins} 分間変わっていません。45分以上停止している場合は「実行取消」を押してください。`;
}
