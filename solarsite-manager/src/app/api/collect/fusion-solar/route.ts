import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { runFusionSolarCollector } from "@/lib/fusionSolarCollector";
import { acquireCollectorLock, releaseCollectorLock } from "@/lib/collectorLock";
import { ensureDbReachable } from "@/lib/ensureDbReachable";
import { getFusionSolarWallBudgetMs, computeFusionExpectedMinRecords } from "@/lib/fusionSolarCollectBudget";
import { isKnownFusionStationNe, FUSION_SOLAR_STATIONS } from "@/lib/fusionSolarStations";

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
      /** 省略時は全発電所。localhost バッチ取得用 */
      stationNeList?: string[];
    };
    const startDate = typeof body?.startDate === "string" ? body.startDate : "";
    const endDate = typeof body?.endDate === "string" ? body.endDate : "";
    const stationNeList = Array.isArray(body?.stationNeList)
      ? body.stationNeList.filter((n): n is string => typeof n === "string" && n.trim().length > 0)
      : undefined;

    if (stationNeList && stationNeList.length > 0) {
      const invalid = stationNeList.filter((ne) => !isKnownFusionStationNe(ne));
      if (invalid.length > 0) {
        return NextResponse.json(
          {
            ok: false,
            message: `stationNeList に未知の NE があります: ${invalid.join(", ")}`,
            recordCount: 0,
            errorCount: 0,
          },
          { status: 400 }
        );
      }
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

    let result;
    try {
      const wallBudgetMs = getFusionSolarWallBudgetMs(startDate, endDate);
      const stationCount =
        stationNeList && stationNeList.length > 0 ? stationNeList.length : FUSION_SOLAR_STATIONS.length;
      const expectedMinRecords = computeFusionExpectedMinRecords(startDate, endDate, stationCount);
      result = await runFusionSolarCollector(userId, startDate, endDate, {
        wallBudgetMs,
        stationNeAllowList: stationNeList && stationNeList.length > 0 ? stationNeList : undefined,
        expectedMinRecords,
      });
    } finally {
      releaseCollectorLock(userId, "fusion-solar");
    }

    return NextResponse.json({
      ok: result.ok,
      message: result.message,
      recordCount: result.recordCount,
      errorCount: result.errorCount,
    });
  } catch (e) {
    return handleApiError(request, e);
  }
}
