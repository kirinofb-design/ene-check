import type { PrismaClient } from "@prisma/client";

export type ForcedZeroRule = {
  siteName: string;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  status: string;
};

// 監視装置停止や計測不良など、期間中を強制0にしたいサイトをここで管理する
export const FORCED_ZERO_RULES: ForcedZeroRule[] = [
  { siteName: "落居（笠名高圧）", from: "2026-04-01", to: "2026-04-30", status: "laplace" },
];

export function parseYmdToUtcDate(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0));
}

function intersectRuleRange(rule: ForcedZeroRule, start: Date, end: Date): { start: Date; end: Date } | null {
  const from = parseYmdToUtcDate(rule.from);
  const to = parseYmdToUtcDate(rule.to);
  if (!from || !to) return null;
  const rangeStart = new Date(Math.max(start.getTime(), from.getTime()));
  const rangeEnd = new Date(Math.min(end.getTime(), to.getTime()));
  if (rangeStart.getTime() > rangeEnd.getTime()) return null;
  return { start: rangeStart, end: rangeEnd };
}

export function shouldForceZero(
  siteName: string,
  dateUtc: Date,
  status?: string,
  rules: ForcedZeroRule[] = FORCED_ZERO_RULES
): boolean {
  for (const rule of rules) {
    if (rule.siteName !== siteName) continue;
    if (status && rule.status !== status) continue;
    const range = intersectRuleRange(rule, dateUtc, dateUtc);
    if (range) return true;
  }
  return false;
}

export async function applyForcedZeroOverrides(
  prisma: PrismaClient,
  start: Date,
  end: Date,
  status?: string,
  rules: ForcedZeroRule[] = FORCED_ZERO_RULES
): Promise<void> {
  for (const rule of rules) {
    if (status && rule.status !== status) continue;
    const range = intersectRuleRange(rule, start, end);
    if (!range) continue;

    const site = await prisma.site.findFirst({
      where: { siteName: rule.siteName },
      select: { id: true },
    });
    if (!site) continue;

    const ops: Array<ReturnType<typeof prisma.dailyGeneration.upsert>> = [];
    const cur = new Date(range.start);
    while (cur.getTime() <= range.end.getTime()) {
      const day = new Date(cur);
      ops.push(
        prisma.dailyGeneration.upsert({
          where: { siteId_date: { siteId: site.id, date: day } },
          create: { siteId: site.id, date: day, generation: 0, status: rule.status },
          update: { generation: 0, status: rule.status, updatedAt: new Date() },
        })
      );
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    if (ops.length > 0) await prisma.$transaction(ops);
  }
}
