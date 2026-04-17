import { existsSync, readFileSync, statSync } from "fs";
import fs from "fs/promises";
import path from "path";
import * as XLSX from "xlsx";
import type { Page } from "playwright-core";

export type DailyGenerationInput = {
  date: Date;
  generation: number;
  status: "solar-monitor";
};

const SOLAR_MONITOR_PLANT_LIST_SELECTORS = [
  "#cphMain_gvList a",
  "#cphMain_gvList tbody a",
  "table[id*='gvList'] a",
  "[id*='cphMain_gvList'] a",
  ".grid-view a",
  "table.grid-view a",
  "a[href*='HatsudenshoListPage.aspx']",
] as const;

const GV_LIST_PRIMARY_TIMEOUT_MS = 30_000;

async function dumpSolarMonitorLoginDebug(page: Page): Promise<void> {
  const dir = path.join(process.cwd(), "logs");
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // ignore
  }
  const shotPath = path.join(dir, "error-screenshot.png");
  try {
    await page.screenshot({ path: shotPath, fullPage: true });
    console.error("[SolarMonitor] 待機失敗: スクリーンショット保存:", shotPath);
  } catch (e) {
    console.error("[SolarMonitor] スクリーンショット保存失敗:", e);
  }
  try {
    const bodyHtml = await page.$eval("body", (b) => b.innerHTML);
    console.error(
      "[SolarMonitor] 待機失敗: body.innerHTML 先頭8000文字:\n",
      bodyHtml.slice(0, 8000)
    );
  } catch (e) {
    console.error("[SolarMonitor] body 取得失敗:", e);
  }
  console.error("[SolarMonitor] 失敗時URL:", page.url());
}

/** 発電所一覧のリンク行がDOMに現れるまで待つ。プライマリでタイムアウトしたらフォールバック候補を試す。 */
async function waitForPlantListAnchors(page: Page): Promise<void> {
  let lastError: unknown;
  try {
    await page.waitForSelector(SOLAR_MONITOR_PLANT_LIST_SELECTORS[0], {
      timeout: GV_LIST_PRIMARY_TIMEOUT_MS,
    });
    return;
  } catch (e) {
    lastError = e;
    console.warn(
      `[SolarMonitor] #cphMain_gvList a が ${GV_LIST_PRIMARY_TIMEOUT_MS}ms 内に見つかりませんでした。フォールバック探索します。`
    );
    await dumpSolarMonitorLoginDebug(page);
  }

  for (let i = 1; i < SOLAR_MONITOR_PLANT_LIST_SELECTORS.length; i++) {
    const sel = SOLAR_MONITOR_PLANT_LIST_SELECTORS[i];
    try {
      await page.waitForSelector(sel, { timeout: 12_000 });
      console.warn(`[SolarMonitor] フォールバックで一覧らしき要素を検出: ${sel}`);
      // 遅延描画でプライマリが後から付くことがあるため、もう一度プライマリのみ待つ
      try {
        await page.waitForSelector(SOLAR_MONITOR_PLANT_LIST_SELECTORS[0], { timeout: 20_000 });
        return;
      } catch {
        await dumpSolarMonitorLoginDebug(page);
        throw new Error(
          `SolarMonitor: フォールバック (${sel}) は見つかりましたが、収集ロジック必須の #cphMain_gvList a が出現しませんでした。HTML構造の差異の可能性があります。`
        );
      }
    } catch {
      // next fallback
    }
  }

  await dumpSolarMonitorLoginDebug(page);
  throw lastError instanceof Error
    ? lastError
    : new Error("SolarMonitor: 発電所一覧（#cphMain_gvList a）の待機に失敗しました。");
}

async function clickFirstExisting(page: Page, selectors: string[]): Promise<boolean> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0) {
      await loc.click();
      return true;
    }
  }
  return false;
}

async function selectFirstExisting(page: Page, selectors: string[], value: string): Promise<boolean> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0) {
      try {
        await loc.selectOption(value);
        return true;
      } catch {
        // try next selector
      }
    }
  }
  return false;
}

function parseDayFromHeaderCell(raw: unknown, fallbackMonth: number): { month: number; day: number } | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m1 = s.match(/(\d{1,2})月\s*(\d{1,2})日/);
  if (m1) return { month: Number(m1[1]), day: Number(m1[2]) };
  const m2 = s.match(/^(\d{1,2})日$/);
  if (m2) return { month: fallbackMonth, day: Number(m2[1]) };
  return null;
}

function parseKwh(raw: unknown): number | null {
  const s = String(raw ?? "").trim();
  if (!s || s === "-" || s === "—" || s === "－") return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

const REPORT_OUTPUT_SELECTORS = [
  'input[value="レポートを出力"]',
  'input[title="レポートを出力"]',
  'input[value*="レポート"]',
  'input[value*="出力"]',
  'button:has-text("レポート")',
] as const;

async function findReportOutputButtonSelector(page: Page): Promise<string | null> {
  for (const sel of REPORT_OUTPUT_SELECTORS) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0) {
      return sel;
    }
  }
  return null;
}

async function downloadMonthlyReport(page: Page, yearMonth: string, tmpDir: string): Promise<string> {
  const [year, month] = yearMonth.split("-");
  const monthNum = String(Number(month));

  const monthlySelected =
    (await clickFirstExisting(page, [
      'input[type="radio"][value*="月報"]',
      'label:has-text("月報")',
      'span:has-text("月報")',
    ]).catch(() => false)) || false;
  if (!monthlySelected) {
    await page.getByText("月報", { exact: false }).first().click().catch(() => {});
  }

  const yearOk = await selectFirstExisting(
    page,
    ['select[name*="year"]', 'select[id*="year"]', 'select[name*="Year"]', 'select[id*="Year"]'],
    year
  );
  if (!yearOk) throw new Error("SolarMonitor: 年選択セレクトが見つかりません。");

  const monthOk =
    (await selectFirstExisting(
      page,
      ['select[name*="month"]', 'select[id*="month"]', 'select[name*="Month"]', 'select[id*="Month"]'],
      monthNum
    )) ||
    (await selectFirstExisting(
      page,
      ['select[name*="month"]', 'select[id*="month"]', 'select[name*="Month"]', 'select[id*="Month"]'],
      month.padStart(2, "0")
    ));
  if (!monthOk) throw new Error("SolarMonitor: 月選択セレクトが見つかりません。");

  const reportSel = await findReportOutputButtonSelector(page);
  if (!reportSel) {
    throw new Error('SolarMonitor: "レポートを出力" ボタンが見つかりません。');
  }

  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), page.click(reportSel)]);
  const savePath = path.join(tmpDir, `solar-monitor-${yearMonth}-${Date.now()}.xlsx`);
  await download.saveAs(savePath);
  await new Promise((resolve) => setTimeout(resolve, 500));

  if (!existsSync(savePath) || statSync(savePath).size <= 0) {
    throw new Error(`SolarMonitor: 保存後もファイルが存在しない、または空です: ${savePath}`);
  }

  return savePath;
}

function parseSolarMonitorXlsxRows(xlsxPath: string, yearMonth: string): DailyGenerationInput[] {
  const buffer = readFileSync(xlsxPath);
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheet = wb.Sheets["data"] ?? wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("SolarMonitor: Excel シートが見つかりません。");

  const [yearStr, monthStr] = yearMonth.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!year || !month) throw new Error(`SolarMonitor: yearMonth が不正です (${yearMonth})`);

  const BLOCKS = [
    { dateRow: 19, genRow: 20 }, // 1〜15日
    { dateRow: 26, genRow: 27 }, // 16〜31日
  ] as const;
  const rows: DailyGenerationInput[] = [];

  for (const block of BLOCKS) {
    for (let col = 1; col <= 16; col++) {
      const dateCell = sheet[XLSX.utils.encode_cell({ r: block.dateRow, c: col })];
      const genCell = sheet[XLSX.utils.encode_cell({ r: block.genRow, c: col })];
      if (!dateCell) break;

      const dayCell = parseDayFromHeaderCell(dateCell.v, month);
      if (!dayCell) continue;

      const generation = parseKwh(genCell?.v);
      if (generation === null || generation <= 0) continue;

      const date = new Date(Date.UTC(year, dayCell.month - 1, dayCell.day, 0, 0, 0, 0));
      if (Number.isNaN(date.getTime())) continue;

      rows.push({ date, generation, status: "solar-monitor" });
    }
  }

  return rows;
}

type SolarMonitorLoginConfig = {
  loginUrl: string;
  loginId: string;
  password: string;
  openPlantListFromMenu?: boolean;
};

/**
 * Solar Monitor 共通収集ロジック
 * ログイン後、必要に応じて「発電状況」ボタンをクリックして一覧画面へ遷移する処理を追加
 *
 * - SE（須山）: `openPlantListFromMenu: true` で発電状況ボタン経由へ進む
 * - SF（池新田・本社）: `false` のまま一覧取得へ
 */
async function loginAndNavigateToPlantList(page: Page, config: SolarMonitorLoginConfig, systemId: string): Promise<void> {
  const { loginUrl, openPlantListFromMenu = false } = config;

  console.log(`[DEBUG] 処理開始: systemId=${systemId}`);
  console.log(`[DEBUG] Attempting login with systemId: ${systemId}`);
  console.log(`[DEBUG] Using Login ID: ${config.loginId}`);

  if (openPlantListFromMenu && systemId !== "solar-monitor-se") {
    throw new Error(`SolarMonitor: systemId mismatch (expected solar-monitor-se, got ${systemId})`);
  }

  page.setDefaultTimeout(15_000);

  try {
    // 1. 前後の空白を除去し、念のためログで中身を厳密に確認
    const finalId = config.loginId.trim();
    const finalPw = config.password.trim();

    // 特殊文字や空白が混じっていないか、1文字ずつのコードで確認（デバッグ用）
    console.log(`[STRICT_CHECK] ID: "${finalId}" (Length: ${finalId.length})`);
    console.log(`[STRICT_CHECK] PW: Length is ${finalPw.length}`);

    await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500); // ページが落ち着くまで少し長めに待機

    const userSelector = 'input[name*="txtUserName"]';
    const passSelector = 'input[name*="txtPassword"]';

    // 入力フィールドを確実にクリア
    await page.focus(userSelector);
    await page.keyboard.down("Control");
    await page.keyboard.press("A");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");

    await page.focus(passSelector);
    await page.keyboard.down("Control");
    await page.keyboard.press("A");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");

    // 2. 1文字ずつ入力（ディレイ強め）
    await page.type(userSelector, finalId, { delay: 150 });
    await page.type(passSelector, finalPw, { delay: 150 });

    await page.waitForTimeout(1000);
    console.log(`[${systemId}] ログインボタンをクリックします...`);

    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 }).catch(() => {}),
      page.click("#btnLogin"),
    ]);

    // 5. 最終判定
    if (page.url().includes("LoginPage.aspx")) {
      const errorMsg = await page.$eval("#lblErrorMessage", (el) => el.textContent).catch(() => "認証エラー");
      console.error(`[${systemId}] ログイン失敗: ${errorMsg}`);
      throw new Error(`SolarMonitorログイン失敗: ${errorMsg}`);
    }

    console.log(`[${systemId}] ログイン成功！ 現在のURL: ${page.url()}`);

    console.log(`[${systemId}] ログイン成功判定！`);
  } catch (error) {
    console.error(`[FATAL ERROR] ${systemId}:`, error);
    throw error;
  }

  if (openPlantListFromMenu) {
    console.log(`[${systemId}] 発電状況ボタン (#cphMain_ibtnHatsudenJokyo) をクリックします...`);
    await page.waitForSelector("#cphMain_ibtnHatsudenJokyo", { state: "visible", timeout: 15_000 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle", timeout: 15_000 }).catch(() => {
        console.log("[DEBUG] Navigation timeout ignored (Ajax/PostBack potential)");
      }),
      page.click("#cphMain_ibtnHatsudenJokyo"),
    ]);
  }

  console.log(`[${systemId}] 発電所一覧の読み込みを待機中...`);
  await page.waitForSelector("#cphMain_gvList a", { timeout: 20_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
}

export async function loginAndOpenSolarMonitorMenu(
  page: Page,
  {
    loginUrl,
    loginId,
    password,
    openPlantListFromMenu = false,
  }: {
    loginUrl: string;
    loginId: string;
    password: string;
    openPlantListFromMenu?: boolean;
  }
): Promise<void> {
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

  // waitForNavigation との競合を避けるため、先にナビゲーション待機を登録してからクリック
  await page.fill('input[name="txtUserName"]', loginId);
  await page.fill('input[name="txtPassword"]', password);

  const navPromise = page.waitForNavigation({ waitUntil: "networkidle", timeout: 45_000 }).catch((err) => {
    console.warn("[SolarMonitor] login waitForNavigation(networkidle) タイムアウト/中断:", err);
  });
  await page.click('input[name="btnLogin"]');
  await navPromise;
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

  // ログイン失敗チェック：URLではなくエラーメッセージの有無で判定する
  const errEl = await page.$('#lblErrorMessage');
  if (errEl) {
    const errText = await errEl.textContent();
    if (errText && errText.includes('違います')) {
      throw new Error(`SolarMonitorログイン失敗: ${errText.trim()}`);
    }
  }

  // ログイン成功後のページかどうかをフォームのactionで確認
  const formAction = await page.$eval('form#form1', (f) => f.getAttribute('action')).catch(() => '');

  // HKMenuPage へ遷移（form action が hk/HKMenuPage.aspx を指している場合はすでにそこにいる）
  if (!formAction?.includes('HKMenuPage') && !page.url().includes('HKMenuPage')) {
    throw new Error('SolarMonitor: ログイン後のページが想定外です。');
  }

  // ログイン成功後、すでにHKMenuPage or HatsudenshoListPageにいるはず
  // goto は使わない（セッションが切れるため）

  // トップ画面: 「発電監視状況一覧」(#cphMain_ibtnHatsudenJokyo) があるアカウントは先にクリックして一覧へ
  // （SF で一覧直表示の場合はボタンが無い／非表示のためスキップし、そのまま #cphMain_gvList a を待つ）
  void openPlantListFromMenu; // 互換のため引数は維持（従来は SE のみクリックしていたが、ボタン存在ベースに統一）
  const hatsudenBtn = page.locator("#cphMain_ibtnHatsudenJokyo").first();
  try {
    await hatsudenBtn.waitFor({ state: "visible", timeout: 15_000 });
    const menuNav = page.waitForNavigation({ waitUntil: "networkidle", timeout: 30_000 }).catch((err) => {
      console.warn("[SolarMonitor] 発電監視状況一覧クリック後の navigation 待機:", err);
    });
    await hatsudenBtn.click();
    await menuNav;
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  } catch {
    // ボタンなし → そのまま発電所一覧待機へ
  }

  await waitForPlantListAnchors(page);
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
}

export async function collectSolarMonitor({
  page,
  siteName,
  year,
  month,
}: {
  page: Page;
  siteName: string;
  year: number;
  month: number;
}): Promise<DailyGenerationInput[]> {
  if (page.url().includes("HatsudenshoListPage")) {
    await Promise.all([page.waitForURL("**/HKMenuPage.aspx", { timeout: 15_000 }), page.goBack()]);
    await page.waitForSelector("#cphMain_gvList a", { timeout: 15_000 });
  }

  const links = await page.$$eval("#cphMain_gvList a", (els) =>
    els.map((e) => ({ text: e.textContent?.trim() ?? "", id: (e as HTMLAnchorElement).id ?? "" }))
  );
  const matched = links.find((l) => l.text.includes(siteName));
  if (!matched || !matched.id) {
    throw new Error(`SolarMonitor: 発電所リンクが見つかりません (${siteName})`);
  }

  await Promise.all([page.waitForURL("**/HatsudenshoListPage.aspx", { timeout: 15_000 }), page.click(`#${matched.id}`)]);
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  const yearMonth = `${year}-${String(month).padStart(2, "0")}`;
  const tmpDir = await fs.mkdtemp(path.join(process.env.TEMP ?? process.env.TMP ?? "/tmp", "solar-monitor-"));
  try {
    const xlsxPath = await downloadMonthlyReport(page, yearMonth, tmpDir);
    return parseSolarMonitorXlsxRows(xlsxPath, yearMonth);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
