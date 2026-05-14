import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { runFusionSolarCollector } from "@/lib/fusionSolarCollector";
import { acquireCollectorLock, releaseCollectorLock } from "@/lib/collectorLock";
import { ensureDbReachable } from "@/lib/ensureDbReachable";
import { getFusionSolarWallBudgetMs } from "@/lib/fusionSolarCollectBudget";
import { isKnownFusionStationNe } from "@/lib/fusionSolarStations";

/** 1 発電所 × 指定期間（ブラウザからの分割取得用） */
export const maxDuration = 300;

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
      stationNe?: string;
    };
    const startDate = typeof body?.startDate === "string" ? body.startDate : "";
    const endDate = typeof body?.endDate === "string" ? body.endDate : "";
    const stationNe = typeof body?.stationNe === "string" ? body.stationNe.trim() : "";

    if (!startDate || !endDate || !stationNe) {
      return NextResponse.json(
        { ok: false, message: "startDate / endDate / stationNe が必要です。", recordCount: 0, errorCount: 0 },
        { status: 400 }
      );
    }
    if (!isKnownFusionStationNe(stationNe)) {
      return NextResponse.json(
        { ok: false, message: "stationNe が登録済み発電所の NE と一致しません。", recordCount: 0, errorCount: 0 },
        { status: 400 }
      );
    }

    try {
      await ensureDbReachable();
    } catch {
      return NextResponse.json(
        {
          ok: false,
          message: "データベース接続に失敗しました。数秒待ってから再実行してください。",
          recordCount: 0,
          errorCount: 0,
        },
        { status: 503 }
      );
    }

    const lock = acquireCollectorLock(userId, "fusion-solar");
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

    const wallBudgetMs = getFusionSolarWallBudgetMs(startDate, endDate);
    let result;
    try {
      result = await runFusionSolarCollector(userId, startDate, endDate, {
        stationNeAllowList: [stationNe],
        wallBudgetMs,
      });
    } finally {
      releaseCollectorLock(userId, "fusion-solar");
    }

    return NextResponse.json({
      ok: result.ok,
      message: result.message,
      recordCount: result.recordCount,
      errorCount: result.errorCount,
      stationNe,
      startDate,
      endDate,
    });
  } catch (e) {
    return handleApiError(request, e);
  }
}
