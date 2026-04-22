import { NextResponse } from "next/server";
import { acquireCollectorLock, releaseCollectorLock, type CollectorKind } from "@/lib/collectorLock";
import { ensureDbReachable } from "@/lib/ensureDbReachable";
import { runEcoMeganeCollector } from "@/lib/ecoMeganeCollector";
import { runFusionSolarCollector } from "@/lib/fusionSolarCollector";
import { runLaplaceCollector } from "@/lib/laplaceCollector";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { runSmaCollector } from "@/lib/smaCollector";
import { runSolarMonitorCollector } from "@/lib/solarMonitorCollector";
import { applyForcedZeroOverrides, parseYmdToUtcDate } from "@/lib/forcedZeroRules";
import { getStartAndEndDateJstMonthToYesterday, isAuthorizedByCronSecret, resolveCronUserId } from "@/lib/cronCollect";

export const maxDuration = 300;

type CronSystem =
  | "eco-megane"
  | "fusion-solar"
  | "sma"
  | "laplace"
  | "solar-monitor-sf"
  | "solar-monitor-se";

type CollectResult = { ok: boolean; message: string; recordCount: number; errorCount: number };

const SYSTEMS: Record<
  CronSystem,
  { kind: CollectorKind; run: (userId: string, startDate: string, endDate: string) => Promise<CollectResult> }
> = {
  "eco-megane": {
    kind: "eco-megane",
    run: runEcoMeganeCollector,
  },
  "fusion-solar": {
    kind: "fusion-solar",
    run: runFusionSolarCollector,
  },
  sma: {
    kind: "sma",
    run: runSmaCollector,
  },
  laplace: {
    kind: "laplace",
    run: runLaplaceCollector,
  },
  "solar-monitor-sf": {
    kind: "solar-monitor-sf",
    run: async (userId, startDate, endDate) => {
      try {
        const r = await runSolarMonitorCollector(userId, startDate, endDate, "solar-monitor-sf");
        return {
          ok: true,
          message: `Solar Monitor（池新田・本社）取得完了（保存: ${r.recordCount}件 / スキップ: ${r.errorCount}件）。`,
          recordCount: r.recordCount,
          errorCount: r.errorCount,
        };
      } catch (e) {
        return {
          ok: false,
          message: e instanceof Error ? e.message : "Solar Monitor（池新田・本社）収集に失敗しました。",
          recordCount: 0,
          errorCount: 0,
        };
      }
    },
  },
  "solar-monitor-se": {
    kind: "solar-monitor-se",
    run: async (userId, startDate, endDate) => {
      try {
        const r = await runSolarMonitorCollector(userId, startDate, endDate, "solar-monitor-se");
        return {
          ok: true,
          message: `Solar Monitor（須山）取得完了（保存: ${r.recordCount}件 / スキップ: ${r.errorCount}件）。`,
          recordCount: r.recordCount,
          errorCount: r.errorCount,
        };
      } catch (e) {
        return {
          ok: false,
          message: e instanceof Error ? e.message : "Solar Monitor（須山）収集に失敗しました。",
          recordCount: 0,
          errorCount: 0,
        };
      }
    },
  },
};

function asCronSystem(v: string): CronSystem | null {
  return v in SYSTEMS ? (v as CronSystem) : null;
}

async function applyPostCollectOverridesIfNeeded(system: CronSystem, startDate: string, endDate: string): Promise<void> {
  if (system !== "laplace") return;
  const reqStart = parseYmdToUtcDate(startDate);
  const reqEnd = parseYmdToUtcDate(endDate);
  if (!reqStart || !reqEnd) return;
  await applyForcedZeroOverrides(prisma, reqStart, reqEnd, "laplace");
}

export async function GET(
  request: Request,
  context: { params: { system: string } }
) {
  if (!isAuthorizedByCronSecret(request)) {
    return NextResponse.json({ ok: false, message: "UNAUTHORIZED" }, { status: 401 });
  }

  const system = asCronSystem(context.params.system);
  if (!system) {
    return NextResponse.json({ ok: false, message: "UNKNOWN_SYSTEM" }, { status: 404 });
  }

  const userId = await resolveCronUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, message: "Cron実行ユーザーを特定できません。CRON_COLLECT_USER_ID または CRON_COLLECT_USER_EMAIL を設定してください。" },
      { status: 400 }
    );
  }

  try {
    await ensureDbReachable(3);
  } catch {
    return NextResponse.json(
      { ok: false, message: "データベース接続に失敗しました。", recordCount: 0, errorCount: 0 },
      { status: 503 }
    );
  }

  const { startDate, endDate } = getStartAndEndDateJstMonthToYesterday();
  if (startDate > endDate) {
    return NextResponse.json({
      ok: true,
      message: `実行対象なし（system=${system}, startDate=${startDate}, endDate=${endDate}）。`,
      startDate,
      endDate,
      recordCount: 0,
      errorCount: 0,
    });
  }

  const runner = SYSTEMS[system];
  const lock = acquireCollectorLock(userId, runner.kind);
  if (!lock.ok) {
    return NextResponse.json(
      {
        ok: false,
        message: lock.message,
        system,
        startDate,
        endDate,
        recordCount: 0,
        errorCount: 0,
      },
      { status: 409 }
    );
  }

  let result: CollectResult;
  try {
    logger.info("cron collect system started", {
      userId,
      extra: { system, startDate, endDate },
    });
    result = await runner.run(userId, startDate, endDate);
    if (result.ok) {
      await applyPostCollectOverridesIfNeeded(system, startDate, endDate);
    }
  } finally {
    releaseCollectorLock(userId, runner.kind);
  }

  logger.info("cron collect system finished", {
    userId,
    extra: {
      system,
      startDate,
      endDate,
      ok: result.ok,
      recordCount: result.recordCount,
      errorCount: result.errorCount,
      message: result.message,
    },
  });

  return NextResponse.json({
    ok: result.ok,
    message: result.message,
    system,
    startDate,
    endDate,
    recordCount: result.recordCount,
    errorCount: result.errorCount,
  });
}
