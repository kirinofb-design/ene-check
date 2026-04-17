import path from "path";
import fs from "fs/promises";
import os from "os";
import iconv from "iconv-lite";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { decryptSecret } from "@/lib/encryption";
import { launchChromiumForRuntime } from "@/lib/playwrightRuntime";

const ECO_MEGANE_LOGIN_URL = "https://eco-megane.jp/login";
const ECO_MEGANE_PRODUCT_LIST_URL =
  "https://eco-megane.jp/index.php?fnc=productview&act=dispScreen&deploymentAllFlg=0&transitionFlg=0";

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseYmdToDateUtc(ymd: string): Date | null {
  if (!isYmd(ymd)) return null;
  const d = new Date(`${ymd}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ymdToSlash(ymd: string): string {
  // 期待形式は YYYY-MM-DD（事前にバリデーション済み）
  return `${ymd.slice(0, 4)}/${ymd.slice(5, 7)}/${ymd.slice(8, 10)}`;
}

// CSV上の「表示名」と DB上の Site.siteName のマッピング
const DISPLAY_NAME_MAP: Record<string, string> = {
  "ＦＢまことの土地": "まこと（低圧）",
  "ＦＢ御前崎白羽発電所": "白羽（低圧）",
  "ＦＢ沼津支店発電所": "沼津（低圧）",
  "ＦＢ笠名インター": "笠名IC（低圧）",
  "ＦＢ黒子発電所": "黒子②（低圧）",
  "ＦＢ福野鉄塔敷地": "鉄塔敷地（低圧）",
  "ＦＢ裾野鉄塔敷地": "鉄塔敷地（低圧）",
  "フジ物産吉田町川尻": "川尻（低圧）",
  "フジ物産西大渕": "西大渕（低圧）",
  "フジ物産牧之原市細江": "細江（低圧）",
  "ＦＢ牧之原勝俣発電所": "勝俣（低圧）",
};

/**
 * エコめがねでログインし、商品一覧で「エコグラフ電力量」の日別CSVをダウンロードして
 * 発電電力量を DailyGeneration に upsert する。
 */
export async function runEcoMeganeCollector(
  userId: string,
  startDate: string,
  endDate: string
): Promise<{
  ok: boolean;
  message: string;
  recordCount: number;
  errorCount: number;
}> {
  const start = parseYmdToDateUtc(startDate);
  const end = parseYmdToDateUtc(endDate);
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
    where: { userId, systemId: "eco-megane" },
    select: { loginId: true, encryptedPassword: true },
  });
  if (!cred) {
    return {
      ok: false,
      message: "認証情報が未登録です（/settings で登録してください）。",
      recordCount: 0,
      errorCount: 0,
    };
  }
  const loginId = cred.loginId;
  const password = decryptSecret(cred.encryptedPassword);

  const browser = await launchChromiumForRuntime({ headless: true });

  try {
    const context = await browser.newContext({
      acceptDownloads: true,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);

    // 1. ログイン画面へ
    logger.info("ecoMeganeCollector: navigating to login", {
      extra: { url: ECO_MEGANE_LOGIN_URL },
      userId,
    });
    await page.goto(ECO_MEGANE_LOGIN_URL, { waitUntil: "networkidle" });

    // 2. ID入力
    await page.locator('input[name="mailaddress"]').waitFor({ state: "visible", timeout: 15_000 });
    await page.locator('input[name="mailaddress"]').fill(loginId);

    // 3. パスワード入力
    await page.locator('input[name="password"]').waitFor({ state: "visible", timeout: 15_000 });
    await page.locator('input[name="password"]').fill(password);

    // 4. ログインボタン(a.submit)クリック後、waitForNavigation で遷移完了を待つ
    await Promise.all([
      page
        .waitForNavigation({ waitUntil: "networkidle", timeout: 30_000 })
        .catch(() => {}),
      page.locator("a.submit").first().click(),
    ]);

    // 5. その後 index.php へ移動（page.goto）し、待機＆URL確認して必要ならリトライ
    logger.info("ecoMeganeCollector: navigating to product list", {
      extra: { url: ECO_MEGANE_PRODUCT_LIST_URL },
      userId,
    });

    await page.goto(ECO_MEGANE_PRODUCT_LIST_URL, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    if (!page.url().includes("index.php")) {
      logger.warn("ecoMeganeCollector: not on index.php after goto, retrying", {
        extra: { url: page.url() },
        userId,
      });
      await page.goto(ECO_MEGANE_PRODUCT_LIST_URL, { waitUntil: "networkidle" });
      await page.waitForTimeout(5000);
    }

    logger.info("current URL after goto", { extra: { url: page.url() } });

    // デバッグ用スクリーンショット（ステップ5後）
    const debugScreenshotPath = path.join(os.tmpdir(), "eco-megane-collector-debug.png");
    try {
      await page.screenshot({ path: debugScreenshotPath, fullPage: true });
      logger.info("ecoMeganeCollector screenshot saved", {
        extra: { path: debugScreenshotPath },
        userId,
      });
    } catch (e) {
      logger.warn(
        "ecoMeganeCollector screenshot failed",
        { extra: { path: debugScreenshotPath }, userId },
        e
      );
    }

    // 「エコグラフ電力量」が表示されていることを待つ
    await page.getByText("エコグラフ電力量", { exact: false }).first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});

    // 期間を設定（指定セレクタ）
    // 日付フォーマットは yyyy/MM/dd で入力する
    const startSlash = ymdToSlash(startDate);
    const endSlash = ymdToSlash(endDate);

    // 6. 開始日入力
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const fromInput = page.locator("input#measureGenerateAmountFrom");
    try {
      await fromInput.waitFor({ state: "visible", timeout: 30_000 });
    } catch {
      const currentUrl = page.url();
      const title = await page.title().catch(() => "(title取得失敗)");
      logger.error("ecoMeganeCollector: input#measureGenerateAmountFrom not found", {
        extra: { url: currentUrl, title },
        userId,
      });
      throw new Error("input#measureGenerateAmountFrom が見つかりません（eco-megane）。");
    }
    // click でフォーカスを当ててから keyboard.type で yyyy/MM/dd を入力し、ESC でカレンダーを閉じる
    await fromInput.click();
    await page.keyboard.type(startSlash);
    await page.keyboard.press("Escape");

    // 7. 終了日入力
    const toInput = page.locator("input#measureGenerateAmountTo");
    await toInput.waitFor({ state: "visible", timeout: 15_000 });
    await toInput.click();
    await page.keyboard.type(endSlash);
    await page.keyboard.press("Escape");

    await page.evaluate(() => {
      const el = document.querySelector("input#day_report") as HTMLInputElement | null;
      if (el) el.click();
    });
    await new Promise((r) => setTimeout(r, 500));

    // ダウンロードボタンクリックとダウンロード完了を待つ
    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    // 6. ダウンロードボタンを page.evaluate で直接クリック
    await page.evaluate(() => {
      const el = document.querySelector("a#measureGenerateAmountBtn") as
        | HTMLAnchorElement
        | null;
      if (el) el.click();
    });
    const download = await downloadPromise;
    const downloadPath = path.join(os.tmpdir(), `eco-megane-${Date.now()}.csv`);
    await download.saveAs(downloadPath);

    // Shift-JIS でエンコードされた CSV を読み込み
    const csvBuffer = await fs.readFile(downloadPath);
    const csvText = iconv.decode(csvBuffer, "shift_jis");
    await fs.unlink(downloadPath).catch(() => {});

    // デバッグ: CSV の最初の3行をログ出力
    const first3Lines = csvText.split(/\r?\n/).slice(0, 3);
    logger.info("ecoMeganeCollector CSV (first 3 lines)", {
      extra: { lines: first3Lines },
      userId,
    });
    console.error("ecoMeganeCollector CSV (first 3 lines):", first3Lines);

    // デバッグ: CSV の最初の500文字をファイルに書き出し
    const csvDebugPath = "C:\\Users\\K-Irino\\Desktop\\csv-debug.txt";
    try {
      await fs.writeFile(csvDebugPath, csvText.slice(0, 500), "utf-8");
    } catch (e) {
      logger.warn("ecoMeganeCollector: csv-debug.txt write failed", {
        extra: { path: csvDebugPath },
        userId,
      });
    }

    const { recordCount, errorCount } = await parseAndUpsertCsv(csvText);
    return {
      ok: true,
      message: `取得完了。${recordCount}件を保存しました。${errorCount > 0 ? `（${errorCount}件スキップ）` : ""}`,
      recordCount,
      errorCount,
    };
  } catch (e) {
    logger.error("ecoMeganeCollector failed", { userId }, e);
    return {
      ok: false,
      message: e instanceof Error ? e.message : "データ取得に失敗しました。",
      recordCount: 0,
      errorCount: 0,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * CSVをパースし、表示名で Site を照合して DailyGeneration に upsert する。
 * カラム: 商品ID, 表示名, センサー番号, センサーID, 都道府県, データ計測日, 消費電力量(kWh), 発電電力量(kWh), ...
 */
async function parseAndUpsertCsv(csvText: string): Promise<{ recordCount: number; errorCount: number }> {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return { recordCount: 0, errorCount: 0 };

  const header = lines[0];
  const headers = parseCsvLine(header);
  const displayNameIdx = headers.findIndex((h) => (h || "").trim() === "表示名");
  const dateIdx = headers.findIndex((h) => (h || "").includes("データ計測日"));
  const generationIdx = headers.findIndex((h) => (h || "").includes("発電電力量"));

  if (displayNameIdx < 0 || dateIdx < 0 || generationIdx < 0) {
    throw new Error("CSVに必要なカラム（表示名, データ計測日, 発電電力量）が見つかりません。");
  }

  let recordCount = 0;
  let errorCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const displayName = cols[displayNameIdx]?.trim();
    const dateStr = cols[dateIdx]?.trim();
    const generationStr = cols[generationIdx]?.trim();
    if (!displayName || !dateStr || generationStr === undefined || generationStr === "") {
      errorCount++;
      continue;
    }

    // マッピングがあれば DB 用のサイト名に変換してから検索
    const mappedName = DISPLAY_NAME_MAP[displayName] ?? displayName;
    const site = await prisma.site.findFirst({
      where: { siteName: mappedName },
      select: { id: true },
    });
    if (!site) {
      // デバッグ: Site が見つからなかった表示名とマッピング後名を出力
      console.error(
        "ecoMeganeCollector: site not found",
        { displayName, mappedName }
      );
      errorCount++;
      continue;
    }

    const date = parseDate(dateStr);
    if (!date) {
      errorCount++;
      continue;
    }

    const generation = parseFloat(String(generationStr).replace(/,/g, ""));
    if (Number.isNaN(generation)) {
      errorCount++;
      continue;
    }

    // parseDate はカレンダー日を UTC 00:00 で返すため、そのまま使用（JST でずれない）
    await prisma.dailyGeneration.upsert({
      where: {
        siteId_date: {
          siteId: site.id,
          date,
        },
      },
      create: {
        siteId: site.id,
        date,
        generation,
        status: "eco-megane",
      },
      update: {
        generation,
        status: "eco-megane",
        updatedAt: new Date(),
      },
    });
    recordCount++;
  }

  return { recordCount, errorCount };
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if ((c === "," && !inQuotes) || (c === "\t" && !inQuotes)) {
      result.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  result.push(current);
  return result;
}

/**
 * 日付文字列（YYYY/MM/DD または YYYY/M/D など 1 桁月・日可）をパースし、
 * そのカレンダー日を UTC の 00:00:00 として返す。
 * 例: "2026/3/1" → 2026-03-01T00:00:00.000Z
 */
function parseDate(str: string): Date | null {
  const normalized = str.replace(/\//g, "-").trim();
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(normalized);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // 月・日は 1 始まり。Date.UTC の月は 0 始まりなので month - 1
  const d = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  return Number.isNaN(d.getTime()) ? null : d;
}
