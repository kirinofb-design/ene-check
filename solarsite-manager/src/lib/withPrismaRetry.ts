import { prisma } from "@/lib/prisma";
import { isTransientDatabaseError } from "@/lib/transientDbErrors";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type RetryOpts = {
  /** 初回を含む最大試行回数 */
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** true のとき、再試行前に Prisma の接続を張り直す（長時間ジョブ後の P1001 向け） */
  reconnectBetweenAttempts?: boolean;
};

/**
 * Neon の瞬断やスリープ復帰直後など、一時的な DB 失敗に対して指数バックオフで再試行する。
 * 非一時エラーは即再スローする。
 */
export async function withPrismaRetry<T>(fn: () => Promise<T>, opts?: RetryOpts): Promise<T> {
  const retries = opts?.retries ?? 6;
  const base = opts?.baseDelayMs ?? 900;
  const maxD = opts?.maxDelayMs ?? 12000;
  const reconnect = opts?.reconnectBetweenAttempts ?? true;
  let last: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i >= retries - 1 || !isTransientDatabaseError(e)) {
        throw e;
      }
      if (reconnect) {
        await prisma.$connect().catch(() => {});
      }
      const delay = Math.min(maxD, base * 2 ** i + Math.floor(Math.random() * 500));
      await sleep(delay);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** ブラウザ収集など数分〜十数分かかる処理の直後の DB アクセス向け */
export const PRISMA_RETRY_COLLECTOR: RetryOpts = {
  retries: 12,
  baseDelayMs: 1200,
  maxDelayMs: 28000,
  reconnectBetweenAttempts: true,
};
