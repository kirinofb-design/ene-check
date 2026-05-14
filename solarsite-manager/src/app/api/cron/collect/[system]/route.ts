import { NextResponse } from "next/server";
import { acquireCollectorLock, releaseCollectorLock, type CollectorKind } from "@/lib/collectorLock";
import { ensureDbReachable } from "@/lib/ensureDbReachable";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
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

async function runBySystem(system: CronSystem, userId: string, startDate: string, endDate: string): Promise<CollectResult> {
  switch (system) {
    case "eco-megane": {
      const { runEcoMeganeCollector } = await import("@/lib/ecoMeganeCollector");
      return runEcoMeganeCollector(userId, startDate, endDate);
    }
    case "fusion-solar": {
      const { runFusionSolarCollector } = await import("@/lib/fusionSolarCollector");
      return runFusionSolarCollector(userId, startDate, endDate);
    }
    case "sma": {
      const { runSmaCollector } = await import("@/lib/smaCollector");
      return runSmaCollector(userId, startDate, endDate);
    }
    case "laplace": {
      const { runLaplaceCollector } = await import("@/lib/laplaceCollector");
      return runLaplaceCollector(userId, startDate, endDate);
    }
    case "solar-monitor-sf": {
      const { runSolarMonitorCollector } = await import("@/lib/solarMonitorCollector");
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
    }
    case "solar-monitor-se": {
      const { runSolarMonitorCollector } = await import("@/lib/solarMonitorCollector");
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
    }
    default:
      return {
        ok: false,
        message: "UNKNOWN_SYSTEM",
        recordCount: 0,
        errorCount: 0,
      };
  }
}

const SYSTEM_KIND_MAP: Record<CronSystem, CollectorKind> = {
  "eco-megane": "eco-megane",
  "fusion-solar": "fusion-solar",
  sma: "sma",
  laplace: "laplace",
  "solar-monitor-sf": "solar-monitor-sf",
  "solar-monitor-se": "solar-monitor-se",
};

function asCronSystem(v: string): CronSystem | null {
  return v in SYSTEM_KIND_MAP ? (v as CronSystem) : null;
}

function yesterdayJstYmd(): string {
  const jstNowMs = Date.now() + 9 * 60 * 60 * 1000;
  const jstNow = new Date(jstNowMs);
  const y = jstNow.getUTCFullYear();
  const m = jstNow.getUTCMonth();
  const d = jstNow.getUTCDate();
  const yester = new Date(Date.UTC(y, m, d - 1, 0, 0, 0, 0));
  return `${yester.getUTCFullYear()}-${String(yester.getUTCMonth() + 1).padStart(2, "0")}-${String(yester.getUTCDate()).padStart(2, "0")}`;
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
    await ensureDbReachable();
  } catch {
    return NextResponse.json(
      { ok: false, message: "データベース接続に失敗しました。", recordCount: 0, errorCount: 0 },
      { status: 503 }
    );
  }

  const monthToYesterday = getStartAndEndDateJstMonthToYesterday();
  const { startDate, endDate } =
    system === "fusion-solar"
      ? { startDate: yesterdayJstYmd(), endDate: yesterdayJstYmd() }
      : monthToYesterday;
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

  const kind = SYSTEM_KIND_MAP[system];
  const lock = acquireCollectorLock(userId, kind);
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
    result = await runBySystem(system, userId, startDate, endDate);
    if (result.ok) {
      await applyPostCollectOverridesIfNeeded(system, startDate, endDate);
    }
  } catch (e) {
    result = {
      ok: false,
      message: e instanceof Error ? e.message : "CRON_SYSTEM_RUN_FAILED",
      recordCount: 0,
      errorCount: 0,
    };
  } finally {
    releaseCollectorLock(userId, kind);
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
