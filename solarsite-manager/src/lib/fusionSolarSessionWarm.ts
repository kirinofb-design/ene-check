import { prisma } from "@/lib/prisma";
import { withPrismaRetry, PRISMA_RETRY_COLLECTOR } from "@/lib/withPrismaRetry";
import { decryptSecret } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { isVercelRuntime, launchChromiumForRuntime } from "@/lib/playwrightRuntime";
import {
  clearMonitoringSession,
  ensureMonitoringSessionCacheTable,
  loadMonitoringSession,
  saveMonitoringSession,
} from "@/lib/monitoringSessionCache";
import type { Page } from "playwright-core";

const BASE_URL = "https://jp5.fusionsolar.huawei.com";
const HOME_URL_CANDIDATES = [
  `${BASE_URL}/netecowebext/home/index.html`,
  `${BASE_URL}/pvmswebsite/assets/build/index.html#/view/home`,
];

function urlLooksFusionLoggedIn(href: string): boolean {
  const lower = href.toLowerCase();
  if (href.includes("/unisso/login")) return false;
  if (lower.includes("#/login")) return false;
  if (lower.includes("/login") && lower.includes("unisso")) return false;
  if (href.includes("/netecowebext/")) return true;
  if (href.includes("/pvmswebsite/")) return true;
  return false;
}

async function looksLikeLoginPage(page: Page): Promise<boolean> {
  const usernameVisible =
    (await page.locator("input#username").count().catch(() => 0)) > 0 &&
    (await page.locator("input#username").first().isVisible().catch(() => false));
  if (usernameVisible) return true;
  const url = page.url().toLowerCase();
  return url.includes("/unisso/login") || url.includes("#/login");
}

async function pageLooksFusionLoggedIn(page: Page): Promise<boolean> {
  if (urlLooksFusionLoggedIn(page.url())) return true;
  if (await looksLikeLoginPage(page)) return false;
  const hasLoginInput =
    (await page.locator("input#username").count().catch(() => 0)) > 0 &&
    (await page.locator("input#username").first().isVisible().catch(() => false));
  return !hasLoginInput;
}

async function fillFusionLoginForm(page: Page, loginId: string, password: string): Promise<void> {
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

  // ログイン画面へ確実に誘導（ホーム直遷移だと入力欄が出ないことがある）
  const loginUrls = [
    `${BASE_URL}/unisso/login.action`,
    `${BASE_URL}/`,
    BASE_URL,
  ];

  let idFilled = false;
  let pwFilled = false;
  for (const loginUrl of loginUrls) {
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(1200);

    const start = Date.now();
    idFilled = false;
    pwFilled = false;
    while (Date.now() - start < 55_000) {
      if (!idFilled) {
        for (const sel of idSelCandidates) {
          const loc = page.locator(sel).first();
          if ((await loc.count().catch(() => 0)) > 0 && (await loc.isVisible().catch(() => false))) {
            await loc.click({ timeout: 5_000 }).catch(() => {});
            await loc.fill("");
            await loc.fill(loginId);
            idFilled = true;
            break;
          }
        }
      }
      if (!pwFilled) {
        for (const sel of pwSelCandidates) {
          const loc = page.locator(sel).first();
          if ((await loc.count().catch(() => 0)) > 0 && (await loc.isVisible().catch(() => false))) {
            await loc.click({ timeout: 5_000 }).catch(() => {});
            await loc.fill("");
            await loc.fill(password);
            pwFilled = true;
            break;
          }
        }
      }
      if (idFilled && pwFilled) break;
      await page.waitForTimeout(300);
    }
    if (idFilled && pwFilled) break;
  }

  if (!idFilled || !pwFilled) {
    throw new Error("FusionSolar: ログインID/パスワード入力に失敗しました（入力欄の特定に失敗）。");
  }

  let loginBtn = null as ReturnType<Page["locator"]> | null;
  for (const sel of loginBtnCandidates) {
    const loc = page.locator(sel).first();
    if ((await loc.count().catch(() => 0)) > 0 && (await loc.isVisible().catch(() => false))) {
      loginBtn = loc;
      break;
    }
  }
  if (!loginBtn) throw new Error("FusionSolar: ログインボタンが見つかりません。");

  await Promise.all([
    page.waitForURL((u) => urlLooksFusionLoggedIn(u.toString()), { timeout: 35_000 }).catch(() => {}),
    (async () => {
      await loginBtn!.click();
      await page.keyboard.press("Enter").catch(() => {});
    })(),
  ]);

  for (const homeUrl of HOME_URL_CANDIDATES) {
    await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
    if (await pageLooksFusionLoggedIn(page)) return;
  }
  if (!(await pageLooksFusionLoggedIn(page))) {
    throw new Error(`FusionSolar: ログイン完了を確認できませんでした（url=${page.url()}）。`);
  }
}

/**
 * FusionSolar の storageState を確立して DB に保存する。
 * 本番一括の前に呼び、各 station チャンクでの再ログインを減らす。
 */
export async function warmFusionSolarSession(
  userId: string
): Promise<{ ok: boolean; message: string; reused?: boolean }> {
  await ensureMonitoringSessionCacheTable();
  const existing = await loadMonitoringSession(userId, "fusion-solar");
  if (existing) {
    // 既存セッションの簡易検証
    let browser = await launchChromiumForRuntime({
      headless: true,
      extraArgs: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
    });
    try {
      const context = await browser.newContext({
        storageState: JSON.parse(existing),
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        locale: "ja-JP",
      });
      const page = await context.newPage();
      page.setDefaultTimeout(45_000);
      for (const homeUrl of HOME_URL_CANDIDATES) {
        await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 25_000 }).catch(() => {});
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
        if (await pageLooksFusionLoggedIn(page)) {
          const state = await context.storageState();
          await saveMonitoringSession(userId, "fusion-solar", JSON.stringify(state));
          return { ok: true, message: "FusionSolar セッションを再利用しました。", reused: true };
        }
      }
      await clearMonitoringSession(userId, "fusion-solar");
    } catch (e) {
      logger.warn("warmFusionSolarSession: cached session invalid", {
        userId,
        extra: { error: e instanceof Error ? e.message : String(e) },
      });
      await clearMonitoringSession(userId, "fusion-solar");
    } finally {
      await browser.close().catch(() => {});
      if (isVercelRuntime()) await new Promise((r) => setTimeout(r, 2500));
    }
  }

  const cred = await withPrismaRetry(
    () =>
      prisma.monitoringCredential.findFirst({
        where: { userId, systemId: "fusion-solar" },
        select: { loginId: true, encryptedPassword: true },
      }),
    PRISMA_RETRY_COLLECTOR
  );
  if (!cred) {
    return { ok: false, message: "FusionSolar の認証情報が未登録です（/settings で登録してください）。" };
  }

  const browser = await launchChromiumForRuntime({
    headless: true,
    extraArgs: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
  });
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "ja-JP",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    await fillFusionLoginForm(page, cred.loginId, decryptSecret(cred.encryptedPassword));
    const state = await context.storageState();
    await saveMonitoringSession(userId, "fusion-solar", JSON.stringify(state));
    return { ok: true, message: "FusionSolar セッションを確立しました。", reused: false };
  } catch (e) {
    logger.error("warmFusionSolarSession failed", { userId }, e);
    return {
      ok: false,
      message: e instanceof Error ? e.message : "FusionSolar セッション確立に失敗しました。",
    };
  } finally {
    await browser.close().catch(() => {});
    if (isVercelRuntime()) await new Promise((r) => setTimeout(r, 3000));
  }
}
