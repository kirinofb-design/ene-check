import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withPrismaRetry } from "@/lib/withPrismaRetry";

export const runtime = "nodejs";

export async function GET() {
  const hasNextAuthSecret =
    typeof process.env.NEXTAUTH_SECRET === "string" &&
    process.env.NEXTAUTH_SECRET.length > 0;
  const hasAuthSecret =
    typeof process.env.AUTH_SECRET === "string" &&
    process.env.AUTH_SECRET.length > 0;
  const hasNextAuthUrl =
    typeof process.env.NEXTAUTH_URL === "string" &&
    process.env.NEXTAUTH_URL.length > 0;
  const hasDatabaseUrl =
    typeof process.env.DATABASE_URL === "string" &&
    /^(postgresql|postgres):\/\//.test(process.env.DATABASE_URL);

  let dbOk = false;
  let dbError: string | null = null;
  try {
    await withPrismaRetry(() => prisma.$queryRaw`SELECT 1`, { retries: 4, baseDelayMs: 600, maxDelayMs: 8000 });
    dbOk = true;
  } catch (err) {
    dbError = err instanceof Error ? err.message : "DB query failed";
  }

  return NextResponse.json({
    ok:
      (hasNextAuthSecret || hasAuthSecret) &&
      hasNextAuthUrl &&
      hasDatabaseUrl &&
      dbOk,
    auth: {
      hasNextAuthSecret,
      hasAuthSecret,
      hasNextAuthUrl,
    },
    database: {
      hasDatabaseUrl,
      dbOk,
      dbError,
    },
  });
}
