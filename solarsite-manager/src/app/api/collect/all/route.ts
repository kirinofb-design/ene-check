import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** Vercel 等の上限を超えないよう長めに（ローカルでは無視されることが多い） */
export const maxDuration = 300;
import { handleApiError } from "@/lib/apiError";
import { runEcoMeganeCollector } from "@/lib/ecoMeganeCollector";
import { runFusionSolarCollector } from "@/lib/fusionSolarCollector";
import { runSmaCollector } from "@/lib/smaCollector";
import { runLaplaceCollector } from "@/lib/laplaceCollector";
import { runSolarMonitorCollector } from "@/lib/solarMonitorCollector";
import {
  acquireCollectorLock,
  appendAllCollectStepResult,
  initializeAllCollectProgress,
  isCollectorCancelRequested,
  markAllCollectStepStarted,
  releaseCollectorLock,
} from "@/lib/collectorLock";
import { prewarmVercelChromiumExecutable } from "@/lib/playwrightRuntime";
import { ensureDbReachable } from "@/lib/ensureDbReachable";
import { applyForcedZeroOverrides, parseYmdToUtcDate } from "@/lib/forcedZeroRules";

type CollectorStepResult = {
  key: string;
  ok: boolean;
  message: string;
  recordCount: number;
  errorCount: number;
};

function diffDaysInclusive(startDate: string, endDate: string): number {
  const s = Date.parse(`${startDate}T00:00:00.000Z`);
  const e = Date.parse(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return 0;
  return Math.floor((e - s) / (24 * 60 * 60 * 1000)) + 1;
}

async function applyPostCollectOverrides(startDate: string, endDate: string): Promise<void> {
  const reqStart = parseYmdToUtcDate(startDate);
  const reqEnd = parseYmdToUtcDate(endDate);
  if (!reqStart || !reqEnd) return;
  // 並列収集で他システムに上書きされても、停止中サイトの 0 ルールを最後に適用する。
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

export async function POST(request: Request) {
  try {
    const session = await requireAuth(request);
    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "ログインが必要です。" } },
        { status: 401 }
      );
    }

    const body = (await request.json()) as {
      startDate?: string;
      endDate?: string;
    };
    const startDate = typeof body?.startDate === "string" ? body.startDate : "";
    const endDate = typeof body?.endDate === "string" ? body.endDate : "";

    try {
      await ensureDbReachable(3);
    } catch {
      return NextResponse.json(
        {
          ok: false,
          message: "データベース接続に失敗しました。数秒待ってから再実行してください。",
          recordCount: 0,
          errorCount: 0,
          steps: [],
        },
        { status: 503 }
      );
    }

    const runSolarMonitorStep = async (
      key: "solar-monitor-sf" | "solar-monitor-se",
      successMessage: string
    ): Promise<CollectorStepResult> => {
      try {
        const result = await runSolarMonitorCollector(userId, startDate, endDate, key);
        return { key, ok: true, message: successMessage, ...result };
      } catch (e) {
        return {
          key,
          ok: false,
          message: e instanceof Error ? e.message : "コレクター実行に失敗しました。",
          recordCount: 0,
          errorCount: 0,
        };
      }
    };

    const lock = acquireCollectorLock(userId, "all");
    if (!lock.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: lock.message,
          recordCount: 0,
          errorCount: 0,
          steps: [],
        },
        { status: 409 }
      );
    }

    let steps: CollectorStepResult[];
    let cancelled = false;
    try {
      if (isCollectorCancelRequested(userId, "all")) {
        return NextResponse.json({
          ok: false,
          message: "実行取消を受け付けたため、全データ一括取得を開始しませんでした。",
          recordCount: 0,
          errorCount: 0,
          steps: [],
        });
      }
      // Vercel では複数コレクターが同時に Chromium を起動すると /tmp 配下の実行ファイル競合で
      // `spawn ETXTBSY` が起きることがあるため、起動前に一度だけ解決しておく。
      await prewarmVercelChromiumExecutable();
      // 同時実行の高負荷を避けるため、6システムを順次実行する。
      const requestDays = diffDaysInclusive(startDate, endDate);
      const fusionBudgetMs =
        process.env.NODE_ENV === "production"
          ? requestDays > 7
            ? 90_000
            : requestDays > 3
              ? 120_000
              : 150_000
          : undefined;

      const runners: Array<{
        key: string;
        run: () => Promise<CollectorStepResult>;
      }> = [
        { key: "eco-megane", run: () => runNamedCollector("eco-megane", () => runEcoMeganeCollector(userId, startDate, endDate)) },
        {
          key: "fusion-solar",
          run: () =>
            runNamedCollector("fusion-solar", () =>
              runFusionSolarCollector(userId, startDate, endDate, { wallBudgetMs: fusionBudgetMs })
            ),
        },
        { key: "sma", run: () => runNamedCollector("sma", () => runSmaCollector(userId, startDate, endDate)) },
        { key: "laplace", run: () => runNamedCollector("laplace", () => runLaplaceCollector(userId, startDate, endDate)) },
        {
          key: "solar-monitor-sf",
          run: () => runSolarMonitorStep("solar-monitor-sf", "Solar Monitor（池新田・本社）データ取得が完了しました。"),
        },
        {
          key: "solar-monitor-se",
          run: () => runSolarMonitorStep("solar-monitor-se", "Solar Monitor（須山）データ取得が完了しました。"),
        },
      ];
      initializeAllCollectProgress(userId, runners.length);
      steps = [];
      for (const runner of runners) {
        if (isCollectorCancelRequested(userId, "all")) {
          cancelled = true;
          break;
        }
        markAllCollectStepStarted(userId, runner.key);
        const stepResult = await runner.run();
        steps.push(stepResult);
        appendAllCollectStepResult(userId, stepResult);
      }

      cancelled = cancelled || isCollectorCancelRequested(userId, "all");
      if (!cancelled) {
        await applyPostCollectOverrides(startDate, endDate);
      }
    } finally {
      releaseCollectorLock(userId, "all");
    }

    const recordCount = steps.reduce((sum, s) => sum + s.recordCount, 0);
    const errorCount = steps.reduce((sum, s) => sum + s.errorCount, 0);

    const allOk = steps.every((s) => s.ok);
    const statusWord = allOk ? "完了" : "一部失敗";

    return NextResponse.json({
      ok: cancelled ? false : allOk,
      message: cancelled
        ? `実行取消を受け付けました（保存: ${recordCount}件 / スキップ: ${errorCount}件）。`
        : `全コレクター実行が${statusWord}しました（保存: ${recordCount}件 / スキップ: ${errorCount}件）。`,
      recordCount,
      errorCount,
      steps,
    });
  } catch (e) {
    return handleApiError(request, e);
  }
}
