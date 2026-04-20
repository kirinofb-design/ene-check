import { prisma } from "@/lib/prisma";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Neon 等の一時切断に耐えるため、短いバックオフで接続確認する */
export async function ensureDbReachable(retries = 5): Promise<void> {
  let lastError: unknown = null;
  for (let i = 0; i < retries; i++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (e) {
      lastError = e;
      if (i < retries - 1) {
        await sleep(1200 * (i + 1));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Database unreachable");
}
