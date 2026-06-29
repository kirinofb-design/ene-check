import { eachMaxDaySliceInRange } from "@/lib/collectDateChunks";
import { FUSION_SOLAR_STATIONS } from "@/lib/fusionSolarStations";
import {
  getFusionDaysPerVercelPeriodChunk,
  getFusionStationsPerVercelBatch,
  isVercelHostedClient,
} from "@/lib/collectClientEnv";

/** 同一 Fusion チャンクがこの時間動かなければ「停止の可能性」を表示 */
export const FUSION_CHUNK_STALL_WARN_MS = 15 * 60 * 1000;

export function countFusionVercelBatches(rangeStart: string, rangeEnd: string): number {
  const periodSlices = eachMaxDaySliceInRange(
    rangeStart,
    rangeEnd,
    getFusionDaysPerVercelPeriodChunk()
  );
  const stationBatches = Math.ceil(FUSION_SOLAR_STATIONS.length / getFusionStationsPerVercelBatch());
  return periodSlices.length * stationBatches;
}

/** 本番一括取得のおおよその所要時間（分） */
export function estimateProdFullCollectMinutes(
  rangeStart: string,
  rangeEnd: string
): { min: number; max: number } {
  const fusionBatches = countFusionVercelBatches(rangeStart, rangeEnd);
  const nonFusionMin = 18;
  const nonFusionMax = 35;
  const perFusionBatchMin = 2.5;
  const perFusionBatchMax = 5;
  return {
    min: Math.round(nonFusionMin + fusionBatches * perFusionBatchMin),
    max: Math.round(nonFusionMax + fusionBatches * perFusionBatchMax),
  };
}

export function formatProdCollectTimeHint(rangeStart: string, rangeEnd: string): string | null {
  if (!isVercelHostedClient()) return null;
  const { min, max } = estimateProdFullCollectMinutes(rangeStart, rangeEnd);
  const fusionBatches = countFusionVercelBatches(rangeStart, rangeEnd);
  return `本番サイトでは全体でおおよそ ${min}〜${max} 分かかります（FusionSolar は ${fusionBatches} リクエスト）。タブを閉じずにお待ちください。`;
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
  return `※ FusionSolar の進捗（${chunkKey}）が ${mins} 分間変わっていません。15分以上停止している場合は「実行取消」後、期間を分けて再実行してください。`;
}
