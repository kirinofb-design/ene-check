import { runSmaCollectorCookie } from "@/lib/smaCollectorCookie";
import { autoLogin } from "@/lib/autoLogin";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

/** Cookie 取得のみで直せそうな失敗ではないときは二重 Chromium（autoLogin）を避ける */
function shouldAttemptAutoLoginAfterCookieFailure(message: string): boolean {
  const m = message.toLowerCase();
  if (/日付形式が不正/.test(message)) return false;
  return (
    /cookie|認証|ログイン|sunny\s*portal|session|セッション|未登録|期限切れ|formslogin|再登録|www\.sunnyportal/.test(
      message
    ) ||
    /全発電所で取得に失敗/.test(message) ||
    /target closed|browser has been closed|err_insufficient|insufficient_resources|detached frame/i.test(message) ||
    m.includes("authentication") ||
    m.includes("unauthorized") ||
    m.includes("forbidden")
  );
}

function parseYmdToUtcDate(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export async function runSmaCollector(
  userId: string,
  startDate: string,
  endDate: string
): Promise<{ ok: boolean; message: string; recordCount: number; errorCount: number }> {
  const start = parseYmdToUtcDate(startDate);
  const end = parseYmdToUtcDate(endDate);
  if (!start || !end) return { ok: false, message: "日付形式が不正です", recordCount: 0, errorCount: 0 };

  const cachedSession = await prisma.smaCookieCache.findFirst({
    where: { userId, expiresAt: { gt: new Date() } },
    select: { id: true },
  });

  /**
   * Vercel では autoLogin（Playwright）+ Cookie 収集（Puppeteer）の連続起動で
   * ERR_INSUFFICIENT_RESOURCES / browser closed が出やすい。
   * DB の SmaCookieCache が有効なら、まず Cookie のみで収集し、認証系の失敗時だけ autoLogin で更新する。
   */
  let cookieAttempt: Awaited<ReturnType<typeof runSmaCollectorCookie>> | null = null;
  if (cachedSession) {
    cookieAttempt = await runSmaCollectorCookie(userId, startDate, endDate);
    if (cookieAttempt.ok) {
      return cookieAttempt;
    }
    if (!shouldAttemptAutoLoginAfterCookieFailure(cookieAttempt.message)) {
      return cookieAttempt;
    }
    logger.warn("smaCollector: cached cookie run failed; attempting autoLogin refresh", {
      userId,
      extra: { message: cookieAttempt.message },
    });
  }

  const loginResult = await autoLogin(userId, "sunny-portal", { headless: true });
  if (!loginResult.ok || !loginResult.storageStateJson) {
    logger.warn("smaCollector: autoLogin failed, falling back to saved cookie", {
      userId,
      extra: { message: loginResult.message },
    });
    if (!cachedSession) {
      return {
        ok: false,
        message:
          `SMA自動ログインに失敗しました。` +
          `${loginResult.message} ` +
          `まず /settings で「SMA Sunny Portal（step 1）」のログインID・パスワードを保存してください。`,
        recordCount: 0,
        errorCount: 0,
      };
    }
    return {
      ok: false,
      message:
        `SMA自動ログインに失敗しました。${loginResult.message}\n` +
        `（Cookie のみでの取得: ${cookieAttempt?.message ?? "不明"}）\n` +
        `/settings で Cookie 配列（JSON）の再登録、またはログイン ID・パスワードの保存を確認してください。`,
      recordCount: cookieAttempt?.recordCount ?? 0,
      errorCount: cookieAttempt?.errorCount ?? 0,
    };
  }

  let runtimeStorageStateJson = "";
  try {
    const parsed = JSON.parse(loginResult.storageStateJson) as {
      cookies?: Array<{
        name?: string;
        value?: string;
        domain?: string;
        path?: string;
        secure?: boolean;
        httpOnly?: boolean;
        sameSite?: "Strict" | "Lax" | "None";
        expires?: number;
      }>;
    };
    const cookies = Array.isArray(parsed.cookies) ? parsed.cookies : [];
    const sunnyPortalCookies = cookies.filter(
      (c) =>
        typeof c?.name === "string" &&
        typeof c?.value === "string" &&
        typeof c?.domain === "string" &&
        /sunnyportal\.com|sma\.energy/i.test(c.domain)
    );
    const origins = Array.isArray((parsed as { origins?: unknown[] }).origins)
      ? ((parsed as { origins?: unknown[] }).origins as unknown[])
      : [];
    runtimeStorageStateJson = JSON.stringify({
      cookies: sunnyPortalCookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
        expires: c.expires,
      })),
      origins,
    });
  } catch (e) {
    logger.warn("smaCollector: storageState parse failed, falling back to saved cookie", { userId }, e);
    return await runSmaCollectorCookie(userId, startDate, endDate);
  }

  if (!runtimeStorageStateJson || runtimeStorageStateJson === "[]") {
    logger.warn("smaCollector: no sunny portal cookies from autoLogin, falling back to saved cookie", { userId });
    if (!cachedSession) {
      return {
        ok: false,
        message:
          "SMA自動ログイン後に有効なセッションCookieを取得できませんでした。/settings でSMAログイン情報を再保存して再実行してください。",
        recordCount: 0,
        errorCount: 0,
      };
    }
    return await runSmaCollectorCookie(userId, startDate, endDate);
  }

  return await runSmaCollectorCookie(userId, startDate, endDate, runtimeStorageStateJson);
}
