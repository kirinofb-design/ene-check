import { prisma } from "@/lib/prisma";
import { getMirrorPrisma } from "@/lib/prismaMirror";
import { parseYmdToUtcDate } from "@/lib/forcedZeroRules";
import { logger } from "@/lib/logger";
import { withPrismaRetry } from "@/lib/withPrismaRetry";

export type MirrorSyncResult =
  | { ok: true; upserted: number; skippedNoMirrorSite: number }
  | { ok: false; message: string; upserted: number; skippedNoMirrorSite: number };

/**
 * 主 DB（DATABASE_URL）の指定期間の dailyGeneration を、ミラー DB に siteName 単位で複製する。
 * Site.id（cuid）は環境間で一致しないため、発電所名で mirror 側 Site を解決する。
 */
export async function syncDailyGenerationMirrorIfConfigured(
  startDate: string,
  endDate: string
): Promise<MirrorSyncResult | null> {
  const mirror = getMirrorPrisma();
  if (!mirror) return null;

  const start = parseYmdToUtcDate(startDate);
  const end = parseYmdToUtcDate(endDate);
  if (!start || !end) {
    return { ok: false, message: "日付範囲が不正です。", upserted: 0, skippedNoMirrorSite: 0 };
  }

  let upserted = 0;
  let skippedNoMirrorSite = 0;

  try {
    const rows = await prisma.dailyGeneration.findMany({
      where: { date: { gte: start, lte: end } },
      include: { site: { select: { siteName: true } } },
    });

    const names = [...new Set(rows.map((r) => r.site.siteName))];
    const mirrorSites = await withPrismaRetry(() =>
      mirror.site.findMany({
        where: { siteName: { in: names } },
        select: { id: true, siteName: true },
      })
    );
    const mirrorIdByName = new Map(mirrorSites.map((s) => [s.siteName, s.id]));

    type OpRow = {
      siteId: string;
      date: Date;
      generation: number;
      status: string | null;
      notes: string | null;
    };
    const ops: OpRow[] = [];
    for (const r of rows) {
      const mid = mirrorIdByName.get(r.site.siteName);
      if (!mid) {
        skippedNoMirrorSite++;
        continue;
      }
      ops.push({
        siteId: mid,
        date: r.date,
        generation: r.generation,
        status: r.status,
        notes: r.notes,
      });
    }

    const CHUNK = 35;
    for (let i = 0; i < ops.length; i += CHUNK) {
      const slice = ops.slice(i, i + CHUNK);
      await withPrismaRetry(() =>
        mirror.$transaction(
          slice.map((r) =>
            mirror.dailyGeneration.upsert({
              where: { siteId_date: { siteId: r.siteId, date: r.date } },
              create: {
                siteId: r.siteId,
                date: r.date,
                generation: r.generation,
                status: r.status,
                notes: r.notes,
              },
              update: {
                generation: r.generation,
                status: r.status,
                notes: r.notes,
                updatedAt: new Date(),
              },
            })
          )
        )
      );
      upserted += slice.length;
    }

    if (skippedNoMirrorSite > 0) {
      logger.warn("syncDailyGenerationMirror: some sites missing on mirror DB", {
        extra: { skippedNoMirrorSite, upserted },
      });
    }

    return { ok: true, upserted, skippedNoMirrorSite };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error("syncDailyGenerationMirror failed", { extra: { message } }, e);
    return { ok: false, message, upserted, skippedNoMirrorSite };
  }
}
