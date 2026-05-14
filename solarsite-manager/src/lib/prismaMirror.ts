import { PrismaClient } from "@prisma/client";
import { augmentPostgresDatabaseUrl } from "@/lib/dbUrl";

const globalForMirror = globalThis as unknown as {
  prismaMirror: PrismaClient | undefined;
};

/**
 * 全データ一括取得後に日次発電量だけを複製する先の DB（任意）。
 * DATABASE_URL と同一・未設定のときは使わない。
 */
export function getMirrorPrisma(): PrismaClient | null {
  const raw = process.env.DATABASE_MIRROR_URL?.trim();
  if (!raw) return null;
  const primary = (process.env.DATABASE_URL ?? "").trim();
  if (raw === primary) return null;

  if (!globalForMirror.prismaMirror) {
    const url = augmentPostgresDatabaseUrl(raw);
    globalForMirror.prismaMirror = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
      datasources: { db: { url: url || raw } },
    });
  }
  return globalForMirror.prismaMirror;
}
