import { runSmaCollectorCookie } from "@/lib/smaCollectorCookie";
import { autoLogin } from "@/lib/autoLogin";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { saveSmaSessionFromStorageState } from "@/lib/monitoringSessionCache";
import { isVercelRuntime } from "@/lib/playwrightRuntime";

const SMA_COOKIE_ONLY_HINT =
  "本番（Vercel）の一括取得では SMA 自動ログインは行いません。/settings の「SMA Sunny Portal」で接続テスト（成功）を実行して Cookie を更新してから再試行してください。";

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

function buildRuntimeStorageStateJson(storageStateJson: string): string | null {
  try {
    const parsed = JSON.parse(storageStateJson) as {
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
      origins?: unknown[];
    };
    const cookies = Array.isArray(parsed.cookies) ? parsed.cookies : [];
    const sunnyPortalCookies = cookies.filter(
      (c) =>
        typeof c?.name === "string" &&
        typeof c?.value === "string" &&
        typeof c?.domain === "string" &&
        /sunnyportal\.com|sma\.energy/i.test(c.domain)
    );
    if (sunnyPortalCookies.length === 0) return null;
    const origins = Array.isArray(parsed.origins) ? parsed.origins : [];
    return JSON.stringify({
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
  } catch {
    return null;
  }
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
  endDate: string,
  options?: { allowAutoLogin?: boolean }
): Promise<{ ok: boolean; message: string; recordCount: number; errorCount: number }> {
  const start = parseYmdToUtcDate(startDate);
  const end = parseYmdToUtcDate(endDate);
  if (!start || !end) return { ok: false, message: "日付形式が不正です", recordCount: 0, errorCount: 0 };

  /** Vercel ではチャンクごとに autoLogin すると ERR_INSUFFICIENT_RESOURCES になりやすい */
  const allowAutoLogin = options?.allowAutoLogin ?? !isVercelRuntime();

  const cachedSession = await prisma.smaCookieCache.findFirst({
    where: { userId, expiresAt: { gt: new Date() } },
    select: { id: true, cookieJson: true },
  });

  const runtimeFromCache = (() => {
    if (!cachedSession?.cookieJson) return undefined;
    try {
      const parsed = JSON.parse(cachedSession.cookieJson) as { cookies?: unknown[] };
      if (parsed && Array.isArray(parsed.cookies) && parsed.cookies.length > 0) {
        return cachedSession.cookieJson;
      }
    } catch {
      // legacy array format
      try {
        const arr = JSON.parse(cachedSession.cookieJson) as unknown[];
        if (Array.isArray(arr) && arr.length > 0) return cachedSession.cookieJson;
      } catch {
        // ignore
      }
    }
    return undefined;
  })();

  if (!cachedSession && !allowAutoLogin) {
    return {
      ok: false,
      message: `SMA Cookie が未登録または期限切れです。${SMA_COOKIE_ONLY_HINT}`,
      recordCount: 0,
      errorCount: 0,
    };
  }

  let cookieAttempt: Awaited<ReturnType<typeof runSmaCollectorCookie>> | null = null;
  if (cachedSession) {
    cookieAttempt = await runSmaCollectorCookie(
      userId,
      startDate,
      endDate,
      runtimeFromCache
    );
    if (cookieAttempt.ok) {
      return cookieAttempt;
    }
    if (!allowAutoLogin || !shouldAttemptAutoLoginAfterCookieFailure(cookieAttempt.message)) {
      return {
        ...cookieAttempt,
        message: allowAutoLogin ? cookieAttempt.message : `${cookieAttempt.message}\n${SMA_COOKIE_ONLY_HINT}`,
      };
    }
    logger.warn("smaCollector: cached cookie run failed; attempting autoLogin refresh", {
      userId,
      extra: { message: cookieAttempt.message },
    });
  }

  if (!allowAutoLogin) {
    return {
      ok: false,
      message: SMA_COOKIE_ONLY_HINT,
      recordCount: cookieAttempt?.recordCount ?? 0,
      errorCount: cookieAttempt?.errorCount ?? 0,
    };
  }

  const loginResult = await autoLogin(userId, "sunny-portal", { headless: true });
  if (!loginResult.ok || !loginResult.storageStateJson) {
    logger.warn("smaCollector: autoLogin failed", {
      userId,
      extra: { message: loginResult.message },
    });
    if (!cachedSession) {
      return {
        ok: false,
        message:
          `SMA自動ログインに失敗しました。${loginResult.message} ` +
          `まず /settings で「SMA Sunny Portal（step 1）」のログインID・パスワードを保存してください。`,
        recordCount: 0,
        errorCount: 0,
      };
    }
    return (
      cookieAttempt ?? {
        ok: false,
        message: loginResult.message,
        recordCount: 0,
        errorCount: 0,
      }
    );
  }

  await saveSmaSessionFromStorageState(userId, loginResult.storageStateJson);

  const runtimeStorageStateJson = buildRuntimeStorageStateJson(loginResult.storageStateJson);
  if (!runtimeStorageStateJson) {
    logger.warn("smaCollector: no sunny portal cookies from autoLogin", { userId });
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

  const refreshed = await runSmaCollectorCookie(userId, startDate, endDate, runtimeStorageStateJson);
  if (refreshed.ok) {
    return refreshed;
  }

  return {
    ok: false,
    message:
      `${refreshed.message}\n` +
      (cookieAttempt && !cookieAttempt.ok
        ? `（更新前の Cookie 試行: ${cookieAttempt.message}）`
        : ""),
    recordCount: refreshed.recordCount,
    errorCount: refreshed.errorCount,
  };
}
