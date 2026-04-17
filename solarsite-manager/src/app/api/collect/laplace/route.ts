import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { runLaplaceCollector } from "@/lib/laplaceCollector";
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

    const lock = acquireCollectorLock(userId, "laplace");
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
      result = await runLaplaceCollector(userId, startDate, endDate);
    } finally {
      releaseCollectorLock(userId, "laplace");
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
