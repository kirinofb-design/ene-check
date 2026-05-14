import { PrismaClient } from "@prisma/client";
import { augmentPostgresDatabaseUrl } from "@/lib/dbUrl";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function prismaLogLevel(): Array<"query" | "error" | "warn"> | Array<"error"> {
  if (process.env.NODE_ENV !== "development") return ["error"];
  // 大量 upsert 時の標準出力ボトルネック回避: 通常は query ログを出さない
  // 必要時のみ PRISMA_QUERY_LOG=1 を設定して詳細ログを有効化する
  if (process.env.PRISMA_QUERY_LOG === "1") return ["query", "error", "warn"];
  return ["error", "warn"];
}

const effectiveDbUrl = augmentPostgresDatabaseUrl(process.env.DATABASE_URL);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: prismaLogLevel(),
    datasources: {
      db: { url: effectiveDbUrl || process.env.DATABASE_URL },
    },
  });

// Vercel などサーバーレスではインスタンスを使い回さないと接続枯渇・不安定化しやすい
globalForPrisma.prisma = prisma;

