import { prisma } from "@/lib/prisma";

function toJstDateParts(date: Date): { year: number; month: number; day: number } {
  const jstMs = date.getTime() + 9 * 60 * 60 * 1000;
  const jst = new Date(jstMs);
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
    day: jst.getUTCDate(),
  };
}

export function getStartAndEndDateJstMonthToYesterday(): { startDate: string; endDate: string } {
  const now = new Date();
  const today = toJstDateParts(now);
  const yesterdayUtc = new Date(Date.UTC(today.year, today.month - 1, today.day - 1, 0, 0, 0, 0));
  const y = yesterdayUtc.getUTCFullYear();
  const m = yesterdayUtc.getUTCMonth() + 1;
  const d = yesterdayUtc.getUTCDate();

  const startDate = `${y}-${String(m).padStart(2, "0")}-01`;
  const endDate = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { startDate, endDate };
}

export function isAuthorizedByCronSecret(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const authHeader = request.headers.get("authorization") ?? "";
  return authHeader === `Bearer ${cronSecret}`;
}

export async function resolveCronUserId(): Promise<string | null> {
  const byId = process.env.CRON_COLLECT_USER_ID?.trim();
  if (byId) return byId;

  const byEmail = process.env.CRON_COLLECT_USER_EMAIL?.trim();
  if (byEmail) {
    const user = await prisma.user.findUnique({
      where: { email: byEmail },
      select: { id: true },
    });
    if (user?.id) return user.id;
  }

  const cred = await prisma.monitoringCredential.findFirst({
    select: { userId: true },
    orderBy: { createdAt: "asc" },
  });
  return cred?.userId ?? null;
}
