import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { runSolarMonitorCollector } from "@/lib/solarMonitorCollector";
import { acquireCollectorLock, releaseCollectorLock } from "@/lib/collectorLock";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const session = await requireAuth(request);
    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "??????????" } },
        { status: 401 }
      );
    }

    const body = (await request.json()) as {
      startDate?: string;
      endDate?: string;
    };
    const startDate = typeof body?.startDate === "string" ? body.startDate : "";
    const endDate = typeof body?.endDate === "string" ? body.endDate : "";

    const lock = acquireCollectorLock(userId, "solar-monitor-sf");
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
      releaseCollectorLock(userId, "solar-monitor-sf");
    }

    if (result.recordCount === 0) {
      console.log("[solar-monitor-sf] ???? 0 ??????????", {
        systemId: "solar-monitor-sf",
        targetPeriod: { startDate, endDate },
        sitesNote: "?????????API??2??????",
        recordCount: result.recordCount,
        errorCount: result.errorCount,
        note: "?????????? [SOLAR_MONITOR_EMPTY_FETCH] ???",
      });
    }

    return NextResponse.json({
      ok: true,
      message: `Solar Monitor???????????????????????: ${result.recordCount}? / ????: ${result.errorCount}???`,
      recordCount: result.recordCount,
      errorCount: result.errorCount,
    });
  } catch (e) {
    return handleApiError(request, e);
  }
}
