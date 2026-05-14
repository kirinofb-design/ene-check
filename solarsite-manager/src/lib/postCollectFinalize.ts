import { prisma } from "@/lib/prisma";
import { applyForcedZeroOverrides, parseYmdToUtcDate } from "@/lib/forcedZeroRules";
import { withPrismaRetry } from "@/lib/withPrismaRetry";
import {
  syncDailyGenerationMirrorIfConfigured,
  type MirrorSyncResult,
} from "@/lib/syncDailyGenerationMirror";

/**
 * 全システム収集後の後処理（強制0ルールの適用・ミラーDB同期）。
 * UI の「ブラウザ側一括」とサーバ `/api/collect/all` の双方から呼ぶ。
 */
export async function postCollectAfterAllSystems(
  startDate: string,
  endDate: string
): Promise<{ mirrorSync: MirrorSyncResult | null }> {
  const reqStart = parseYmdToUtcDate(startDate);
  const reqEnd = parseYmdToUtcDate(endDate);
  if (reqStart && reqEnd) {
    await withPrismaRetry(() => applyForcedZeroOverrides(prisma, reqStart, reqEnd, "laplace"), {
      retries: 5,
      baseDelayMs: 1200,
      maxDelayMs: 15000,
    });
  }

  const mirrorSync =
    Boolean(process.env.DATABASE_MIRROR_URL?.trim())
      ? await syncDailyGenerationMirrorIfConfigured(startDate, endDate)
      : null;

  return { mirrorSync };
}
