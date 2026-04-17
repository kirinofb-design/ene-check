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
import { acquireCollectorLock, isCollectorCancelRequested, releaseCollectorLock } from "@/lib/collectorLock";
import { prewarmVercelChromiumExecutable } from "@/lib/playwrightRuntime";

type CollectorStepResult = {
  key: string;
  ok: boolean;
  message: string;
  recordCount: number;
  errorCount: number;
};

function parseYmdToUtcDate(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0));
}

async function applyPostCollectOverrides(startDate: string, endDate: string): Promise<void> {
  // 並列収集で他システムに上書きされても、停止中サイトの 0 ルールを最後に適用する。
  const from = parseYmdToUtcDate("2026-04-01");
  const to = parseYmdToUtcDate("2026-04-14");
  const reqStart = parseYmdToUtcDate(startDate);
  const reqEnd = parseYmdToUtcDate(endDate);
  if (!from || !to || !reqStart || !reqEnd) return;

  const rangeStart = new Date(Math.max(reqStart.getTime(), from.getTime()));
  const rangeEnd = new Date(Math.min(reqEnd.getTime(), to.getTime()));
  if (rangeStart.getTime() > rangeEnd.getTime()) return;

  const site = await prisma.site.findFirst({
    where: { siteName: "落居（笠名高圧）" },
    select: { id: true },
  });
  if (!site) return;

  const ops: Array<ReturnType<typeof prisma.dailyGeneration.upsert>> = [];
  const cur = new Date(rangeStart);
  while (cur.getTime() <= rangeEnd.getTime()) {
    const day = new Date(cur);
    ops.push(
      prisma.dailyGeneration.upsert({
        where: { siteId_date: { siteId: site.id, date: day } },
        create: { siteId: site.id, date: day, generation: 0, status: "laplace" },
        update: { generation: 0, status: "laplace", updatedAt: new Date() },
      })
    );
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  if (ops.length > 0) {
    await prisma.$transaction(ops);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureDbReachable(retries = 3): Promise<void> {
  let lastError: unknown = null;
  for (let i = 0; i < retries; i++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (e) {
      lastError = e;
      if (i < retries - 1) {
        await sleep(1200 * (i + 1));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Database unreachable");
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
      // 6 システムを同時起動（所要時間の短縮）。SQLite では同時書き込みでロックが出ることがある。
      steps = await Promise.all([
        runNamedCollector("eco-megane", () => runEcoMeganeCollector(userId, startDate, endDate)),
        runNamedCollector("fusion-solar", () => runFusionSolarCollector(userId, startDate, endDate)),
        runNamedCollector("sma", () => runSmaCollector(userId, startDate, endDate)),
        runNamedCollector("laplace", () => runLaplaceCollector(userId, startDate, endDate)),
        runSolarMonitorStep("solar-monitor-sf", "Solar Monitor（池新田・本社）データ取得が完了しました。"),
        runSolarMonitorStep("solar-monitor-se", "Solar Monitor（須山）データ取得が完了しました。"),
      ]);

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
