const { prisma } = require("../src/lib/prisma") as typeof import("../src/lib/prisma");
const {
  FORCED_ZERO_RULES,
  parseYmdToUtcDate,
} = require("../src/lib/forcedZeroRules") as typeof import("../src/lib/forcedZeroRules");

function parseTargetMonthArg(): { year: number; month: number } {
  const arg = process.argv[2];
  if (!arg) {
    const now = new Date();
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  }
  const m = /^(\d{4})-(\d{2})$/.exec(arg);
  if (!m) throw new Error("月指定は YYYY-MM 形式で指定してください。例: npm run check:forced-zero -- 2026-04");
  return { year: Number(m[1]), month: Number(m[2]) };
}

function monthRangeUtc(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 0, 0, 0, 0, 0));
  return { start, end };
}

async function main() {
  const { year, month } = parseTargetMonthArg();
  const monthRange = monthRangeUtc(year, month);
  const failures: string[] = [];

  for (const rule of FORCED_ZERO_RULES) {
    const from = parseYmdToUtcDate(rule.from);
    const to = parseYmdToUtcDate(rule.to);
    if (!from || !to) continue;
    const start = new Date(Math.max(monthRange.start.getTime(), from.getTime()));
    const end = new Date(Math.min(monthRange.end.getTime(), to.getTime()));
    if (start.getTime() > end.getTime()) continue;

    const site = await prisma.site.findFirst({
      where: { siteName: rule.siteName },
      select: { id: true },
    });
    if (!site) {
      failures.push(`${rule.siteName}: site が存在しません`);
      continue;
    }

    for (let cur = new Date(start); cur.getTime() <= end.getTime(); cur.setUTCDate(cur.getUTCDate() + 1)) {
      const day = new Date(cur);
      const rec = await prisma.dailyGeneration.findUnique({
        where: { siteId_date: { siteId: site.id, date: day } },
        select: { generation: true, status: true },
      });
      if (!rec) {
        failures.push(`${rule.siteName} ${day.toISOString().slice(0, 10)}: レコード未作成`);
        continue;
      }
      if (Number(rec.generation) !== 0) {
        failures.push(`${rule.siteName} ${day.toISOString().slice(0, 10)}: generation=${rec.generation}`);
      }
    }
  }

  if (failures.length > 0) {
    console.error("forced-zero check failed:");
    for (const f of failures) console.error(` - ${f}`);
    process.exit(1);
  }

  console.log(`forced-zero check passed for ${year}-${String(month).padStart(2, "0")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
