import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export type MonitoringSessionSystemId = "fusion-solar" | "sunny-portal";

/** 接続テスト・収集後のセッション再利用（本番で日をまたいでも切れにくくする） */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function parseStorageStateCookies(sessionJson: string): number {
  try {
    const parsed = JSON.parse(sessionJson) as { cookies?: unknown[] };
    return Array.isArray(parsed?.cookies) ? parsed.cookies.length : 0;
  } catch {
    return 0;
  }
}

/** Playwright storageState JSON を DB に保存（autoLogin 成功後に次回 Chromium 起動を減らす） */
export async function saveMonitoringSession(
  userId: string,
  systemId: MonitoringSessionSystemId,
  sessionJson: string,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<void> {
  const trimmed = sessionJson.trim();
  if (!trimmed || trimmed === "[]") return;
  if (parseStorageStateCookies(trimmed) === 0 && !trimmed.includes("cookies")) return;

  const expiresAt = new Date(Date.now() + ttlMs);
  try {
    await prisma.monitoringSessionCache.upsert({
      where: { userId_systemId: { userId, systemId } },
      create: { userId, systemId, sessionJson: trimmed, expiresAt },
      update: { sessionJson: trimmed, expiresAt },
    });
    logger.info("monitoringSessionCache: saved", { userId, extra: { systemId, expiresAt: expiresAt.toISOString() } });
  } catch (e) {
    logger.warn("monitoringSessionCache: save failed", {
      userId,
      extra: { systemId, error: e instanceof Error ? e.message : String(e) },
    });
  }
}

export async function loadMonitoringSession(
  userId: string,
  systemId: MonitoringSessionSystemId
): Promise<string | null> {
  try {
    const row = await prisma.monitoringSessionCache.findUnique({
      where: { userId_systemId: { userId, systemId } },
      select: { sessionJson: true, expiresAt: true },
    });
    if (!row || row.expiresAt.getTime() <= Date.now()) return null;
    if (parseStorageStateCookies(row.sessionJson) === 0) return null;
    return row.sessionJson;
  } catch (e) {
    // テーブル未作成・接続不調でもコレクター全体を落とさず autoLogin にフォールバック
    logger.warn("monitoringSessionCache: load failed (fallback to autoLogin)", {
      userId,
      extra: { systemId, error: e instanceof Error ? e.message : String(e) },
    });
    return null;
  }
}

/** 期限切れ・無効セッションを削除（login loop 時に再ログインさせる） */
export async function clearMonitoringSession(
  userId: string,
  systemId: MonitoringSessionSystemId
): Promise<void> {
  try {
    await prisma.monitoringSessionCache.deleteMany({
      where: { userId, systemId },
    });
    logger.info("monitoringSessionCache: cleared", { userId, extra: { systemId } });
  } catch (e) {
    logger.warn("monitoringSessionCache: clear failed", {
      userId,
      extra: { systemId, error: e instanceof Error ? e.message : String(e) },
    });
  }
}

function cookieJsonToRuntimeString(cookieJson: string): string | undefined {
  try {
    const parsed = JSON.parse(cookieJson) as { cookies?: unknown[] };
    if (parsed && Array.isArray(parsed.cookies) && parsed.cookies.length > 0) {
      return cookieJson;
    }
  } catch {
    // legacy array
  }
  try {
    const arr = JSON.parse(cookieJson) as unknown[];
    if (Array.isArray(arr) && arr.length > 0) return cookieJson;
  } catch {
    // ignore
  }
  return undefined;
}

/** SMA 用 Cookie（SmaCookieCache → MonitoringSessionCache の順で解決） */
export async function resolveSmaCookieJsonForUser(userId: string): Promise<string | undefined> {
  const row = await prisma.smaCookieCache.findFirst({
    where: { userId, expiresAt: { gt: new Date() } },
    select: { cookieJson: true },
  });
  if (row?.cookieJson) {
    const runtime = cookieJsonToRuntimeString(row.cookieJson);
    if (runtime) return runtime;
  }
  const fromMonitoring = await loadMonitoringSession(userId, "sunny-portal");
  if (fromMonitoring) {
    const runtime = cookieJsonToRuntimeString(fromMonitoring);
    if (runtime) return runtime;
  }
  return undefined;
}

/** SMA は既存 SmaCookieCache を storageState 形式でも保存 */
export async function saveSmaSessionFromStorageState(userId: string, storageStateJson: string): Promise<void> {
  const trimmed = storageStateJson.trim();
  if (!trimmed) return;

  let cookieJson = trimmed;
  try {
    const parsed = JSON.parse(trimmed) as { cookies?: unknown[] };
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.cookies)) {
      const sunny = parsed.cookies.filter((c: unknown) => {
        if (!c || typeof c !== "object") return false;
        const domain = (c as { domain?: string }).domain ?? "";
        return /sunnyportal\.com|sma\.energy/i.test(domain);
      });
      if (sunny.length === 0) return;
      const origins = Array.isArray((parsed as { origins?: unknown }).origins)
        ? (parsed as { origins?: unknown }).origins
        : [];
      cookieJson = JSON.stringify({ cookies: sunny, origins });
    }
  } catch {
    return;
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const smaCookieCache = prisma.smaCookieCache as {
    upsert: (args: unknown) => Promise<unknown>;
  };
  try {
    await smaCookieCache.upsert({
      where: { userId },
      create: { userId, cookieJson, expiresAt },
      update: { cookieJson, expiresAt },
    });
    logger.info("monitoringSessionCache: sma cookie cache updated from storageState", { userId });
    await saveMonitoringSession(userId, "sunny-portal", cookieJson).catch(() => {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("userId_plantName") && !message.includes("SmaCookieCacheWhereUniqueInput")) {
      logger.warn("monitoringSessionCache: sma upsert failed", { userId, extra: { message } });
      return;
    }
    await smaCookieCache.upsert({
      where: { userId_plantName: { userId, plantName: "" } },
      create: { userId, plantName: "", cookieJson, expiresAt },
      update: { cookieJson, expiresAt },
    });
    await saveMonitoringSession(userId, "sunny-portal", cookieJson).catch(() => {});
  }
}
