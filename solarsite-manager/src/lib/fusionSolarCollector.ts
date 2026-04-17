import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { launchChromiumForRuntime } from "@/lib/playwrightRuntime";
import type { Page } from "playwright-core";

const BASE_URL = "https://jp5.fusionsolar.huawei.com";
const STATION_REPORT_URL_TEMPLATE = `${BASE_URL}/pvmswebsite/assets/build/index.html#/view/station/NE={ne}/report`;

const FUSION_SOLAR_STATIONS = [
  { name: "フジHD湖西発電所", ne: "33652418" },
  { name: "フジHD袋井市豊住高圧発電所", ne: "34130688" },
  { name: "フジHD菊川市高橋第二発電所", ne: "33860228" },
  { name: "フジHD牧之原市白井発電所", ne: "33733199" },
  { name: "フジHD御前崎市合戸第二発電所", ne: "34631202" },
  { name: "フジHD御前崎市佐倉第三発電所", ne: "34364567" },
  { name: "フジ物産掛川市浜野高圧発電所", ne: "33558911" },
  { name: "フジ物産御前崎市佐倉高圧発電所", ne: "33559317" },
];

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseYmdToUtcDate(ymd: string): Date | null {
  if (!isYmd(ymd)) return null;
  const [y, m, d] = ymd.split("-").map((v) => Number(v));
  if (!y || !m || !d) return null;
  const dt = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** startDate〜endDate に含まれる年月（YYYY-MM）の配列を返す */
function getMonthsInRange(startDate: Date, endDate: Date): string[] {
  const months: string[] = [];
  const start = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1));
  for (let d = new Date(start); d.getTime() <= end.getTime(); d.setUTCMonth(d.getUTCMonth() + 1)) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    months.push(`${y}-${m}`);
  }
  return months;
}

async function loginFusionSolar(page: Page, loginId: string, password: string, userId: string) {
  // autoLogin の FusionSolar 手順に寄せる（SPA で要素出現が遅い）
  logger.info("fusionSolarCollector: navigating to login", { extra: { url: BASE_URL }, userId });
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

  const idSelCandidates = [
    'input[type="text"]',
    'input[placeholder*="ユーザー" i]',
    'input[placeholder*="User" i]',
    'input[name*="user" i]',
    'input#username',
  ];
  const pwSelCandidates = ['input[type="password"]', 'input#value'];
  const loginBtnCandidates = [
    'button:has-text("ログイン")',
    'button:has-text("Login")',
    'button[type="submit"]',
    "#btn_outerverify",
  ];

  const start = Date.now();
  const hardTimeoutMs = 45_000;
  let idFilled = false;
  let pwFilled = false;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - start > hardTimeoutMs) {
      throw new Error("FusionSolar: ログインフォームの入力欄が表示されませんでした（タイムアウト）。");
    }

    if (!idFilled) {
      for (const sel of idSelCandidates) {
        const loc = page.locator(sel).first();
        if (await loc.count()) {
          const visible = await loc.isVisible().catch(() => false);
          if (visible) {
            await loc.fill(loginId);
            idFilled = true;
            break;
          }
        }
      }
    }

    if (!pwFilled) {
      for (const sel of pwSelCandidates) {
        const loc = page.locator(sel).first();
        if (await loc.count()) {
          const visible = await loc.isVisible().catch(() => false);
          if (visible) {
            await loc.fill(password);
            pwFilled = true;
            break;
          }
        }
      }
    }

    if (idFilled && pwFilled) break;
    await page.waitForTimeout(250);
  }

  if (!idFilled || !pwFilled) {
    throw new Error("FusionSolar: ログインID/パスワード入力に失敗しました。");
  }

  let loginBtn: ReturnType<Page["locator"]> | null = null;
  for (const sel of loginBtnCandidates) {
    const loc = page.locator(sel).first();
    if (await loc.count()) {
      const visible = await loc.isVisible().catch(() => false);
      if (visible) {
        loginBtn = loc;
        break;
      }
    }
  }
  if (!loginBtn) {
    throw new Error("FusionSolar: ログインボタンが見つかりません。");
  }
  await loginBtn.waitFor({ state: "visible", timeout: 20_000 });

  const urlLooksLoggedIn = (u: URL) => {
    const href = u.toString();
    const lower = href.toLowerCase();
    if (href.includes("/unisso/login")) return false;
    if (lower.includes("#/login")) return false;
    if (lower.includes("/login") && lower.includes("unisso")) return false;
    if (href.includes("/netecowebext/")) return true;
    if (href.includes("/pvmswebsite/")) return true;
    if (href.includes("/netecowebext/home")) return true;
    return false;
  };

  try {
    await Promise.all([
      page.waitForURL(urlLooksLoggedIn, { timeout: 120_000 }),
      loginBtn.click(),
    ]);
  } catch {
    const url = page.url();
    const title = await page.title().catch(() => "(title取得失敗)");
    throw new Error(`FusionSolar: ログイン完了を確認できませんでした（url=${url}, title=${title}）。`);
  }

  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
}

// FusionSolar の画面上の発電所名称と DB の Site.siteName のマッピング
const FUSION_SOLAR_DISPLAY_NAME_MAP: Record<string, string> = {
  "フジHD湖西発電所": "湖西（高圧）",
  "フジHD袋井市豊住高圧発電所": "豊住（高圧）",
  "フジHD菊川市高橋第二発電所": "高橋②（高圧）",
  "フジHD牧之原市白井発電所": "白井（高圧）",
  "フジHD御前崎市合戸第二発電所": "合戸②（高圧）",
  "フジHD御前崎市佐倉第三発電所": "佐倉③（高圧）",
  "フジ物産掛川市浜野高圧発電所": "浜野（高圧）",
  "フジ物産御前崎市佐倉高圧発電所": "佐倉（高圧）",
};

export async function runFusionSolarCollector(
  userId: string,
  startDate: string,
  endDate: string
): Promise<{ ok: boolean; message: string; recordCount: number; errorCount: number }> {
  const start = parseYmdToUtcDate(startDate);
  const end = parseYmdToUtcDate(endDate);
  if (!start || !end) {
    return {
      ok: false,
      message: "startDate/endDate は YYYY-MM-DD 形式で指定してください。",
      recordCount: 0,
      errorCount: 0,
    };
  }
  if (start.getTime() > end.getTime()) {
    return {
      ok: false,
      message: "開始日は終了日以前にしてください。",
      recordCount: 0,
      errorCount: 0,
    };
  }

  const cred = await prisma.monitoringCredential.findFirst({
    where: { userId, systemId: "fusion-solar" },
    select: { loginId: true, encryptedPassword: true },
  });
  if (!cred) {
    return {
      ok: false,
      message: "FusionSolar の認証情報が未登録です（/settings で登録してください）。",
      recordCount: 0,
      errorCount: 0,
    };
  }
  const loginId = cred.loginId;
  const password = decryptSecret(cred.encryptedPassword);

  const browser = await launchChromiumForRuntime({ headless: true });

  let recordCount = 0;
  let errorCount = 0;

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);

    await loginFusionSolar(page, loginId, password, userId);

    const months = getMonthsInRange(start, end);

    // 発電所ごと × 月ごとにループ
    for (const station of FUSION_SOLAR_STATIONS) {
      const stationReportUrl = STATION_REPORT_URL_TEMPLATE.replace("{ne}", station.ne);

      for (const yearMonth of months) {
        logger.info("fusionSolarCollector: station + month", {
          extra: { station: station.name, ne: station.ne, yearMonth },
          userId,
        });

        await page.goto(stationReportUrl, { waitUntil: "domcontentloaded" });
        await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

        // セッション切れ等でログイン画面に戻ることがあるため、必要なら再ログインしてから待つ
        const needsRelogin =
          (await page.locator("input#username").count()) > 0 &&
          (await page.locator("input#username").first().isVisible().catch(() => false));
        if (needsRelogin) {
          logger.warn("fusionSolarCollector: relogin required before report page", {
            userId,
            extra: { url: page.url(), station: station.name },
          });
          await loginFusionSolar(page, loginId, password, userId);
          await page.goto(stationReportUrl, { waitUntil: "domcontentloaded" });
          await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
        }

        // ページ読み込み完了を待つ
        await page.waitForSelector(".ant-picker-input input", { timeout: 90_000 });
        await page.waitForTimeout(2000);

        // 粒度を「月別」に切り替え（文字化け回避のため title 属性で直接指定）
        const granularityEl = page.locator("span.ant-select-selection-item").first();
        const currentTitle = await granularityEl.getAttribute("title");
        if (currentTitle !== "月別") {
          await granularityEl.click();
          await page.waitForTimeout(800);
          await page.locator('.ant-select-item-option[title="月別"]').click();
          await page.waitForTimeout(800);
        }

        // 統計期間に YYYY-MM を入力（既存値をクリアしてから入力）
        const pickerInput = page.locator(".ant-picker-input input").first();
        await pickerInput.click();
        await pickerInput.selectText();
        await pickerInput.fill(yearMonth);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(500);

        // 検索ボタンをクリックしてテーブル更新を待つ
        await page.getByRole("button", { name: "検索" }).click();
        await page.waitForSelector("table tbody tr", { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(1500);

        // ページネーション対応: 全ページのデータを収集
        const allRows: { dateStr: string; pcsKwhText: string }[] = [];

        while (true) {
          // 現在ページのテーブル行を取得
          const pageRows = await page.$$eval("table tbody tr", (trs) =>
            trs.map((tr) => {
              const tds = Array.from(tr.querySelectorAll("td"));
              const dateStr = (tds[0]?.textContent ?? "").trim();
              const pcsKwhText = (tds[2]?.textContent ?? "").trim();
              return { dateStr, pcsKwhText };
            })
          );
          allRows.push(...pageRows);

          // 次ページボタンが存在して、かつ disabled でなければクリック
          const nextBtn = page.locator("li.ant-pagination-next");
          const isDisabled = await nextBtn.getAttribute("aria-disabled");
          if (isDisabled === "true") break;

          await nextBtn.click();
          await page.waitForTimeout(1500);
        }

        const mappedName = FUSION_SOLAR_DISPLAY_NAME_MAP[station.name] ?? station.name;
        const site = await prisma.site.findFirst({
          where: { siteName: mappedName },
          select: { id: true },
        });
        if (!site) {
          logger.warn("fusionSolarCollector: site not found", {
            extra: { plantName: station.name, mappedName },
            userId,
          });
          errorCount += allRows.length;
          continue;
        }

        for (const row of allRows) {
          const { dateStr, pcsKwhText } = row;
          if (!dateStr || !pcsKwhText) {
            errorCount++;
            continue;
          }
          const dateUtc = parseYmdToUtcDate(dateStr.replace(/\//g, "-").trim());
          if (!dateUtc) {
            errorCount++;
            continue;
          }
          if (dateUtc.getTime() < start.getTime() || dateUtc.getTime() > end.getTime()) {
            continue;
          }
          const generation = parseFloat(pcsKwhText.replace(/,/g, ""));
          if (Number.isNaN(generation)) {
            errorCount++;
            continue;
          }
          await prisma.dailyGeneration.upsert({
            where: {
              siteId_date: { siteId: site.id, date: dateUtc },
            },
            create: {
              siteId: site.id,
              date: dateUtc,
              generation,
              status: "fusion-solar",
            },
            update: {
              generation,
              status: "fusion-solar",
              updatedAt: new Date(),
            },
          });
          recordCount++;
        }
      }
    }

    return {
      ok: true,
      message: `FusionSolarのデータ取得が完了しました（保存: ${recordCount}件 / スキップ: ${errorCount}件）。`,
      recordCount,
      errorCount,
    };
  } catch (e) {
    logger.error("fusionSolarCollector failed", { userId }, e);
    return {
      ok: false,
      message: e instanceof Error ? e.message : "FusionSolarデータ取得に失敗しました。",
      recordCount,
      errorCount,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
