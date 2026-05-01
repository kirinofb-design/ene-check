import fs from "fs/promises";
import os from "os";
import path from "path";
import AdmZip from "adm-zip";
import iconv from "iconv-lite";
import type { Download, Page } from "playwright-core";
import { prisma } from "@/lib/prisma";
import { launchChromiumForRuntime, sweepVercelCollectTmpAfterBrowserClose } from "@/lib/playwrightRuntime";
import { throwIfAllCollectCancelled } from "@/lib/collectCancel";
import { decryptSecret } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { applyForcedZeroOverrides, shouldForceZero } from "@/lib/forcedZeroRules";

const LAPLACE_LOGIN_URL = "https://laplaceid.energymntr.com";
const LAPLACE_SERVICE_LIST_URL = "https://laplaceid.energymntr.com/servicelist";
const LAPLACE_DATA_BASE_URL = "https://grandarch.energymntr.com";
const LAPLACE_DOWNLOAD_URL = `${LAPLACE_DATA_BASE_URL}/download`;

// DBに laplaceCode が未設定でも、既知の発電所名はコード照合できるよう補完する
const FALLBACK_LAPLACE_CODE_BY_SITE_NAME: Record<string, string> = {
  "下和田（高圧）": "J-043",
  "須山②（高圧）": "J-052",
  "松本②238-1HD（低圧）": "J-058",
  "長谷（低圧）": "J-051",
  "落居（笠名高圧）": "J-023",
  "静谷（高圧）": "J-047",
  "比木（高圧）": "J-044",
  "合戸（高圧）": "J-045",
  "笠名②（高圧）": "J-053",
  "西方（高圧）": "J-056",
  "松本242（低圧）": "J-057",
};

/** 既定はヘッドレス（画面非表示）。調査時のみ LAPLACE_DEBUG_HEADFUL=1 でウィンドウ表示 */
function isLaplaceDebugHeadfulEnabled(): boolean {
  if (process.env.LAPLACE_DEBUG_HEADFUL === "1") return true;
  if (process.env.LAPLACE_DEBUG_HEADFUL === "0") return false;
  return false;
}

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

/**
 * CSV 1列目の先頭が全角英字（例: Ｊ-053）の場合、半角英字へ正規化してからコード抽出する。
 * Laplace の出力によっては J が全角になることがある。
 */
/** カンマを含む発電所名に対応（RFC 4180 風のダブルクォート） */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

function normalizeHeaderLabel(raw: string): string {
  return raw
    .trim()
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[()（）]/g, "")
    .toLowerCase();
}

function normalizeLaplaceLeadingLetters(s: string): string {
  let out = "";
  for (const c of s) {
    const code = c.charCodeAt(0);
    if (code >= 0xff21 && code <= 0xff3a) {
      out += String.fromCharCode(code - 0xff21 + 0x41);
    } else if (code >= 0xff41 && code <= 0xff5a) {
      out += String.fromCharCode(code - 0xff41 + 0x61);
    } else {
      out += c;
    }
  }
  return out;
}

/** 全角マイナス・ダッシュ類を半角ハイフンへ（J－053 等でコード抽出失敗するのを防ぐ） */
function normalizeLaplaceHyphens(s: string): string {
  return s.replace(/[\uFF0D\u2212\u2010\u2011\u2013\u2014]/g, "-");
}

/** Laplace が CSV 出力時に先頭英字を「?」「？」へ置換することがある（J-053 → ?-053） */
function normalizeCorruptedLaplaceCodePrefix(s: string): string {
  return s.replace(/^[?\uFF1F]-(\d{2,4})/, "J-$1");
}

function normalizeLaplaceSiteNameForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/^[A-Z]-\d{2,4}/i, "")
    .replace(/[　\s]/g, "")
    .replace(/\(株\)|（株）|㈱/g, "")
    .replace(/new$/i, "")
    .trim()
    .toLowerCase();
}

function laplaceNameTokens(s: string): string[] {
  const normalized = normalizeLaplaceSiteNameForMatch(s)
    .replace(/太陽光発電所|太陽光|発電所|発電設備|システム|高圧|低圧|特高|第三|第二|第一|本社|株式会社|フジ物産/g, " ")
    .replace(/[0-9\-]/g, " ")
    .replace(/[()（）]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];
  return normalized
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function isMissingCsvNumber(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  if (t === "-" || t === "—" || t === "－") return true;
  return false;
}

function parseCsvDateToUtcDate(raw: string): Date | null {
  const m = raw.trim().replace(/\//g, "-").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0));
}


function getMonthsInRange(startDate: Date, endDate: Date): string[] {
  const months: string[] = [];
  const cur = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1));
  while (cur.getTime() <= end.getTime()) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, "0");
    months.push(`${y}-${m}`);
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return months;
}

async function readZipFirstCsvAsText(zipPath: string): Promise<string> {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  console.log(
    "zip entries:",
    entries.map((e) => e.entryName)
  );
  const csvEntry = entries.find((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith(".csv"));
  if (!csvEntry) {
    throw new Error("ZIP内にCSVが見つかりません。");
  }
  const buf = csvEntry.getData();
  const fullText = iconv.decode(buf, "shift_jis");
  const preview = fullText.split(/\r?\n/).slice(0, 5).join("\n");
  console.log("first csv preview:\n", preview);
  return fullText;
}

/** yearMonth は "2026-03" 形式。ラジオは name/value 固定。月報時は start_year/start_month のみ（end は disabled のため触らない） */
async function configureLaplaceDownloadForm(page: Page, yearMonth: string): Promise<Download> {
  const [year, month] = yearMonth.split("-");
  if (!year || !month) {
    throw new Error(`ラプラスDL: yearMonth が不正です (${yearMonth})`);
  }
  const monthNum = String(Number(month));

  await page.waitForSelector('select[name="start_year"]', { timeout: 30_000 }).catch(() => {});

  await page.check('input[name="r00"][value="not_totalling"]');
  await page.check('input[name="r01"][value="day"]');
  await page.check('input[name="r02"][value="monthly"]');
  await page.waitForTimeout(500);
  await page.check('input[name="r03"][value="pcs"]');
  await page.check('input[name="r04"][value="integration"]');

  await page.selectOption('select[name="start_year"]', year);
  try {
    await page.selectOption('select[name="start_month"]', monthNum);
  } catch {
    await page.selectOption('select[name="start_month"]', month.padStart(2, "0"));
  }

  console.log(
    `form set: 集計=なし, 単位=1日, 範囲=月報, 期間=${year}-${month}, 対象=PCS, ファイル=1ファイル`
  );
  await page.waitForTimeout(500);

  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("grandarch") && (url.includes("api") || url.includes("download") || url.includes("csv"))) {
      console.log("DL request:", req.method(), url);
    }
  });
  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("grandarch") && (url.includes("api") || url.includes("download") || url.includes("csv"))) {
      const ct = res.headers()["content-type"]?.slice(0, 50) ?? "";
      console.log("DL response:", res.status(), ct, url);
    }
  });

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 120_000 }),
    (async () => {
      try {
        await page.click("div.download_btn a");
      } catch {
        await page.click(".download_btn a");
      }
      console.log("download btn clicked");
      await page
        .waitForResponse((res) => res.url().includes("check_convert_name") && res.status() === 200, {
          timeout: 30_000,
        })
        .catch(() => console.log("check_convert_name timeout — continuing"));
    })(),
  ]);

  console.log("download started:", download.suggestedFilename());
  return download;
}

async function loginLaplace(page: any, loginId: string, password: string) {
  // ステップ3: 利用規約アラート等の window.alert — page.goto() より前に登録
  page.on("dialog", async (dialog: { message(): string; accept(): Promise<void> }) => {
    logger.info("laplaceCollector: dialog", { extra: { message: dialog.message() } });
    await dialog.accept().catch(() => {});
  });

  await page.goto(LAPLACE_LOGIN_URL, { waitUntil: "domcontentloaded" });
  // 先に name / id を優先（最初の input[type=text] は誤マッチしやすい）
  const idSelectors = [
    'input[name="username"]',
    'input[name="loginId"]',
    'input#username',
    'input[type="email"]',
    'form input[type="text"]',
    'input[type="text"]',
  ];
  const pwSelectors = ['input[name="password"]', 'input[type="password"]'];
  const btnSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("ログイン")',
    'button:has-text("Login")',
  ];

  let idOk = false;
  for (const sel of idSelectors) {
    const loc = page.locator(sel).first();
    if (await loc.count()) {
      await loc.fill(loginId);
      idOk = true;
      break;
    }
  }
  if (!idOk) throw new Error("ラプラス: ログインID入力欄が見つかりません。");

  let pwOk = false;
  for (const sel of pwSelectors) {
    const loc = page.locator(sel).first();
    if (await loc.count()) {
      await loc.fill(password);
      pwOk = true;
      break;
    }
  }
  if (!pwOk) throw new Error("ラプラス: パスワード入力欄が見つかりません。");

  let submitOk = false;
  for (const sel of btnSelectors) {
    const loc = page.locator(sel).first();
    if (await loc.count()) {
      await loc.click();
      submitOk = true;
      break;
    }
  }
  if (!submitOk) throw new Error("ラプラス: ログインボタンが見つかりません。");

  // ステップ3〜4: アラート処理後の描画待ち → 利用規約の再同意ページ
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

  const bodyAfterLogin = await page.locator("body").innerText().catch(() => "");
  const onTermsReconsentPage =
    bodyAfterLogin.includes("利用規約の再同意") ||
    bodyAfterLogin.includes("操作を続ける") ||
    bodyAfterLogin.includes("利用規約を読み、その内容に同意します") ||
    (bodyAfterLogin.includes("利用規約") &&
      (bodyAfterLogin.includes("同意") || bodyAfterLogin.includes("読み")));

  if (onTermsReconsentPage) {
    logger.info("laplaceCollector: terms reconsent page detected", { extra: { url: page.url() } });

    // 文言ゆれに強い同意操作（チェック→続行）
    const checkboxCandidates = [
      page.getByRole("checkbox", { name: /利用規約/i }).first(),
      page.locator('input[type="checkbox"]').first(),
    ];
    for (const cb of checkboxCandidates) {
      try {
        if (await cb.count()) {
          await cb.check({ timeout: 5000 }).catch(async () => {
            await cb.click({ timeout: 5000 }).catch(() => {});
          });
          break;
        }
      } catch {
        // ignore
      }
    }

    const continueBtnCandidates = [
      page.getByRole("button", { name: /操作を続ける|同意して続ける|次へ|OK|同意/i }).first(),
      page.locator('button:has-text("操作を続ける")').first(),
      page.locator('button:has-text("同意")').first(),
      page.locator('input[type="submit"]').first(),
    ];
    let clicked = false;
    for (const btn of continueBtnCandidates) {
      try {
        if (await btn.count()) {
          await btn.click({ timeout: 8000 });
          clicked = true;
          break;
        }
      } catch {
        // try next
      }
    }
    if (!clicked) {
      logger.warn("laplaceCollector: terms continue button not found", { extra: { url: page.url() } });
    }

    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  }

  logger.info("laplaceCollector: after login", { extra: { url: page.url(), title: await page.title() } });

  const pwVisible = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
  const loginBtnStill = await page.getByRole("button", { name: /ログイン|Login/i }).first().isVisible().catch(() => false);
  const loginContainer = page.locator(".loginContainer").first();
  const loginContainerVisible =
    (await loginContainer.count()) > 0 && (await loginContainer.isVisible().catch(() => false));
  const stillLogin = loginContainerVisible || pwVisible || loginBtnStill;

  if (stillLogin) {
    const bodySnippet = (await page.locator("body").innerText().catch(() => "")).slice(0, 1200);
    logger.warn("laplaceCollector: login container still visible", {
      extra: { url: page.url(), bodySnippet: bodySnippet.replace(/\s+/g, " ").trim() },
    });

    const lower = bodySnippet.toLowerCase();
    if (bodySnippet.includes("パスワード") && (bodySnippet.includes("誤り") || bodySnippet.includes("不正"))) {
      throw new Error("ラプラス: ログインに失敗しました（ID/パスワード誤りの可能性が高いです）。/settings の認証情報を確認してください。");
    }
    if (lower.includes("captcha") || bodySnippet.includes("画像認証")) {
      throw new Error("ラプラス: ログイン画面で追加認証（CAPTCHA 等）が要求されています。手動ログインで突破後に再実行してください。");
    }

    throw new Error(
      "ラプラス: ログイン後もログイン画面のままです。ID/パスワード・利用規約の同意を確認してください。"
    );
  }
}

async function openGrandArchFromServiceList(page: any): Promise<any> {
  await page.goto(LAPLACE_SERVICE_LIST_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

  const html = (await page.content().catch(() => "")) as string;
  console.log("servicelist html:", html.slice(0, 3000));

  const hasPlaywrightContext = page && typeof page.context === "function" && typeof page.waitForURL === "function";
  if (hasPlaywrightContext) {
    const context = page.context();
    const popupPromise =
      context && typeof context.waitForEvent === "function"
        ? context.waitForEvent("page", { timeout: 10000 }).catch(() => null)
        : Promise.resolve(null);

    let clicked = false;
    const directLink = page.locator('a[href*="grandarch.energymntr.com"]').first();
    if ((await directLink.count()) > 0) {
      await directLink.click();
      clicked = true;
    }

    // ステップ5: 「L・eye 総合監視」カードの「開く」（表記ゆれ: スペースなし / 全角スペース）
    if (!clicked) {
      const cardByClass = page.locator(".service-card").filter({ hasText: /L・eye\s*総合監視/ }).first();
      if ((await cardByClass.count()) > 0) {
        try {
          await cardByClass.getByRole("button", { name: "開く" }).click({ timeout: 12_000 });
          clicked = true;
        } catch {
          /* fall through */
        }
      }
    }
    if (!clicked) {
      try {
        await page
          .locator(".service-card")
          .filter({ hasText: "L・eye" })
          .filter({ hasText: "総合監視" })
          .first()
          .getByRole("button", { name: "開く" })
          .click({ timeout: 12_000 });
        clicked = true;
      } catch {
        /* fall through */
      }
    }
    if (!clicked) {
      try {
        await page.locator("text=L・eye 総合監視").locator("..").locator('button:has-text("開く")').first().click({ timeout: 8000 });
        clicked = true;
      } catch {
        /* fall through */
      }
    }
    if (!clicked) {
      clicked = await page.evaluate(() => {
        const matchesEye = (text: string) =>
          /L・eye\s*総合監視/.test(text) || (text.includes("L・eye") && text.includes("総合監視"));
        const candidates = Array.from(document.querySelectorAll("a, button, .service-card, section, article, div"));
        for (const el of candidates) {
          if (!matchesEye(el.textContent ?? "")) continue;
          const openBtn =
            (el as HTMLElement).querySelector('button') ||
            Array.from((el as HTMLElement).querySelectorAll("button")).find((b) =>
              (b.textContent ?? "").trim().includes("開く")
            );
          if (openBtn) {
            (openBtn as HTMLButtonElement).click();
            return true;
          }
        }
        const buttons = Array.from(document.querySelectorAll("button"));
        for (const btn of buttons) {
          const t = (btn.textContent ?? "").trim();
          if (!t.includes("開く")) continue;
          const card = btn.closest(".service-card, section, article, div");
          if (card && matchesEye(card.textContent ?? "")) {
            btn.click();
            return true;
          }
        }
        return false;
      });
    }

    if (!clicked) {
      // UI が崩れている場合の最終フォールバック: Grand Arch へ直接遷移してみる
      await page.goto(LAPLACE_DATA_BASE_URL, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      if (/grandarch\.energymntr\.com/i.test(page.url())) {
        return page;
      }
      const links = (await page
        .$$eval("a, button", (els: Element[]) =>
          els.map((e) => ({
            tag: e.tagName,
            text: (e.textContent ?? "").trim(),
            href: e instanceof HTMLAnchorElement ? e.href : "",
          }))
        )
        .catch(() => [])) as Array<{ tag: string; text: string; href: string }>;
      console.log("servicelist links:", JSON.stringify(links));
      throw new Error("ラプラス: サービス一覧で「L・eye総合監視」の開くボタンが見つかりません。");
    }

    const popup = await popupPromise;
    const targetPage = popup ?? page;
    if (targetPage === page) {
      await page.waitForURL(/grandarch\.energymntr\.com/i, { timeout: 20000 }).catch(() => {});
    } else if (typeof targetPage.waitForLoadState === "function") {
      await targetPage.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
    }
    return targetPage;
  }

  await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
  return page;
}

async function navigateToDownloadFromTop(page: Page): Promise<void> {
  // 取得中が消えるまで待機
  await page.waitForLoadState("networkidle", { timeout: 30000 });
  await page.waitForFunction(
    () => !document.body.innerText.includes("取得中"),
    { timeout: 60000 }
  );
  await page.waitForTimeout(500);
  console.log("all status loaded");

  // ダイアログ自動承認
  page.on("dialog", async (dialog: { message(): string; accept(): Promise<void> }) => {
    console.log("dialog:", dialog.message());
    await dialog.accept().catch(() => {});
  });

  // 1. 「選択」ボタン
  await page.click("li.checkbox_mode_on_btn");
  await page.waitForTimeout(1000);

  const before = await page.evaluate(() => {
    const boxes = document.querySelectorAll('input[type="checkbox"]');
    const checked = Array.from(boxes).filter((el) => (el as HTMLInputElement).checked).length;
    return { total: boxes.length, checked };
  });
  console.log("check items:", before.total, "checked:", before.checked);

  // 2. evaluate で一括クリック（stale / 仮想リスト対策）
  const result = await page.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    let clicked = 0;
    boxes.forEach((el) => {
      const input = el as HTMLInputElement;
      if (!input.checked) {
        input.click();
        clicked++;
      }
    });
    const afterChecked = document.querySelectorAll('input[type="checkbox"]:checked').length;
    return { total: boxes.length, clicked, afterChecked };
  });
  console.log("evaluate result:", result);

  if (result.afterChecked < result.total) {
    await page.evaluate(() => {
      document.querySelectorAll('input[type="checkbox"]').forEach((el) => {
        const input = el as HTMLInputElement;
        if (!input.checked) {
          input.checked = true;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    });
    console.log("forced check done");
  }

  // 0 件のときのカスタム UI フォールバック（従来）
  if (before.total === 0) {
    const candidates = await page.evaluate(() => {
      const els = document.querySelectorAll('[class*="check"], [class*="select"]');
      return Array.from(els).slice(0, 24).map((el) => ({
        tag: el.tagName,
        className: el.className,
        role: el.getAttribute("role"),
        ariaChecked: el.getAttribute("aria-checked"),
      }));
    });
    console.log("checkbox candidates:", JSON.stringify(candidates));
    for (const sel of [
      'li[class*="check"]:not(.checkbox_mode_on_btn)',
      'label[class*="check"]',
      'span[class*="check"]',
      '[role="checkbox"]',
    ]) {
      const els = await page.$$(sel);
      for (const el of els) await el.click().catch(() => {});
    }
  }

  // 3. 確認ログ
  const after = await page.evaluate(() => {
    const boxes = document.querySelectorAll('input[type="checkbox"]');
    const checked = Array.from(boxes).filter((el) => (el as HTMLInputElement).checked).length;
    return { total: boxes.length, checked };
  });
  console.log("after select all — check items:", after.total, "checked:", after.checked);

  // 4. CSV: ネットワーク監視（調査用）→ クリック後 5 秒だけ待機（waitForDownload / waitForURL は外す）
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("download") || u.includes("csv") || u.includes("export")) {
      console.log("request:", req.method(), u);
    }
  });
  page.on("response", (res) => {
    const u = res.url();
    if (u.includes("download") || u.includes("csv") || u.includes("export")) {
      console.log("response:", res.status(), u);
    }
  });

  await page.click("li.download_btn");
  await page.waitForTimeout(5000);
  console.log("after csv click URL:", page.url());
}

async function parseAndUpsertLaplaceCsv(
  csvText: string,
  start: Date,
  end: Date
): Promise<{ recordCount: number; errorCount: number }> {
  /** laplaceCode は CSV と突き合わせるため、監視システム種別に関係なく全 Site を対象にする */
  const dbSites = await prisma.site.findMany({
    select: { id: true, siteName: true, laplaceCode: true, monitoringSystem: true },
  });
  const siteByLaplaceCode = new Map<string, (typeof dbSites)[number]>();
  for (const s of dbSites) {
    const code = s.laplaceCode ?? FALLBACK_LAPLACE_CODE_BY_SITE_NAME[s.siteName] ?? null;
    if (!code) continue;
    if (!siteByLaplaceCode.has(code)) {
      siteByLaplaceCode.set(code, s);
    }
  }

  const allLines = csvText.split(/\r?\n/).filter((l) => l.trim());
  const headerCols = splitCsvLine(allLines[0] ?? "");
  const normalizedHeaders = headerCols.map((h) => normalizeHeaderLabel(h));
  /** 列数が発電所で微妙に違う場合があるため、ヘッダー名で交流電力量列を特定（なければ従来の 11 列目） */
  const acKwhColIndex = Math.max(
    0,
    normalizedHeaders.findIndex((h) => h.includes("交流電力量")) >= 0
      ? normalizedHeaders.findIndex((h) => h.includes("交流電力量"))
      : 11
  );
  const sellKwhColIndex =
    normalizedHeaders.findIndex((h) => h.includes("売電電力量")) >= 0
      ? normalizedHeaders.findIndex((h) => h.includes("売電電力量"))
      : 5;
  const lines = allLines.slice(1);
  if (lines.length === 0) return { recordCount: 0, errorCount: 0 };

  const codesInCsv = [
    ...new Set(
      lines
        .map((line) => {
          const firstCol = splitCsvLine(line)[0]?.trim() ?? "";
          const normalized = normalizeCorruptedLaplaceCodePrefix(
            normalizeLaplaceHyphens(normalizeLaplaceLeadingLetters(firstCol))
          );
          return normalized.match(/^([A-Z]-\d+)/)?.[1];
        })
        .filter((x): x is string => Boolean(x))
    ),
  ];
  console.log("laplace codes in CSV:", codesInCsv);

  let recordCount = 0;
  let errorCount = 0;

  for (const line of lines) {
    const cols = splitCsvLine(line).map((c) => c.trim());
    const minCols = Math.max(12, acKwhColIndex + 1);
    if (cols.length < minCols) {
      errorCount++;
      continue;
    }

    const csvSiteName = cols[0]?.trim() ?? "";
    const dateStr = cols[1]?.trim() ?? "";
    let acKwh = cols[acKwhColIndex]?.trim() ?? "";
    /** 発電所名に未クォートのカンマがあると列がずれ、固定インデックスが空になる。末尾4列（故障〜制御率）の手前＝交流電力量 */
    if (isMissingCsvNumber(acKwh) && cols.length >= 15) {
      const fromEndAc = cols[cols.length - 5]?.trim() ?? "";
      if (!isMissingCsvNumber(fromEndAc)) {
        acKwh = fromEndAc;
      }
    }

    if (!csvSiteName || !dateStr) {
      errorCount++;
      continue;
    }

    const codeMatch = normalizeCorruptedLaplaceCodePrefix(
      normalizeLaplaceHyphens(normalizeLaplaceLeadingLetters(csvSiteName))
    ).match(/^([A-Z]-\d+)/);
    const laplaceCode = codeMatch?.[1];
    if (!laplaceCode) {
      continue;
    }

    /** 一部発電所行では交流電力量が空だが売電のみ入っているケースがある */
    if (isMissingCsvNumber(acKwh) && sellKwhColIndex >= 0 && cols.length > sellKwhColIndex) {
      acKwh = cols[sellKwhColIndex]?.trim() ?? "";
    }

    if (isMissingCsvNumber(acKwh)) continue;

    const matchByCode = siteByLaplaceCode.get(laplaceCode);
    const matchesByCode = matchByCode ? [matchByCode] : [];
    if (matchesByCode.length > 1) {
      console.warn(
        "laplaceCode が複数 Site に重複しています（先頭の Site を使用）:",
        laplaceCode,
        matchesByCode.map((s) => s.siteName)
      );
    }
    let site = matchesByCode[0];
    if (!site) {
      // laplaceCode 未設定のサイト向けフォールバック（CSV発電所名で近似一致）
      const csvNameNorm = normalizeLaplaceSiteNameForMatch(csvSiteName);
      const byNameContains = dbSites.find((s) => {
        const siteNorm = normalizeLaplaceSiteNameForMatch(s.siteName);
        if (!siteNorm || !csvNameNorm) return false;
        return csvNameNorm.includes(siteNorm) || siteNorm.includes(csvNameNorm);
      });
      const byNameToken =
        byNameContains ??
        (() => {
          const csvTokens = laplaceNameTokens(csvSiteName);
          if (csvTokens.length === 0) return undefined;
          let best: { site: (typeof dbSites)[number]; score: number } | null = null;
          for (const candidate of dbSites) {
            const siteTokens = laplaceNameTokens(candidate.siteName);
            if (siteTokens.length === 0) continue;
            const score = siteTokens.reduce(
              (sum, token) => (csvTokens.some((ct) => ct.includes(token) || token.includes(ct)) ? sum + 1 : sum),
              0
            );
            if (score <= 0) continue;
            if (!best || score > best.score) best = { site: candidate, score };
          }
          return best?.site;
        })();
      if (byNameToken) {
        site = byNameToken;
      } else {
        console.log("site not found for laplaceCode:", laplaceCode);
        errorCount++;
        continue;
      }
    }

    const dateUtc = parseCsvDateToUtcDate(dateStr);
    if (!dateUtc) {
      errorCount++;
      continue;
    }
    if (dateUtc.getTime() < start.getTime() || dateUtc.getTime() > end.getTime()) continue;

    const parsedGeneration = parseFloat(acKwh.replace(/,/g, ""));
    if (Number.isNaN(parsedGeneration)) {
      errorCount++;
      continue;
    }
    const generation = shouldForceZero(site.siteName, dateUtc, "laplace") ? 0 : parsedGeneration;

    await prisma.dailyGeneration.upsert({
      where: { siteId_date: { siteId: site.id, date: dateUtc } },
      create: {
        siteId: site.id,
        date: dateUtc,
        generation,
        status: "laplace",
      },
      update: {
        generation,
        status: "laplace",
        updatedAt: new Date(),
      },
    });
    recordCount++;
  }

  return { recordCount, errorCount };
}

export async function runLaplaceCollector(
  userId: string,
  startDate: string,
  endDate: string
): Promise<{ ok: boolean; message: string; recordCount: number; errorCount: number }> {
  const isRetryableLaplaceError = (e: unknown): boolean => {
    const msg = e instanceof Error ? e.message : String(e);
    return (
      msg.includes("ERR_INSUFFICIENT_RESOURCES") ||
      msg.includes("Execution context was destroyed") ||
      msg.includes("Target page, context or browser has been closed") ||
      msg.includes("ログイン後もログイン画面のまま")
    );
  };
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
    where: { userId, systemId: "grand-arch" },
    select: { loginId: true, encryptedPassword: true },
  });
  if (!cred) {
    return {
      ok: false,
      message: "ラプラス（Grand Arch）の認証情報が未登録です（/settings で登録してください）。",
      recordCount: 0,
      errorCount: 0,
    };
  }
  const password = decryptSecret(cred.encryptedPassword);
  const loginId = cred.loginId;

  const headful = isLaplaceDebugHeadfulEnabled();
  logger.info("laplaceCollector: browser launch mode", {
    userId,
    extra: { headful, envHeadful: process.env.LAPLACE_DEBUG_HEADFUL ?? null, nodeEnv: process.env.NODE_ENV ?? null },
  });
  const launchLaplaceBrowser = async (stableMode = false) =>
    launchChromiumForRuntime({
      headless: !headful,
      extraArgs: stableMode
        ? ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"]
        : ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    });

  let browser = await launchLaplaceBrowser();
  let recordCount = 0;
  let errorCount = 0;

  try {
    throwIfAllCollectCancelled(userId);
    const createContext = async () => {
      const create = async () =>
        browser.newContext({
          acceptDownloads: true,
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        });
      try {
        return await create();
      } catch {
        await browser.close().catch(() => {});
        browser = await launchLaplaceBrowser(true);
        return await create();
      }
    };
    const createPage = async (contextObj: Awaited<ReturnType<typeof createContext>>) => {
      try {
        return await contextObj.newPage();
      } catch {
        await contextObj.close().catch(() => {});
        await browser.close().catch(() => {});
        browser = await launchLaplaceBrowser(true);
        const newContext = await createContext();
        await newContext.addInitScript(() => {
          Object.defineProperty(navigator, "webdriver", { get: () => false });
        });
        context = newContext;
        return await newContext.newPage();
      }
    };

    let context = await createContext();
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
    let page = await createPage(context);
    page.setDefaultTimeout(60_000);

    const loginAndOpen = async () => {
      await loginLaplace(page, loginId, password);
      page = await openGrandArchFromServiceList(page);
    };

    try {
      await loginAndOpen();
    } catch (e) {
      if (!isRetryableLaplaceError(e)) throw e;
      logger.warn("laplaceCollector: initial login/open failed, retry with fresh session", {
        userId,
        extra: { error: e instanceof Error ? e.message : String(e) },
      });
      await context.close().catch(() => {});
      context = await createContext();
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
      });
      page = await createPage(context);
      page.setDefaultTimeout(60_000);
      await loginAndOpen();
    }

    const recreateLaplaceSession = async () => {
      await context.close().catch(() => {});
      const newContext = await createContext();
      await newContext.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
      });
      const newPage = await createPage(newContext);
      newPage.setDefaultTimeout(60_000);
      await loginLaplace(newPage, loginId, password);
      const opened = await openGrandArchFromServiceList(newPage);
      context = newContext;
      return { context: newContext, page: opened };
    };

    const months = getMonthsInRange(start, end);
    for (const yearMonth of months) {
      throwIfAllCollectCancelled(userId);
      const runMonth = async () => {
        await navigateToDownloadFromTop(page);
        const download = await configureLaplaceDownloadForm(page, yearMonth);
        const zipPath = path.join(os.tmpdir(), `laplace-${yearMonth}-${Date.now()}.zip`);
        await download.saveAs(zipPath);
        const csvText = await readZipFirstCsvAsText(zipPath);
        await fs.unlink(zipPath).catch(() => {});

        const monthResult = await parseAndUpsertLaplaceCsv(csvText, start, end);
        recordCount += monthResult.recordCount;
        errorCount += monthResult.errorCount;
        logger.info("laplaceCollector: month processed", {
          userId,
          extra: { yearMonth, recordCount: monthResult.recordCount, errorCount: monthResult.errorCount },
        });
      };

      try {
        await runMonth();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const isClosedTarget =
          msg.includes("Target page, context or browser has been closed") || msg.includes("Execution context was destroyed");
        if (!isClosedTarget) throw e;

        logger.warn("laplaceCollector: month failed by closed target, retry with relogin", {
          userId,
          extra: { yearMonth, error: msg },
        });
        const recovered = await recreateLaplaceSession();
        page = recovered.page;
        await runMonth();
      }
    }

    // CSVに日が存在しない場合でも、停止中サイトの強制0ルールを必ず反映する
    await applyForcedZeroOverrides(prisma, start, end, "laplace");

    return {
      ok: true,
      message: `ラプラスデータ取得が完了しました（保存: ${recordCount}件 / スキップ: ${errorCount}件）。`,
      recordCount,
      errorCount,
    };
  } catch (e) {
    logger.error("laplaceCollector failed", { userId }, e);
    throw e;
  } finally {
    await browser.close().catch(() => {});
    await sweepVercelCollectTmpAfterBrowserClose();
  }
}
