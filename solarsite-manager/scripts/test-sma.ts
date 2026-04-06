const { prisma } = require("../src/lib/prisma") as typeof import("../src/lib/prisma");
const { runSmaCollectorCookie } = require("../src/lib/smaCollectorCookie") as typeof import("../src/lib/smaCollectorCookie");

function toYmdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function resolveUserId(cliUserId?: string): Promise<string> {
  if (cliUserId) return cliUserId;
  const firstUser = await prisma.user.findFirst({
    select: { id: true, email: true },
    orderBy: { createdAt: "asc" },
  });
  if (!firstUser) {
    throw new Error("User が存在しません。userId を引数で指定してください。");
  }
  console.log(`[test-sma] userId 未指定のため先頭ユーザーを使用: ${firstUser.email} (${firstUser.id})`);
  return firstUser.id;
}

async function main() {
  const cliUserId = process.argv[2];
  const cliStart = process.argv[3];
  const cliEnd = process.argv[4];

  const now = new Date();
  const defaultEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const defaultStart = new Date(defaultEnd);
  defaultStart.setUTCDate(defaultStart.getUTCDate() - 7);

  const userId = await resolveUserId(cliUserId);
  const startDate = cliStart ?? toYmdUtc(defaultStart);
  const endDate = cliEnd ?? toYmdUtc(defaultEnd);

  console.log(`[test-sma] start userId=${userId} range=${startDate}..${endDate}`);
  const result = await runSmaCollectorCookie(userId, startDate, endDate);
  console.log("[test-sma] result", JSON.stringify(result, null, 2));
}

main()
  .catch((e) => {
    console.error("[test-sma] failed", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
