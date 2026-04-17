import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { runSolarMonitorCollector } from "@/lib/solarMonitorCollector";
import { acquireCollectorLock, releaseCollectorLock } from "@/lib/collectorLock";

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

    const lock = acquireCollectorLock(userId, "all");
    if (!lock.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: lock.message,
          recordCount: 0,
          errorCount: 0,
        },
        { status: 409 }
      );
    }

    let result;
    try {
      result = await runSolarMonitorCollector(userId, startDate, endDate, "solar-monitor-sf");
    } finally {
      releaseCollectorLock(userId, "all");
    }

    if (result.recordCount === 0) {
      console.log("[solar-monitor-sf] 保存件数 0 件（空振りの可能性）", {
        systemId: "solar-monitor-sf",
        targetPeriod: { startDate, endDate },
        sitesNote: "池新田・本社は同一API内で2プラント処理",
        recordCount: result.recordCount,
        errorCount: result.errorCount,
        note: "詳細はサーバーログの [SOLAR_MONITOR_EMPTY_FETCH] を参照",
      });
    }

    return NextResponse.json({
      ok: true,
      message: `Solar Monitor（池新田・本社）データ取得が完了しました（保存: ${result.recordCount}件 / スキップ: ${result.errorCount}件）。`,
      recordCount: result.recordCount,
      errorCount: result.errorCount,
    });
  } catch (e) {
    return handleApiError(request, e);
  }
}
