import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

const SMA_COOKIE_MISSING_ERROR = "SMA Cookie が未登録または期限切れです。/settings から Cookie を登録してください。";

const SMA_STATIONS = [
  {
    displayName: "フジ物産牧之原太陽光発電設備",
    siteName: "坂口（高圧）",
    plantId: "4491962d-9b59-43c7-8124-c499a199b0c9",
  },
  {
    displayName: "フジ物産白羽高圧発電所",
    siteName: "大塚（高圧）",
    plantId: "381af69d-4653-49de-ad89-6c145f86faf9",
  },
];

type SmaTableCellRow = string[];

function parseYmdToUtcDate(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function parseDateTextToUtcDate(text: string): Date | null {
  const normalized = text
    .trim()
    .replace(/[年月]/g, "-")
    .replace(/日/g, "")
    .replace(/[./]/g, "-")
    .replace(/\s+/g, "");
  const m = normalized.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0));
}

function parseGenerationKwh(text: string): number | null {
  const normalized = text.replace(/kwh/gi, "").replace(/,/g, "").trim();
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

function pickDateAndGenerationFromRow(cells: SmaTableCellRow): { dateUtc: Date | null; generation: number | null } {
  let dateUtc: Date | null = null;
  let generation: number | null = null;
  for (const cell of cells) {
    if (!dateUtc) {
      const d = parseDateTextToUtcDate(cell);
      if (d) dateUtc = d;
    }
    const g = parseGenerationKwh(cell);
    if (g !== null) {
      generation = generation === null ? g : Math.max(generation, g);
    }
  }
  return { dateUtc, generation };
}

async function extractTableRows(page: any): Promise<SmaTableCellRow[]> {
  const rows = (await page.evaluate(() => {
    const trs = Array.from(document.querySelectorAll("table tr"));
    return trs
      .map((tr) =>
        Array.from(tr.querySelectorAll("th,td"))
          .map((cell) => (cell.textContent ?? "").trim())
          .filter((v) => v.length > 0)
      )
      .filter((cells) => cells.length >= 2);
  })) as SmaTableCellRow[];
  return rows;
}

async function clickRedirectLinkAndResolvePage(
  page: any,
  plantOid: string
): Promise<{ page: any; urlAfterClick: string | null }> {
  const selector = `a[href*="/RedirectToPlant/${plantOid}"]`;
  const hasPlaywrightContext = page && typeof page.context === "function" && typeof page.waitForURL === "function";

  if (hasPlaywrightContext) {
    const context = page.context();
    const popupPromise =
      context && typeof context.waitForEvent === "function"
        ? context.waitForEvent("page", { timeout: 5000 }).catch(() => null)
        : Promise.resolve(null);
    await page.click(selector, { timeout: 15000 });
    const popup = await popupPromise;
    const targetPage = popup ?? page;
    if (targetPage === page) {
      await page.waitForURL(/sunnyportal\.com/i, { timeout: 15000 }).catch(() => {});
    } else if (typeof targetPage.waitForLoadState === "function") {
      await targetPage.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    }
    const urlAfterClick = typeof targetPage.url === "function" ? targetPage.url() : null;
    return { page: targetPage, urlAfterClick };
  }

  const browser = page.browser();
  const newTargetPromise = browser
    .waitForTarget((target: any) => target.opener() === page.target(), { timeout: 5000 })
    .catch(() => null);
  await page.click(selector);
  const newTarget = await newTargetPromise;
  if (newTarget) {
    const newPage = await newTarget.page();
    if (newPage) {
      await newPage.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
      return { page: newPage, urlAfterClick: newPage.url() };
    }
  }
  await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
  return { page, urlAfterClick: page.url() };
}

// NOTE: 旧実装（CSVダウンロード/画面遷移）で使っていたヘルパーは廃止

async function gotoNetworkIdle(page: any, url: string, timeoutMs?: number) {
  // Playwright は waitUntil: "networkidle"
  // Puppeteer は waitUntil: "networkidle2"（相当）
  const isPlaywright = page && typeof page.waitForLoadState === "function";
  const waitUntil = isPlaywright ? "networkidle" : "networkidle2";
  const opts: any = { waitUntil };
  if (typeof timeoutMs === "number") opts.timeout = timeoutMs;
  await page.goto(url, opts);
}

export async function runSmaCollectorCookie(
  userId: string,
  startDate: string,
  endDate: string
): Promise<{ ok: boolean; message: string; recordCount: number; errorCount: number }> {
  const start = parseYmdToUtcDate(startDate);
  const end = parseYmdToUtcDate(endDate);
  if (!start || !end) return { ok: false, message: "日付形式が不正です", recordCount: 0, errorCount: 0 };

  let recordCount = 0;

  const cookieRow = await prisma.smaCookieCache.findFirst({
    where: { userId, expiresAt: { gt: new Date() } },
    select: { cookieJson: true, expiresAt: true },
  });
  if (!cookieRow) {
    return { ok: false, message: SMA_COOKIE_MISSING_ERROR, recordCount: 0, errorCount: 0 };
  }
  logger.info("smaCollector: loaded cookie json", {
    userId,
    extra: {
      cookieJson: cookieRow.cookieJson.substring(0, 200),
    },
  });

  const parsedCookies = (() => {
    try {
      const parsed = JSON.parse(cookieRow.cookieJson) as any;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((x: any) => typeof x?.name === "string" && typeof x?.value === "string")
          .map((x: any) => ({
            name: x.name,
            value: x.value,
            domain: typeof x.domain === "string" && x.domain.length > 0 ? x.domain : "www.sunnyportal.com",
            path: typeof x.path === "string" && x.path.length > 0 ? x.path : "/",
            httpOnly: typeof x.httpOnly === "boolean" ? x.httpOnly : true,
            secure: typeof x.secure === "boolean" ? x.secure : true,
            sameSite: "Lax" as const,
          }));
      }
      if (parsed && typeof parsed === "object" && typeof parsed.formsLogin === "string") {
        return [
          {
            name: ".SunnyPortalFormsLogin",
            value: parsed.formsLogin,
            domain: "www.sunnyportal.com",
            path: "/",
            httpOnly: true,
            secure: true,
            sameSite: "Lax" as const,
          },
        ];
      }
      return [];
    } catch {
      return [];
    }
  })();
  if (!Array.isArray(parsedCookies) || parsedCookies.length === 0) {
    return { ok: false, message: "SMA Cookie が不正です。再登録してください。", recordCount: 0, errorCount: 0 };
  }

  const formsLoginOnly = parsedCookies.filter(
    (c) => c.name === ".SunnyPortalFormsLogin" || c.name === "SunnyPortalFormsLogin"
  );
  const portalCookies = parsedCookies.filter((c) => /sunnyportal\.com/i.test(c.domain ?? ""));
  const hasFormsInPortal = portalCookies.some((c) => /SunnyPortalFormsLogin/i.test(c.name));
  // 複数 Cookie を登録済みなら sunnyportal 向けをまとめて注入（セッション維持に有効）
  const cookiesToInject =
    portalCookies.length >= 2 && hasFormsInPortal ? portalCookies : formsLoginOnly;

  if (cookiesToInject.length === 0) {
    return {
      ok: false,
      message:
        ".SunnyPortalFormsLogin が見つかりません。設定で value のみ、または Chrome の Cookie 配列（JSON）を登録してください。",
      recordCount: 0,
      errorCount: 0,
    };
  }

  const puppeteer = (await import("puppeteer-extra")).default;
  const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
  puppeteer.use(StealthPlugin());

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-setuid-sandbox"],
  });

  try {
    let page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({ "Accept-Language": "ja,en-US;q=0.9,en;q=0.8" }).catch(() => {});
    await page.emulateTimezone("Asia/Tokyo").catch(() => {});
    page.setDefaultTimeout(60000);

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
      Object.defineProperty(navigator, "language", { get: () => "ja-JP" });
      Object.defineProperty(navigator, "languages", { get: () => ["ja-JP", "ja", "en-US"] });
    });

    // Playwright: context.addCookies / context.cookies
    // Puppeteer: page.setCookie / page.cookies
    const pw = page as { context?: () => { addCookies?: (cookies: unknown) => Promise<void> } };
    const hasPlaywrightContext = pw && typeof pw.context === "function";
    const context = hasPlaywrightContext ? pw.context!() : null;
    const addCookiesFn =
      context && typeof context.addCookies === "function" ? context.addCookies : null;
    logger.info("smaCollector: cookies to inject", {
      userId,
      extra: {
        cookies: cookiesToInject.map((c: any) => ({
          name: c.name,
          domain: c.domain,
          valueHead: c.value?.substring(0, 8),
        })),
      },
    });

    const cookiesForPuppeteer = cookiesToInject.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
    }));
    const cookiesForPlaywright = cookiesToInject.map((c) => ({
      name: c.name,
      value: c.value,
      url: "https://www.sunnyportal.com",
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
    }));
    if (addCookiesFn) {
      await addCookiesFn(cookiesForPlaywright);
    } else {
      await page.setCookie(...cookiesForPuppeteer);
    }

    await gotoNetworkIdle(page, "https://www.sunnyportal.com/Plants");
    const currentCookies = await page.cookies();
    const documentCookieAtPlants = (await page.evaluate(() => document.cookie).catch(() => "")) as string;
    const redirectLinksOnPlants = (await page
      .evaluate(() => {
        const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="RedirectToPlant"]'));
        return anchors
          .map((a) => {
            const href = a.getAttribute("href") ?? "";
            const text = (a.textContent ?? "").trim();
            const m = href.match(/RedirectToPlant\/([a-f0-9-]+)/i);
            return {
              text,
              href,
              plantOid: m ? m[1] : null,
            };
          })
          .filter((x) => x.href.length > 0);
      })
      .catch(() => [])) as Array<{ text: string; href: string; plantOid: string | null }>;
    logger.info("smaCollector: cookies after /Plants goto", {
      userId,
      extra: {
        names: currentCookies.map((c: any) => c.name),
        hasFormsLogin: currentCookies.some((c: any) => c.name === ".SunnyPortalFormsLogin"),
        documentCookieHead: documentCookieAtPlants.substring(0, 500),
      },
    });
    logger.info("smaCollector: /Plants redirect links", {
      userId,
      extra: { count: redirectLinksOnPlants.length, links: redirectLinksOnPlants },
    });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const plantsTitle = await page.title().catch(() => "");
    const plantsUrl = page.url();
    const isAuthenticated =
      plantsTitle.includes("一覧") ||
      plantsTitle.includes("List") ||
      (plantsUrl.includes("/Plants") && !plantsUrl.includes("Start.aspx"));
    logger.info("smaCollector: /Plants auth check", {
      userId,
      extra: { title: plantsTitle, url: plantsUrl, isAuthenticated },
    });
    if (!isAuthenticated) {
      return {
        ok: false,
        message:
          "Sunny Portal の認証に失敗しました。Cookie を再登録するか、設定の「Cookie 配列（JSON）」で www.sunnyportal.com の Cookie をまとめて登録してください。",
        recordCount: 0,
        errorCount: 0,
      };
    }

    let stationErrors = 0;

    // 発電所ループ: /Plants のリンクから plantOid を取得し、RedirectToPlant -> EnergyAndPower
    for (const station of SMA_STATIONS) {
      try {
      const plantName = station.displayName;
      logger.info("smaCollector: processing station", { userId, extra: { plantName } });
      await page.goto("https://www.sunnyportal.com/Plants", { waitUntil: "domcontentloaded" });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const plantOid = await page.evaluate((name: string) => {
        const rows = Array.from(document.querySelectorAll("tr"));
        for (const row of rows) {
          if (row.textContent?.includes(name)) {
            const link = row.querySelector('a[href*="RedirectToPlant"]') as HTMLAnchorElement | null;
            const href = link?.getAttribute("href") ?? "";
            const match = href.match(/RedirectToPlant\/([a-f0-9-]+)/i);
            return match ? match[1] : null;
          }
        }
        return null;
      }, plantName);
      if (!plantOid) {
        logger.warn("smaCollector: plantOid not found on /Plants", { userId, extra: { plantName } });
        stationErrors++;
        continue;
      }

      // 発電所選択は goto 直打ちではなく /Plants の実リンク click で遷移させる。
      await page.goto("https://www.sunnyportal.com/Plants", { waitUntil: "domcontentloaded" });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const clickResult = await clickRedirectLinkAndResolvePage(page, plantOid);
        if (clickResult.page !== page) {
          page = clickResult.page;
        }
        logger.info("smaCollector: redirect target navigated", {
          userId,
          extra: { plantName, plantOid, urlAfterClick: clickResult.urlAfterClick },
        });
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (e) {
        logger.warn("smaCollector: RedirectToPlant goto failed", {
          userId,
          extra: { plantName, plantOid, error: String(e) },
        });
      }

      const afterRedirectUrl = page.url();
      const afterRedirectTitle = await page.title().catch(() => "");
      logger.info("smaCollector: after RedirectToPlant", {
        userId,
        extra: { afterRedirectUrl, afterRedirectTitle, plantOid, plantName },
      });

      // error=show / Start.aspx の場合はここでスキップ
      if (afterRedirectUrl.includes("error=show") || afterRedirectUrl.includes("Start.aspx")) {
        logger.warn("smaCollector: RedirectToPlant did not select plant", {
          userId,
          extra: { plantName, plantOid, afterRedirectUrl, afterRedirectTitle },
        });
        stationErrors++;
        continue;
      }

      await page.goto("https://www.sunnyportal.com/FixedPages/EnergyAndPower.aspx", { waitUntil: "domcontentloaded" });
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const url = page.url();
      const title = await page.title().catch(() => "");
      const isEnergyPage = title.includes("出力と発電量") || title.includes("Energy");
      logger.info("smaCollector: EnergyAndPower result", {
        userId,
        extra: { plantName, plantOid, energyUrl: url, energyTitle: title, isEnergyPage },
      });

      if (!isEnergyPage) {
        logger.warn("smaCollector: EnergyAndPower page not reached", {
          userId,
          extra: { plantName, title, url },
        });
        stationErrors++;
        continue;
      }

      const site = await prisma.site.findFirst({
        where: { siteName: station.siteName },
        select: { id: true },
      });
      if (!site) {
        logger.warn("smaCollector: Site row missing for SMA station", {
          userId,
          extra: { siteName: station.siteName, plantName },
        });
        stationErrors++;
        continue;
      }

      const tableRows = await extractTableRows(page);
      logger.info("smaCollector: extracted table rows", {
        userId,
        extra: { plantName, plantOid, rowCount: tableRows.length },
      });

      if (tableRows.length === 0) {
        const html = (await page.content()) as string;
        logger.warn("smaCollector: no table rows on energy page", {
          userId,
          extra: { plantName, plantOid, htmlHead: html.substring(0, 2000) },
        });
      }

      for (const cells of tableRows) {
        const { dateUtc, generation } = pickDateAndGenerationFromRow(cells);
        if (!dateUtc || generation === null) continue;
        if (dateUtc.getTime() < start.getTime() || dateUtc.getTime() > end.getTime()) continue;

        await prisma.dailyGeneration.upsert({
          where: {
            siteId_date: {
              siteId: site.id,
              date: dateUtc,
            },
          },
          create: {
            siteId: site.id,
            date: dateUtc,
            generation,
            status: "sma",
          },
          update: {
            generation,
            status: "sma",
            updatedAt: new Date(),
          },
        });
        recordCount++;
      }
      } catch (stationErr) {
        logger.warn("smaCollector: station run failed", {
          userId,
          extra: { station: station.displayName, error: String(stationErr) },
        });
        stationErrors++;
      }
    }

    const allStationsFailed = stationErrors >= SMA_STATIONS.length && recordCount === 0;
    return {
      ok: !allStationsFailed,
      message: allStationsFailed
        ? `SMA の全発電所で取得に失敗しました（${SMA_STATIONS.length} 件）。Cookie ・発電所名（${SMA_STATIONS.map((s) => s.displayName).join(" / ")}）を確認してください。`
        : `SMA データ取得が完了しました（保存: ${recordCount} 件 / 発電所スキップ: ${stationErrors} 件）。`,
      recordCount,
      errorCount: stationErrors,
    };
  } catch (e) {
    logger.error("smaCollectorCookie failed", { userId }, e);
    return {
      ok: false,
      message: e instanceof Error ? e.message : "SMA データ取得に失敗しました。",
      recordCount,
      errorCount: 0,
    };
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    await browser.close().catch(() => {});
  }
}

