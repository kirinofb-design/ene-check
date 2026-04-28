import path from "path";
import os from "os";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/encryption";
import { MONITORING_AUTH_TARGETS } from "@/lib/monitoringSystemsAuth";
import { logger } from "@/lib/logger";
import { launchChromiumForRuntime } from "@/lib/playwrightRuntime";

export type SystemId =
  | "eco-megane"
  | "fusion-solar"
  | "sunny-portal"
  | "grand-arch"
  | "solar-monitor-sf"
  | "solar-monitor-se";

export type AutoLoginOptions = {
  headless?: boolean;
  timeoutMs?: number;
  slowMoMs?: number;
};

export type AutoLoginResult = {
  systemId: SystemId;
  ok: boolean;
  message: string;
  // Playwright storageState（cookies/localStorage）を JSON で返す
  storageStateJson?: string;
};

function getTarget(systemId: SystemId) {
  const t = MONITORING_AUTH_TARGETS.find((x) => x.systemId === systemId);
  if (!t) throw new Error(`Unknown systemId: ${systemId}`);
  return t;
}

async function getCredential(userId: string, systemId: SystemId) {
  const row = await prisma.monitoringCredential.findFirst({
    where: { userId, systemId },
    select: { loginId: true, encryptedPassword: true, updatedAt: true },
  });
  if (!row) return null;
  return {
    loginId: row.loginId,
    password: decryptSecret(row.encryptedPassword),
    updatedAt: row.updatedAt,
  };
}

async function importPlaywright() {
  // 本番（Vercel）は devDependencies が入らないことがあるため playwright-core を使う
  // Next の webpack が playwright-core を丸ごとバンドルすると失敗するので next.config で外部化する
  return await import("playwright-core");
}

async function tryFill(page: any, selector: string, value: string) {
  try {
    const loc = page.locator(selector);
    await loc.first().waitFor({ state: "visible", timeout: 5000 });
    await loc.first().fill(value);
    return true;
  } catch {
    return false;
  }
}

async function tryClick(page: any, selector: string) {
  try {
    const loc = page.locator(selector);
    await loc.first().waitFor({ state: "visible", timeout: 5000 });
    await loc.first().click();
    return true;
  } catch {
    return false;
  }
}

async function waitAny(page: any, selectors: string[], timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const sel of selectors) {
      try {
        if (await page.locator(sel).first().isVisible()) return sel;
      } catch {
        // ignore
      }
    }
    await page.waitForTimeout(250);
  }
  return null;
}

// -------------------------
// Site-specific login flows
// -------------------------

/** 複数セレクタを順に試し、最初に成功したもので fill する。1つでも成功すれば true */
async function tryFillWithSelectors(
  page: any,
  selectors: string[],
  value: string
): Promise<boolean> {
  for (const sel of selectors) {
    if (await tryFill(page, sel, value)) return true;
  }
  return false;
}

/** 複数セレクタを順に試し、最初に成功したもので click する。1つでも成功すれば true */
async function tryClickWithSelectors(page: any, selectors: string[]): Promise<boolean> {
  for (const sel of selectors) {
    if (await tryClick(page, sel)) return true;
  }
  return false;
}

async function loginEcoMegane(page: any, loginId: string, password: string, timeoutMs: number) {
  // エコめがね（self-consumption）のログインURLは monitoringSystemsAuth で定義
  const url = getTarget("eco-megane").url;
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // ログイン前のデバッグ用スクリーンショット
  const debugScreenshotPath = path.join(os.tmpdir(), "eco-megane-debug.png");
  try {
    await page.screenshot({ path: debugScreenshotPath, fullPage: true });
    logger.info("eco-megane login page screenshot saved", {
      extra: { path: debugScreenshotPath },
    });
  } catch (e) {
    logger.warn("eco-megane debug screenshot failed", { extra: { path: debugScreenshotPath } }, e);
  }

  // ログインID/メール欄: 正しいセレクタを最優先、その後は一般的な候補
  const idSelectors = [
    'input[name="mailaddress"]',
    "#mailaddress",
    'input[name="email"]',
    'input[name="username"]',
    'input[name="loginId"]',
    'input[type="email"]',
    'input[type="text"]',
    "#email",
    "#username",
    ".login-id input",
    ".username input",
    'form input[type="email"]',
    'form input[type="text"]',
  ];
  // パスワード欄: 正しいセレクタを最優先、その後は一般的な候補
  const pwSelectors = [
    'input[name="password"]',
    "#password",
    'input[name="pass"]',
    'input[type="password"]',
    "#pass",
    "#passwd",
    ".password input",
    'form input[type="password"]',
  ];
  // 送信ボタン: a.submit を最優先（button ではなく a タグ class="submit"）、その後は一般的な候補
  const submitSelectors = [
    "a.submit",
    'form[name="member_form"] button[type="submit"]',
    'form[name="member_form"] input[type="submit"]',
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("ログイン")',
    'button:has-text("Login")',
    'input[value="ログイン"]',
    ".login-btn",
    "#login-btn",
    'form button[type="submit"]',
    'form input[type="submit"]',
  ];

  const idOk = await tryFillWithSelectors(page, idSelectors, loginId);
  const pwOk = await tryFillWithSelectors(page, pwSelectors, password);

  if (!idOk || !pwOk) throw new Error("login form not found (eco-megane)");

  const submitOk = await tryClickWithSelectors(page, submitSelectors);
  if (!submitOk) throw new Error("login submit button not found (eco-megane)");

  // ログイン後に何かしらのメニューが出る/URL遷移するのを待つ
  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});
}

async function loginFusionSolar(page: any, loginId: string, password: string, timeoutMs: number) {
  await page.goto(getTarget("fusion-solar").url, { waitUntil: "domcontentloaded" });

  // FusionSolar はSPAで要素が遅れて出ることが多いため、collector実装相当の待機を行う
  const idSelCandidates: string[] = [
    "input#username",
    'input[name="username"]',
    'input[placeholder*="ユーザー" i]',
    'input[placeholder*="User" i]',
    'input[name*="user" i]',
    'input[type="text"]',
  ];
  const pwSelCandidates: string[] = ['input#value', 'input[name="password"]', 'input[type="password"]'];
  const loginBtnCandidates = [
    "#btn_outerverify",
    'button:has-text("ログイン")',
    'button:has-text("Login")',
    'button[type="submit"]',
  ];

  const formWaitMs = Math.min(timeoutMs, 45_000);
  const started = Date.now();
  let idFilled = false;
  let pwFilled = false;
  while (Date.now() - started < formWaitMs) {
    if (!idFilled) {
      for (const sel of idSelCandidates) {
        const loc = page.locator(sel).first();
        if ((await loc.count().catch(() => 0)) > 0 && (await loc.isVisible().catch(() => false))) {
          await loc.fill(loginId).catch(() => {});
          idFilled = true;
          break;
        }
      }
    }
    if (!pwFilled) {
      for (const sel of pwSelCandidates) {
        const loc = page.locator(sel).first();
        if ((await loc.count().catch(() => 0)) > 0 && (await loc.isVisible().catch(() => false))) {
          await loc.fill(password).catch(() => {});
          pwFilled = true;
          break;
        }
      }
    }
    if (idFilled && pwFilled) break;
    await page.waitForTimeout(250);
  }

  if (!idFilled) throw new Error("login id input not found (fusion-solar)");
  if (!pwFilled) throw new Error("password input not found (fusion-solar)");

  let clicked = false;
  for (const sel of loginBtnCandidates) {
    if (await tryClick(page, sel)) {
      clicked = true;
      break;
    }
  }
  if (!clicked) throw new Error("login submit button not found (fusion-solar)");

  const urlLooksLoggedIn = (hrefRaw: string) => {
    const href = hrefRaw.toLowerCase();
    if (href.includes("/unisso/login")) return false;
    if (href.includes("#/login")) return false;
    if (href.includes("/login") && href.includes("unisso")) return false;
    if (href.includes("/netecowebext/")) return true;
    if (href.includes("/pvmswebsite/")) return true;
    if (href.includes("/netecowebext/home")) return true;
    return false;
  };

  try {
    await page.waitForFunction(
      () => {
        const href = location.href;
        const lower = href.toLowerCase();
        if (lower.includes("/unisso/login")) return false;
        if (lower.includes("#/login")) return false;
        if (lower.includes("/login") && lower.includes("unisso")) return false;
        if (lower.includes("/netecowebext/")) return true;
        if (lower.includes("/pvmswebsite/")) return true;
        if (lower.includes("/netecowebext/home")) return true;
        return false;
      },
      { timeout: timeoutMs }
    );
  } catch {
    // URL監視だけでは取りこぼすことがあるため、ホームへ直接遷移して再判定
    const fallbackTargets = [
      "https://jp5.fusionsolar.huawei.com/netecowebext/home/index.html",
      "https://jp5.fusionsolar.huawei.com/pvmswebsite/assets/build/index.html#/view/home",
    ];
    let recovered = false;
    for (const target of fallbackTargets) {
      try {
        await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30_000 });
        const current = String(page.url() ?? "");
        if (urlLooksLoggedIn(current)) {
          recovered = true;
          break;
        }
        const hasLoginInput =
          (await page.locator("input#username").count().catch(() => 0)) > 0 &&
          (await page.locator("input#username").first().isVisible().catch(() => false));
        if (!hasLoginInput) {
          // ログイン入力欄が消えていればセッション有効とみなす
          recovered = true;
          break;
        }
      } catch {
        // try next
      }
    }
    if (!recovered) {
      throw new Error("fusion-solar login did not complete");
    }
  }
  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});
}

/** SMA Sunny Portal の実際のログイン画面（OpenID Connect） */
const SUNNY_PORTAL_LOGIN_URL =
  "https://login.sma.energy/auth/realms/SMA/protocol/openid-connect/auth?response_type=code&client_id=SunnyPortalClassic&client_secret=baa6d5fe-f905-4fb2-bc8e-8f218acc2835&redirect_uri=https%3a%2f%2fwww.sunnyportal.com%2fTemplates%2fStart.aspx&ui_locales=ja";

async function loginSunnyPortal(page: any, loginId: string, password: string, timeoutMs: number) {
  try {
    await page.goto(SUNNY_PORTAL_LOGIN_URL, { waitUntil: "domcontentloaded" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/ERR_INSUFFICIENT_RESOURCES/i.test(msg)) {
      // Vercel上で稀に出るため、短い待機後に1回だけリトライ
      await page.waitForTimeout(1200);
      await page.goto(SUNNY_PORTAL_LOGIN_URL, { waitUntil: "domcontentloaded" });
    } else {
      throw e;
    }
  }

  // デバッグ用スクリーンショット
  const debugScreenshotPath = path.join(os.tmpdir(), "sunny-portal-debug.png");
  try {
    await page.screenshot({ path: debugScreenshotPath, fullPage: true });
    logger.info("sunny-portal login page screenshot saved", {
      extra: { path: debugScreenshotPath },
    });
  } catch (e) {
    logger.warn("sunny-portal debug screenshot failed", { extra: { path: debugScreenshotPath } }, e);
  }

  // ログインID/ユーザー名欄: 幅広く試す
  const idSelectors = [
    'input[name="username"]',
    'input[id="username"]',
    'input[type="email"]',
    'input[name="email"]',
    'input[name="loginId"]',
    'input[type="text"]',
    'input[autocomplete="username"]',
    "#username",
    "#email",
    ".username input",
    "form input[name='username']",
    "form input[type='email']",
  ];
  // パスワード欄: 幅広く試す
  const pwSelectors = [
    'input[name="password"]',
    'input[id="password"]',
    'input[type="password"]',
    'input[autocomplete="current-password"]',
    "#password",
    ".password input",
    "form input[type='password']",
  ];
  // 送信ボタン
  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("ログイン")',
    'button:has-text("Login")',
    'button:has-text("サインイン")',
    ".login-btn",
    "#login",
    "form button[type='submit']",
    "form input[type='submit']",
  ];

  const idOk = await tryFillWithSelectors(page, idSelectors, loginId);
  if (!idOk) throw new Error("login id input not found (sunny-portal)");

  const pwOk = await tryFillWithSelectors(page, pwSelectors, password);
  if (!pwOk) throw new Error("password input not found (sunny-portal)");

  const submitOk = await tryClickWithSelectors(page, submitSelectors);
  if (!submitOk) throw new Error("login submit button not found (sunny-portal)");

  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});
}

async function loginGrandArch(page: any, loginId: string, password: string, timeoutMs: number) {
  await page.goto(getTarget("grand-arch").url, { waitUntil: "domcontentloaded" });

  const idCandidates = [
    'input[name="username"]',
    'input[name="loginId"]',
    'input[type="text"]',
  ];
  const pwCandidates = ['input[name="password"]', 'input[type="password"]'];
  const btnCandidates = ['button[type="submit"]', 'input[type="submit"]', 'button:has-text("ログイン")', 'button:has-text("Login")'];

  let ok = false;
  for (const sel of idCandidates) {
    if (await tryFill(page, sel, loginId)) {
      ok = true;
      break;
    }
  }
  if (!ok) throw new Error("login id input not found (grand-arch)");

  ok = false;
  for (const sel of pwCandidates) {
    if (await tryFill(page, sel, password)) {
      ok = true;
      break;
    }
  }
  if (!ok) throw new Error("password input not found (grand-arch)");

  for (const sel of btnCandidates) {
    if (await tryClick(page, sel)) break;
  }
  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});
}

async function loginSolarMonitorSF(page: any, loginId: string, password: string, timeoutMs: number) {
  await page.goto(getTarget("solar-monitor-sf").url, { waitUntil: "domcontentloaded" });

  const idCandidates = [
    'input[name*="user" i]',
    'input[name*="id" i]',
    'input[type="text"]',
  ];
  const pwCandidates = ['input[type="password"]'];
  const btnCandidates = ['button[type="submit"]', 'input[type="submit"]', 'button:has-text("ログイン")', 'button:has-text("Login")'];

  await waitAny(page, [...idCandidates, ...pwCandidates], Math.min(timeoutMs, 20000));

  let ok = false;
  for (const sel of idCandidates) {
    if (await tryFill(page, sel, loginId)) {
      ok = true;
      break;
    }
  }
  if (!ok) throw new Error("login id input not found (solar-monitor-sf)");

  ok = false;
  for (const sel of pwCandidates) {
    if (await tryFill(page, sel, password)) {
      ok = true;
      break;
    }
  }
  if (!ok) throw new Error("password input not found (solar-monitor-sf)");

  for (const sel of btnCandidates) {
    if (await tryClick(page, sel)) break;
  }
  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});
}

async function loginSolarMonitorSE(page: any, loginId: string, password: string, timeoutMs: number) {
  await page.goto(getTarget("solar-monitor-se").url, { waitUntil: "domcontentloaded" });

  const idCandidates = [
    'input[name*="user" i]',
    'input[name*="id" i]',
    'input[type="text"]',
  ];
  const pwCandidates = ['input[type="password"]'];
  const btnCandidates = ['button[type="submit"]', 'input[type="submit"]', 'button:has-text("ログイン")', 'button:has-text("Login")'];

  await waitAny(page, [...idCandidates, ...pwCandidates], Math.min(timeoutMs, 20000));

  let ok = false;
  for (const sel of idCandidates) {
    if (await tryFill(page, sel, loginId)) {
      ok = true;
      break;
    }
  }
  if (!ok) throw new Error("login id input not found (solar-monitor-se)");

  ok = false;
  for (const sel of pwCandidates) {
    if (await tryFill(page, sel, password)) {
      ok = true;
      break;
    }
  }
  if (!ok) throw new Error("password input not found (solar-monitor-se)");

  for (const sel of btnCandidates) {
    if (await tryClick(page, sel)) break;
  }
  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});
}

const LOGIN_FLOW: Record<SystemId, (page: any, loginId: string, password: string, timeoutMs: number) => Promise<void>> = {
  "eco-megane": loginEcoMegane,
  "fusion-solar": loginFusionSolar,
  "sunny-portal": loginSunnyPortal,
  "grand-arch": loginGrandArch,
  "solar-monitor-sf": loginSolarMonitorSF,
  "solar-monitor-se": loginSolarMonitorSE,
};

/**
 * 指定ユーザーの保存済み認証情報を使って、指定監視サイトへ自動ログインします。
 * 成功時は Playwright の storageState(JSON) を返します。
 *
 * 注意:
 * - 実サイトのログインフォームは変更され得るため、必要に応じて selector を調整してください。
 * - 実行環境に `playwright` のインストールが必要です。
 */
export async function autoLogin(
  userId: string,
  systemId: SystemId,
  opts: AutoLoginOptions = {}
): Promise<AutoLoginResult> {
  const target = getTarget(systemId);
  const timeoutMs = opts.timeoutMs ?? 60_000;

  const cred = await getCredential(userId, systemId);
  if (!cred) {
    return {
      systemId,
      ok: false,
      message: "認証情報が未登録です（/settings で登録してください）。",
    };
  }

  let browser: Awaited<ReturnType<typeof importPlaywright>>["chromium"] extends {
    launch: (...args: any[]) => Promise<infer B>;
  }
    ? B
    : any;
  try {
    browser = await launchChromiumForRuntime({
      headless: opts.headless ?? true,
      slowMoMs: opts.slowMoMs,
      extraArgs: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-setuid-sandbox"],
    });
  } catch (e) {
    logger.error("autoLogin chromium launch failed", { extra: { systemId }, userId }, e);
    const detail =
      e instanceof Error && typeof e.message === "string"
        ? e.message.replace(/\s+/g, " ").slice(0, 240)
        : "unknown";
    return {
      systemId,
      ok: false,
      message: `接続テスト実行環境の起動に失敗しました（Chromium の起動に失敗: ${detail}）。`,
    };
  }

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);

    logger.info("autoLogin start", {
      extra: { systemId, url: target.url },
      userId,
    });

    await LOGIN_FLOW[systemId](page, cred.loginId, cred.password, timeoutMs);

    // 最低限、ログイン失敗メッセージっぽい表示がないかをチェック（サイト依存）
    // ここではページが落ち着いたら OK とする。厳密判定は Step 2 で強化。
    const storageState = await context.storageState();

    return {
      systemId,
      ok: true,
      message: "ログイン処理を完了しました。",
      storageStateJson: JSON.stringify(storageState),
    };
  } catch (e) {
    logger.error("autoLogin failed", { extra: { systemId, url: target.url }, userId }, e);
    return {
      systemId,
      ok: false,
      message:
        e instanceof Error ? e.message : "ログインに失敗しました。",
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

