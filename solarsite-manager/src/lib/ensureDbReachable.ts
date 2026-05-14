import { prisma } from "@/lib/prisma";
import { withPrismaRetry } from "@/lib/withPrismaRetry";

/**
 * Neon 等の一時切断・スリープ復帰直後に耐えるため、接続確立後に SELECT 1 をリトライ付きで実行する。
 * 成否は withPrismaRetry 内の指数バックオフに任せる（非一時エラーは即失敗）。
 */
export async function ensureDbReachable(retries = 8): Promise<void> {
  await prisma.$connect().catch(() => {});
  await withPrismaRetry(() => prisma.$queryRaw`SELECT 1`, {
    retries,
    baseDelayMs: 1000,
    maxDelayMs: 14000,
  });
}
