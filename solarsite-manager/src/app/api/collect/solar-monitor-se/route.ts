import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { runSolarMonitorCollector } from "@/lib/solarMonitorCollector";
import { acquireCollectorLock, releaseCollectorLock } from "@/lib/collectorLock";

export async function POST(req: Request) {
  try {
    const session = await requireAuth(req);
    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        {
          ok: false,
          message: "??????????",
          recordCount: 0,
          errorCount: 0,
        },
        { status: 401 }
      );
    }

    const body = (await req.json()) as { startDate?: string; endDate?: string };
    const startDate = typeof body?.startDate === "string" ? body.startDate : "";
    const endDate = typeof body?.endDate === "string" ? body.endDate : "";

    const lock = acquireCollectorLock(userId, "solar-monitor-se");
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

    // ?????????? solar-monitor-se???????? /api/collect/solar-monitor-sf?
    let result;
    try {
      result = await runSolarMonitorCollector(userId, startDate, endDate, "solar-monitor-se");
    } finally {
      releaseCollectorLock(userId, "solar-monitor-se");
    }

    if (result.recordCount === 0) {
      console.log("[solar-monitor-se] ???? 0 ??????????", {
        systemId: "solar-monitor-se",
        targetPeriod: { startDate, endDate },
        recordCount: result.recordCount,
        errorCount: result.errorCount,
        note: "?????????? [SOLAR_MONITOR_EMPTY_FETCH] ???",
      });
    }

    return NextResponse.json({
      ok: true,
      message: "????????????",
      recordCount: result.recordCount,
      errorCount: result.errorCount,
    });
  } catch (error) {
    console.error("SolarMonitor API Error:", error);
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "?????????????",
        recordCount: 0,
        errorCount: 0,
      },
      { status: 500 }
    );
  }
}
