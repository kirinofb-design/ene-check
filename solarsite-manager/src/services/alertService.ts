import { prisma } from "@/lib/prisma";

const ALERT_TYPES = {
  POWER_STOP: "POWER_STOP",
  POWER_LOW: "POWER_LOW",
  DATA_MISSING: "DATA_MISSING",
} as const;

export async function checkAlerts(siteId: string): Promise<void> {
  await checkPowerStop(siteId);
  await checkPowerLow(siteId);
  await checkDataMissing(siteId);
}

async function hasUnresolvedAlert(siteId: string, alertType: string): Promise<boolean> {
  const exists = await prisma.alert.findFirst({
    where: { siteId, alertType, resolvedAt: null },
  });
  return !!exists;
}

async function checkPowerStop(siteId: string): Promise<void> {
  const recent = await prisma.dailyGeneration.findMany({
    where: { siteId },
    orderBy: { date: "desc" },
    take: 2,
  });

  if (
    recent.length >= 2 &&
    recent[0].generation === 0 &&
    recent[1].generation === 0
  ) {
    if (await hasUnresolvedAlert(siteId, ALERT_TYPES.POWER_STOP)) return;

    await prisma.alert.create({
      data: {
        siteId,
        alertType: ALERT_TYPES.POWER_STOP,
        severity: "CRITICAL",
        message: "発電が停止しています（2日連続0kWh）",
      },
    });
  }
}

async function checkPowerLow(siteId: string): Promise<void> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const last30 = await prisma.dailyGeneration.findMany({
    where: { siteId, date: { gte: thirtyDaysAgo } },
    orderBy: { date: "asc" },
  });

  if (last30.length < 4) return; // 最低4日分必要

  const avg =
    last30.reduce((s, r) => s + r.generation, 0) / last30.length;
  const threshold = avg * 0.5;

  const last3 = last30.slice(-3);
  const allBelow = last3.every((r) => r.generation < threshold);

  if (allBelow && threshold > 0) {
    if (await hasUnresolvedAlert(siteId, ALERT_TYPES.POWER_LOW)) return;

    await prisma.alert.create({
      data: {
        siteId,
        alertType: ALERT_TYPES.POWER_LOW,
        severity: "WARNING",
        message: `発電量が低下しています（過去30日平均の50%未満が3日連続）`,
      },
    });
  }
}

async function checkDataMissing(siteId: string): Promise<void> {
  const latest = await prisma.dailyGeneration.findFirst({
    where: { siteId },
    orderBy: { date: "desc" },
  });

  if (!latest) {
    if (await hasUnresolvedAlert(siteId, ALERT_TYPES.DATA_MISSING)) return;
    await prisma.alert.create({
      data: {
        siteId,
        alertType: ALERT_TYPES.DATA_MISSING,
        severity: "WARNING",
        message: "発電量データがまだ登録されていません。",
      },
    });
    return;
  }

  const daysSince = Math.floor(
    (Date.now() - latest.date.getTime()) / (24 * 60 * 60 * 1000)
  );

  if (daysSince > 7) {
    if (await hasUnresolvedAlert(siteId, ALERT_TYPES.DATA_MISSING)) return;

    await prisma.alert.create({
      data: {
        siteId,
        alertType: ALERT_TYPES.DATA_MISSING,
        severity: "WARNING",
        message: `最終データから${daysSince}日経過しています（7日超過）`,
      },
    });
  }
}
