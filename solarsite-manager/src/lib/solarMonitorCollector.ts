import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { decryptSecret } from "@/lib/encryption";
import { collectSolarMonitor, loginAndOpenSolarMonitorMenu } from "@/lib/solarMonitorBaseCollector";
import { launchChromiumForRuntime } from "@/lib/playwrightRuntime";
import { throwIfAllCollectCancelled } from "@/lib/collectCancel";

const TARGET_PLANTS_SF = [
  {
    optionText: "フジ物産御前崎市池新田南低圧",
    siteKeyword: "池新田",
    linkKeyword: "池新田",
  },
  {
    optionText: "フジ物産（株）本社",
    siteKeyword: "本社",
    linkKeyword: "本社",
  },
] as const;

const TARGET_PLANTS_SE = [
  {
    optionText: "フジ物産㈱裾野",
    siteKeyword: "須山",
    linkKeyword: "裾野",
  },
] as const;

type SolarMonitorSystemId = "solar-monitor-sf" | "solar-monitor-se";

function getSolarMonitorConfig(systemId: SolarMonitorSystemId) {
  if (systemId === "solar-monitor-se") {
    return {
      loginUrl: "https://solar-monitor.solar-energy.co.jp/ssm/pg/LoginPage.aspx",
      menuUrl: "https://solar-monitor.solar-energy.co.jp/ssm/pg/hk/HKMenuPage.aspx",
      targetPlants: TARGET_PLANTS_SE,
    };
  }
  return {
    loginUrl: "https://solar-monitor.solar-frontier.com/frontier/pg/hk/HatsudenshoListPage.aspx",
    menuUrl: "https://solar-monitor.solar-frontier.com/frontier/pg/hk/HKMenuPage.aspx",
    targetPlants: TARGET_PLANTS_SF,
  };
}

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseYmdToUtcDate(ymd: string): Date | null {
  if (!isYmd(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function getMonthsInRange(startDate: Date, endDate: Date): string[] {
  const months: string[] = [];
  const cur = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1));
  while (cur.getTime() <= end.getTime()) {
    months.push(`${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, "0")}`);
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return months;
}

function normalizeName(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, "").trim();
}

function normalizeMonitoringSystemId(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase().replace(/\s+/g, "");
}


export async function runSolarMonitorCollector(
  userId: string,
  startDate: string,
  endDate: string,
  systemId: SolarMonitorSystemId = "solar-monitor-sf"
): Promise<{ recordCount: number; errorCount: number }> {
  try {
    throwIfAllCollectCancelled(userId);
    const start = parseYmdToUtcDate(startDate);
    const end = parseYmdToUtcDate(endDate);
    if (!start || !end) {
      throw new Error("SolarMonitor: startDate/endDate は YYYY-MM-DD 形式で指定してください。");
    }
    if (start.getTime() > end.getTime()) {
      throw new Error("SolarMonitor: 開始日は終了日以前にしてください。");
    }

    const cfg = getSolarMonitorConfig(systemId);

    const cred = await prisma.monitoringCredential.findFirst({
      where: { userId, systemId },
      select: { loginId: true, encryptedPassword: true },
    });
    if (!cred) {
      throw new Error("SolarMonitor の認証情報が未登録です（/settings で登録してください）。");
    }
    const loginId = cred.loginId.trim();
    const password = decryptSecret(cred.encryptedPassword).trim();

    const allSites = await prisma.site.findMany({
      select: { id: true, siteName: true, monitoringSystem: true },
    });
    // 既存DBには "solar-monitor" / "solar-monitor-sf" / "solar-monitor-se" が混在しうる
    const sites = allSites.filter((s) => normalizeMonitoringSystemId(s.monitoringSystem).includes("solar-monitor"));

    const siteByPlant = new Map<string, { id: string; siteName: string }>();
    for (const plant of cfg.targetPlants) {
      throwIfAllCollectCancelled(userId);
      const hitPool = sites.length > 0 ? sites : allSites;
      const hit = hitPool.find((s) => normalizeName(s.siteName).includes(normalizeName(plant.siteKeyword)));
      if (!hit) {
        logger.warn("solarMonitorCollector: site not found", { extra: { plant: plant.optionText } });
        continue;
      }
      siteByPlant.set(plant.optionText, hit);
    }

    let browser = await launchChromiumForRuntime({
      headless: true,
      extraArgs: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    });

    let recordCount = 0;
    let errorCount = 0;

    try {
      const createBrowserContext = async () => {
        try {
          return await browser.newContext({ acceptDownloads: true });
        } catch {
          await browser.close().catch(() => {});
          browser = await launchChromiumForRuntime({
            headless: true,
            extraArgs: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
          });
          return await browser.newContext({ acceptDownloads: true });
        }
      };

      let context = await createBrowserContext();
      let page = await context.newPage();
      page.setDefaultTimeout(60_000);

      const createSession = async () => {
        await context.close().catch(() => {});
        context = await createBrowserContext();
        page = await context.newPage();
        page.setDefaultTimeout(60_000);
        await loginAndOpenSolarMonitorMenu(page, {
          loginUrl: cfg.loginUrl,
          loginId,
          password,
          openPlantListFromMenu: systemId === "solar-monitor-se",
        });
      };

      await createSession();

      const links = await page.$$eval("#cphMain_gvList a", (els) =>
        els.map((e) => ({ text: e.textContent?.trim() ?? "", id: (e as HTMLAnchorElement).id ?? "" }))
      );

      const months = getMonthsInRange(start, end);
      for (const plant of cfg.targetPlants) {
        throwIfAllCollectCancelled(userId);
        const site = siteByPlant.get(plant.optionText);
        if (!site) continue;

        const matched = links.find((l) => l.text.includes(plant.linkKeyword));
        void matched;

        for (const yearMonth of months) {
          throwIfAllCollectCancelled(userId);
          const [yearStr, monthStr] = yearMonth.split("-");
          const collectMonthRows = async () =>
            collectSolarMonitor({
              page,
              siteName: plant.linkKeyword,
              year: Number(yearStr),
              month: Number(monthStr),
            });

          let rows: Awaited<ReturnType<typeof collectMonthRows>> = [];
          try {
            rows = await collectMonthRows();
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            const retryable =
              msg.includes("Execution context was destroyed") ||
              msg.includes("Target page, context or browser has been closed") ||
              msg.includes("ERR_INSUFFICIENT_RESOURCES");
            if (!retryable) throw e;
            await createSession();
            rows = await collectMonthRows();
          }
          let savedInMonth = 0;
          for (const row of rows) {
            throwIfAllCollectCancelled(userId);
            if (row.date.getTime() < start.getTime() || row.date.getTime() > end.getTime()) {
              continue;
            }
            await prisma.dailyGeneration.upsert({
              where: { siteId_date: { siteId: site.id, date: row.date } },
              create: {
                siteId: site.id,
                date: row.date,
                generation: row.generation,
                status: row.status,
              },
              update: {
                generation: row.generation,
                status: row.status,
                updatedAt: new Date(),
              },
            });
            recordCount++;
            savedInMonth++;
          }

          if (savedInMonth === 0) {
            console.log("[SOLAR_MONITOR_EMPTY_FETCH]", {
              systemId,
              dbSiteName: site.siteName,
              plantOptionText: plant.optionText,
              siteKeyword: plant.siteKeyword,
              linkKeyword: plant.linkKeyword,
              yearMonth,
              requestStartDate: startDate,
              requestEndDate: endDate,
              excelRowCount: rows.length,
            });
          }

          logger.info("solarMonitorCollector: month processed", {
            extra: {
              plant: plant.optionText,
              siteName: site.siteName,
              yearMonth,
              recordCount: rows.length,
              errorCount: 0,
            },
          });
        }
      }
    } catch (e) {
      console.error("[FATAL]", e);
      throw e;
    } finally {
      await browser.close().catch(() => {});
    }

    return { recordCount, errorCount };
  } catch (e) {
    console.error("[FATAL]", e);
    throw e;
  }
}
