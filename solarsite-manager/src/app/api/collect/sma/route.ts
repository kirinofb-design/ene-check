import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { runSmaCollector } from "@/lib/smaCollector";
import { acquireCollectorLock, releaseCollectorLock } from "@/lib/collectorLock";
import { logger } from "@/lib/logger";

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

    const lock = acquireCollectorLock(userId, "sma");
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
      result = await runSmaCollector(userId, startDate, endDate);
    } finally {
      releaseCollectorLock(userId, "sma");
    }

    return NextResponse.json({
      ok: result.ok,
      message: result.message,
      recordCount: result.recordCount,
      errorCount: result.errorCount,
    });
  } catch (e) {
    logger.error("sma collect route failed", undefined, e);
    return NextResponse.json(
      {
        ok: false,
        message: e instanceof Error ? e.message : "SMA?????????????",
        recordCount: 0,
        errorCount: 0,
      },
      { status: 200 }
    );
  }
}

