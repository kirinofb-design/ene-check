import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { runEcoMeganeCollector } from "@/lib/ecoMeganeCollector";
import { runFusionSolarCollector } from "@/lib/fusionSolarCollector";
import { runSmaCollector } from "@/lib/smaCollector";
import { runLaplaceCollector } from "@/lib/laplaceCollector";
import { runSolarMonitorCollector } from "@/lib/solarMonitorCollector";
import { prewarmVercelChromiumExecutable } from "@/lib/playwrightRuntime";
import { acquireCollectorLock, isCollectorCancelRequested, releaseCollectorLock } from "@/lib/collectorLock";
import { applyForcedZeroOverrides, parseYmdToUtcDate } from "@/lib/forcedZeroRules";
import { ensureDbReachable } from "@/lib/ensureDbReachable";

/** Cron 実行上限（Vercel） */
export const maxDuration = 300;

type CollectorStepResult = {
  key: string;
  ok: boolean;
  message: string;
  recordCount: number;
  errorCount: number;
};

function looksLikeTransientCollectorError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("err_insufficient_resources") ||
    m.includes("less than 64mb free space in temporary directory") ||
    m.includes("discardable_shared_memory_manager.cc") ||
    m.includes("detached frame") ||
    m.includes("execution context was destroyed") ||
    m.includes("target page, context or browser has been closed") ||
    m.includes("browsercontext.newpage") ||
    m.includes("ラプラス: サービス一覧で「l・eye総合監視」の開くボタンが見つかりません。")
  );
}

async function runCollectorWithRetry(
  key: string,
  runner: () => Promise<CollectorStepResult>
): Promise<CollectorStepResult> {
  const maxAttempts = 3;
  let last: CollectorStepResult | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await runner();
    if (result.ok) return result;
    last = result;
    if (!looksLikeTransientCollectorError(result.message)) return result;
    if (attempt >= maxAttempts) break;
    const waitMs =
      key === "laplace" || key === "solar-monitor-sf" || key === "solar-monitor-se"
        ? attempt === 1
          ? 4000
          : 8000
        : attempt === 1
          ? 1500
          : 3500;
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return {
    ...(last ?? { key, ok: false, message: "collector failed", recordCount: 0, errorCount: 0 }),
    message: `${last?.message ?? "collector failed"}（再試行後も失敗）`,
  };
}

function isAuthorizedByCronSecret(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const authHeader = request.headers.get("authorization") ?? "";
  return authHeader === `Bearer ${cronSecret}`;
}

function toJstDateParts(date: Date): { year: number; month: number; day: number } {
  const jstMs = date.getTime() + 9 * 60 * 60 * 1000;
  const jst = new Date(jstMs);
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
    day: jst.getUTCDate(),
  };
}

function getStartAndEndDateJst(): { startDate: string; endDate: string } {
  const now = new Date();
  const today = toJstDateParts(now);

  // JST基準の前日
  const yesterdayUtc = new Date(Date.UTC(today.year, today.month - 1, today.day - 1, 0, 0, 0, 0));
  const y = yesterdayUtc.getUTCFullYear();
  const m = yesterdayUtc.getUTCMonth() + 1;
  const d = yesterdayUtc.getUTCDate();

  const startDate = `${y}-${String(m).padStart(2, "0")}-01`;
  const endDate = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { startDate, endDate };
}

async function resolveCronUserId(): Promise<string | null> {
  const byId = process.env.CRON_COLLECT_USER_ID?.trim();
  if (byId) return byId;

  const byEmail = process.env.CRON_COLLECT_USER_EMAIL?.trim();
  if (byEmail) {
    const user = await prisma.user.findUnique({
      where: { email: byEmail },
      select: { id: true },
    });
    if (user?.id) return user.id;
  }

  // フォールバック: 監視システム認証が登録済みユーザーを1人選ぶ
  const cred = await prisma.monitoringCredential.findFirst({
    select: { userId: true },
    orderBy: { createdAt: "asc" },
  });
  return cred?.userId ?? null;
}

async function applyPostCollectOverrides(startDate: string, endDate: string): Promise<void> {
  const reqStart = parseYmdToUtcDate(startDate);
  const reqEnd = parseYmdToUtcDate(endDate);
  if (!reqStart || !reqEnd) return;
  await applyForcedZeroOverrides(prisma, reqStart, reqEnd, "laplace");
}

async function runNamedCollector(
  key: string,
  runner: () => Promise<{ ok: boolean; message: string; recordCount: number; errorCount: number }>
): Promise<CollectorStepResult> {
  try {
    const result = await runner();
    return { key, ...result };
  } catch (e) {
    return {
      key,
      ok: false,
      message: e instanceof Error ? e.message : "コレクター実行に失敗しました。",
      recordCount: 0,
      errorCount: 0,
    };
  }
}

async function runSolarMonitorStep(
  userId: string,
  startDate: string,
  endDate: string,
  key: "solar-monitor-sf" | "solar-monitor-se",
  message: string
): Promise<CollectorStepResult> {
  try {
    const result = await runSolarMonitorCollector(userId, startDate, endDate, key);
    return { key, ok: true, message, ...result };
  } catch (e) {
    return {
      key,
      ok: false,
      message: e instanceof Error ? e.message : "コレクター実行に失敗しました。",
      recordCount: 0,
      errorCount: 0,
    };
  }
}

export async function GET(request: Request) {
  if (!isAuthorizedByCronSecret(request)) {
    return NextResponse.json(
      { ok: false, message: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  const userId = await resolveCronUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, message: "Cron実行ユーザーを特定できません。CRON_COLLECT_USER_ID または CRON_COLLECT_USER_EMAIL を設定してください。" },
      { status: 400 }
    );
  }

  const { startDate, endDate } = getStartAndEndDateJst();
  if (startDate > endDate) {
    return NextResponse.json({
      ok: true,
      message: `実行対象なし（startDate=${startDate}, endDate=${endDate}）。`,
      recordCount: 0,
      errorCount: 0,
      steps: [],
    });
  }

  try {
    await ensureDbReachable(3);
  } catch {
    return NextResponse.json(
      { ok: false, message: "データベース接続に失敗しました。", recordCount: 0, errorCount: 0, steps: [] },
      { status: 503 }
    );
  }

  logger.info("cron collect start", {
    userId,
    extra: { startDate, endDate },
  });

  const lock = acquireCollectorLock(userId, "all");
  if (!lock.ok) {
    return NextResponse.json(
      { ok: false, message: lock.message, recordCount: 0, errorCount: 0, steps: [] },
      { status: 409 }
    );
  }

  let steps: CollectorStepResult[] = [];
  let cancelled = false;
  try {
    if (isCollectorCancelRequested(userId, "all")) {
      return NextResponse.json({
        ok: false,
        message: "実行取消が指定されていたため、Cronの全データ取得を開始しませんでした。",
        recordCount: 0,
        errorCount: 0,
        steps: [],
      });
    }

    await prewarmVercelChromiumExecutable();
    const runners: Array<{ key: string; run: () => Promise<CollectorStepResult> }> = [
      { key: "eco-megane", run: () => runNamedCollector("eco-megane", () => runEcoMeganeCollector(userId, startDate, endDate)) },
      { key: "sma", run: () => runNamedCollector("sma", () => runSmaCollector(userId, startDate, endDate)) },
      { key: "fusion-solar", run: () => runNamedCollector("fusion-solar", () => runFusionSolarCollector(userId, startDate, endDate)) },
      { key: "laplace", run: () => runNamedCollector("laplace", () => runLaplaceCollector(userId, startDate, endDate)) },
      {
        key: "solar-monitor-sf",
        run: () =>
          runSolarMonitorStep(
            userId,
            startDate,
            endDate,
            "solar-monitor-sf",
            "Solar Monitor（池新田・本社）データ取得が完了しました。"
          ),
      },
      {
        key: "solar-monitor-se",
        run: () =>
          runSolarMonitorStep(
            userId,
            startDate,
            endDate,
            "solar-monitor-se",
            "Solar Monitor（須山）データ取得が完了しました。"
          ),
      },
    ];
    steps = [];
    for (const runner of runners) {
      if (isCollectorCancelRequested(userId, "all")) {
        cancelled = true;
        break;
      }
      const step = await runCollectorWithRetry(runner.key, runner.run);
      steps.push(step);
      await new Promise((r) => setTimeout(r, 1000));
    }

    cancelled = isCollectorCancelRequested(userId, "all");
    if (!cancelled) {
      await applyPostCollectOverrides(startDate, endDate);
    }
  } finally {
    releaseCollectorLock(userId, "all");
  }

  const recordCount = steps.reduce((sum, s) => sum + s.recordCount, 0);
  const errorCount = steps.reduce((sum, s) => sum + s.errorCount, 0);
  const allOk = steps.every((s) => s.ok);

  logger.info("cron collect finished", {
    userId,
    extra: { startDate, endDate, recordCount, errorCount, allOk, cancelled },
  });

  return NextResponse.json({
    ok: cancelled ? false : allOk,
    message: cancelled
      ? `Cron実行を取消しました（保存: ${recordCount}件 / スキップ: ${errorCount}件）。`
      : `Cronの全データ取得が完了しました（保存: ${recordCount}件 / スキップ: ${errorCount}件）。`,
    startDate,
    endDate,
    recordCount,
    errorCount,
    steps,
  });
}
