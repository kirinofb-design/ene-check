import { runSmaCollectorCookie } from "@/lib/smaCollectorCookie";
import { autoLogin } from "@/lib/autoLogin";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

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

  const hasFallbackCookie = await prisma.smaCookieCache.findFirst({
    where: { userId, expiresAt: { gt: new Date() } },
    select: { id: true },
  });

  const loginResult = await autoLogin(userId, "sunny-portal", { headless: true });
  if (!loginResult.ok || !loginResult.storageStateJson) {
    logger.warn("smaCollector: autoLogin failed, falling back to saved cookie", {
      userId,
      extra: { message: loginResult.message },
    });
    if (!hasFallbackCookie) {
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
    return await runSmaCollectorCookie(userId, startDate, endDate);
  }

  let runtimeCookieJson = "";
  try {
    const parsed = JSON.parse(loginResult.storageStateJson) as {
      cookies?: Array<{
        name?: string;
        value?: string;
        domain?: string;
        path?: string;
        secure?: boolean;
        httpOnly?: boolean;
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
    runtimeCookieJson = JSON.stringify(sunnyPortalCookies);
  } catch (e) {
    logger.warn("smaCollector: storageState parse failed, falling back to saved cookie", { userId }, e);
    return await runSmaCollectorCookie(userId, startDate, endDate);
  }

  if (!runtimeCookieJson || runtimeCookieJson === "[]") {
    logger.warn("smaCollector: no sunny portal cookies from autoLogin, falling back to saved cookie", { userId });
    if (!hasFallbackCookie) {
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

  return await runSmaCollectorCookie(userId, startDate, endDate, runtimeCookieJson);
}
