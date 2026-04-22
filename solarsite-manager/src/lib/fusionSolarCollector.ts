import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { launchChromiumForRuntime } from "@/lib/playwrightRuntime";
import { autoLogin } from "@/lib/autoLogin";
import { throwIfAllCollectCancelled } from "@/lib/collectCancel";
import type { Page } from "playwright-core";

const BASE_URL = "https://jp5.fusionsolar.huawei.com";
const STATION_REPORT_URL_TEMPLATE = `${BASE_URL}/pvmswebsite/assets/build/index.html#/view/station/NE={ne}/report`;

/**
 * 実行時間の上限。
 * - production: Vercel の maxDuration（例: 300s）を考慮して 295s
 * - development: ローカル検証では途中打ち切りを避けるため長めに許容
 */
const DEFAULT_WALL_BUDGET_MS =
  process.env.NODE_ENV === "production" ? 295_000 : 30 * 60 * 1000;

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
const MAX_TABLE_PAGES_PER_STATION_MONTH = 20;

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

/** FusionSolar の日付セル（全角数字・1桁月日など）を YYYY-MM-DD に寄せる */
function normalizeFusionTableDateCell(raw: string): string | null {
  const ascii = raw
    .trim()
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, " ");
  const slash = ascii.replace(/-/g, "/");
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(slash);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
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
    "input#username",
    'input[name="username"]',
    'input[name*="user" i]',
    'input[placeholder*="ユーザー" i]',
    'input[placeholder*="User" i]',
    'input[type="text"]',
  ];
  const pwSelCandidates = ['input#value', 'input[name="password"]', 'input[type="password"]'];
  const loginBtnCandidates = [
    "#btn_outerverify",
    'button:has-text("ログイン")',
    'button:has-text("Login")',
    'button[type="submit"]',
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
    throw new Error("FusionSolar: ログインID/パスワード入力に失敗しました（入力欄の特定に失敗）。");
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
      // クリックが効かないケースがあるため Enter 送信も併用する
      (async () => {
        await loginBtn.click();
        await page.keyboard.press("Enter").catch(() => {});
      })(),
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

async function orderStationsByCoverage(
  stations: Array<{ name: string; ne: string }>,
  start: Date,
  end: Date,
  userId: string
): Promise<Array<{ name: string; ne: string }>> {
  const scored = await Promise.all(
    stations.map(async (station, idx) => {
      const mappedName = FUSION_SOLAR_DISPLAY_NAME_MAP[station.name] ?? station.name;
      const site = await prisma.site.findFirst({
        where: { siteName: mappedName },
        select: { id: true },
      });
      if (!site) return { station, idx, count: -1 };
      const count = await prisma.dailyGeneration.count({
        where: {
          siteId: site.id,
          date: { gte: start, lte: end },
        },
      });
      return { station, idx, count };
    })
  );

  scored.sort((a, b) => {
    // countが少ない（未取得が多い）発電所から優先。未マッピングは最後に回す。
    const ca = a.count < 0 ? Number.MAX_SAFE_INTEGER : a.count;
    const cb = b.count < 0 ? Number.MAX_SAFE_INTEGER : b.count;
    if (ca !== cb) return ca - cb;
    return a.idx - b.idx;
  });

  logger.info("fusionSolarCollector: station order optimized by coverage", {
    userId,
    extra: {
      order: scored.map((s) => ({
        station: s.station.name,
        existingCount: s.count,
      })),
    },
  });

  return scored.map((s) => s.station);
}

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

  const wallBudgetMs = (() => {
    const raw = Number(process.env.FUSION_SOLAR_COLLECT_BUDGET_MS);
    if (Number.isFinite(raw) && raw > 30_000) return raw;
    return DEFAULT_WALL_BUDGET_MS;
  })();

  const browser = await launchChromiumForRuntime({
    headless: true,
    extraArgs: ["--disable-blink-features=AutomationControlled"],
  });

  let recordCount = 0;
  let errorCount = 0;
  // Vercel の実行時間上限に収めるため、壁時計は関数実行開始時点から計測する
  const wallStarted = Date.now();

  try {
    throwIfAllCollectCancelled(userId);
    let storageStateJson: string | null = null;
    const loginResult = await autoLogin(userId, "fusion-solar", { headless: true });
    if (loginResult.ok && loginResult.storageStateJson) {
      storageStateJson = loginResult.storageStateJson;
      logger.info("fusionSolarCollector: using runtime storageState from autoLogin", {
        userId,
      });
    } else {
      logger.warn("fusionSolarCollector: autoLogin failed, fallback to manual login", {
        userId,
        extra: { message: loginResult.message },
      });
    }

    const context = storageStateJson
      ? await browser.newContext({
          storageState: JSON.parse(storageStateJson),
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          locale: "ja-JP",
        })
      : await browser.newContext({
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          locale: "ja-JP",
        });
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    await context
      .addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      })
      .catch(() => {});

    if (!storageStateJson) {
      await loginFusionSolar(page, loginId, password, userId);
    }

    const months = getMonthsInRange(start, end);
    const stations = await orderStationsByCoverage(FUSION_SOLAR_STATIONS, start, end, userId);

    // 発電所ごと × 月ごとにループ
    for (const station of stations) {
      throwIfAllCollectCancelled(userId);
      const stationReportUrl = STATION_REPORT_URL_TEMPLATE.replace("{ne}", station.ne);

      for (const yearMonth of months) {
        throwIfAllCollectCancelled(userId);
        const elapsed = Date.now() - wallStarted;
        const remaining = wallBudgetMs - elapsed;
        if (remaining < 15_000) {
          return {
            ok: true,
            message: `FusionSolarの取得を実行時間の上限のためここまでにしました（保存: ${recordCount}件 / スキップ: ${errorCount}件）。発電所×月の処理が重いため、開始日・終了日の範囲を短く分けて再実行してください。`,
            recordCount,
            errorCount,
          };
        }
        logger.info("fusionSolarCollector: station + month", {
          extra: { station: station.name, ne: station.ne, yearMonth, remaining },
          userId,
        });

        const collectRows = async () => {
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

            // 粒度を「月別」に切り替え（UI差異で候補が出ないケースがあるため、失敗しても継続）
            const granularityEl = page.locator("span.ant-select-selection-item").first();
            const currentTitle = (await granularityEl.getAttribute("title")) ?? "";
            if (!currentTitle.includes("月別")) {
              try {
                await granularityEl.click();
                await page.waitForTimeout(500);
                const monthOptionByTitle = page.locator('.ant-select-item-option[title="月別"]').first();
                const monthOptionByText = page.locator(".ant-select-item-option", { hasText: "月別" }).first();
                if (await monthOptionByTitle.count()) {
                  await monthOptionByTitle.click({ timeout: 8_000 });
                } else if (await monthOptionByText.count()) {
                  await monthOptionByText.click({ timeout: 8_000 });
                } else {
                  logger.warn("fusionSolarCollector: 月別オプションが見つからないため既定粒度で継続", {
                    userId,
                    extra: { station: station.name, yearMonth, url: page.url(), currentTitle },
                  });
                }
                await page.waitForTimeout(500);
              } catch (e) {
                logger.warn("fusionSolarCollector: 月別切替に失敗したため既定粒度で継続", {
                  userId,
                  extra: {
                    station: station.name,
                    yearMonth,
                    url: page.url(),
                    currentTitle,
                    error: e instanceof Error ? e.message : String(e),
                  },
                });
              }
            }

            // 統計期間に YYYY-MM を入力（既存値をクリアしてから入力）
            const pickerInput = page.locator(".ant-picker-input input").first();
            await pickerInput.click();
            await pickerInput.selectText();
            await pickerInput.fill(yearMonth);
            await page.keyboard.press("Enter");
            await page.waitForTimeout(500);

            // 検索ボタンをクリックしてテーブル更新を待つ（UI差異で文言が変わるため複数候補）
            let searchClicked = false;
            const searchBtnCandidates = [
              page.getByRole("button", { name: /検索|Search/i }).first(),
              page.locator('button:has-text("検索")').first(),
              page.locator('button:has-text("Search")').first(),
              page.locator(".ant-btn-primary").first(),
            ];
            for (const btn of searchBtnCandidates) {
              try {
                if ((await btn.count()) > 0) {
                  await btn.click({ timeout: 8_000 });
                  searchClicked = true;
                  break;
                }
              } catch {
                // try next candidate
              }
            }
            if (!searchClicked) {
              // ボタンが取れない場合でも Enter で検索をトリガーして継続
              await page.keyboard.press("Enter").catch(() => {});
              logger.warn("fusionSolarCollector: 検索ボタンが見つからないため Enter で代替実行", {
                userId,
                extra: { station: station.name, yearMonth, url: page.url() },
              });
            }
            await page.waitForSelector("table tbody tr", { timeout: 30000 }).catch(() => {});
            await page.waitForTimeout(1500);

            // ページネーション対応: 日付範囲外になったら早期打ち切りして高速化する
            const rows: { dateStr: string; pcsKwhText: string }[] = [];
            let pageCount = 0;
            while (true) {
              throwIfAllCollectCancelled(userId);
              pageCount += 1;
              const pageRows = await page.$$eval("table tbody tr", (trs) =>
                trs.map((tr) => {
                  const tds = Array.from(tr.querySelectorAll("td"));
                  const dateStr = (tds[0]?.textContent ?? "").trim();
                  const pcsKwhText = (tds[2]?.textContent ?? "").trim();
                  return { dateStr, pcsKwhText };
                })
              );
              for (const r of pageRows) {
                const ymd =
                  normalizeFusionTableDateCell(r.dateStr) ??
                  (() => {
                    const t = r.dateStr.replace(/\//g, "-").trim();
                    return isYmd(t) ? t : null;
                  })();
                const dt = ymd ? parseYmdToUtcDate(ymd) : null;
                if (!dt) continue;
                if (dt.getTime() > end.getTime()) continue;
                if (dt.getTime() < start.getTime()) {
                  // 画面が日付降順とは限らず、同一ページで抜け・逆順があると return すると未取得日が出る
                  continue;
                }
                rows.push(r);
              }

              if (pageCount >= MAX_TABLE_PAGES_PER_STATION_MONTH) {
                logger.warn("fusionSolarCollector: max pagination pages reached, stop paging", {
                  userId,
                  extra: { station: station.name, yearMonth, pageCount },
                });
                break;
              }

              const nextBtn = page.locator("li.ant-pagination-next");
              const isDisabled = await nextBtn.getAttribute("aria-disabled");
              if (isDisabled === "true") break;
              await nextBtn.click();
              await page.waitForTimeout(600);
            }
            return rows;
        };

        let allRows: Array<{ dateStr: string; pcsKwhText: string }> = [];
        try {
          allRows = await collectRows();
        } catch (firstErr) {
          logger.warn("fusionSolarCollector: station/month first attempt failed, retry with relogin", {
            userId,
            extra: {
              station: station.name,
              yearMonth,
              error: firstErr instanceof Error ? firstErr.message : String(firstErr),
            },
          });

          const retryRemaining = wallBudgetMs - (Date.now() - wallStarted);
          if (retryRemaining < 20_000) {
            errorCount++;
            continue;
          }

          try {
            await loginFusionSolar(page, loginId, password, userId);
            allRows = await collectRows();
          } catch (retryErr) {
            logger.warn("fusionSolarCollector: station/month retry failed, skip", {
              userId,
              extra: {
                station: station.name,
                yearMonth,
                error: retryErr instanceof Error ? retryErr.message : String(retryErr),
              },
            });
            errorCount++;
            continue;
          }
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
          throwIfAllCollectCancelled(userId);
          const { dateStr, pcsKwhText } = row;
          if (!dateStr || !pcsKwhText) {
            errorCount++;
            continue;
          }
          const ymdNorm =
            normalizeFusionTableDateCell(dateStr) ??
            (() => {
              const t = dateStr.replace(/\//g, "-").trim();
              return isYmd(t) ? t : null;
            })();
          const dateUtc = ymdNorm ? parseYmdToUtcDate(ymdNorm) : null;
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

    const ok = recordCount > 0 || errorCount === 0;
    return {
      ok,
      message: ok
        ? `FusionSolarのデータ取得が完了しました（保存: ${recordCount}件 / スキップ: ${errorCount}件）。`
        : `FusionSolarのデータ取得で有効データを保存できませんでした（保存: ${recordCount}件 / スキップ: ${errorCount}件）。期間を短くして再実行してください。`,
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
