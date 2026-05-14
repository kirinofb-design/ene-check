import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { runFusionSolarCollector } from "@/lib/fusionSolarCollector";
import { acquireCollectorLock, releaseCollectorLock } from "@/lib/collectorLock";
import { ensureDbReachable } from "@/lib/ensureDbReachable";
import { diffDaysInclusiveYmd, getFusionSolarWallBudgetMs } from "@/lib/fusionSolarCollectBudget";
import { logger } from "@/lib/logger";

/**
 * 指定期間が短いときだけ全発電所をまとめて取得（ログインは1回）。
 * ブラウザは日単位（最大1日）で複数回呼び出す。
 */
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
    };
    const startDate = typeof body?.startDate === "string" ? body.startDate : "";
    const endDate = typeof body?.endDate === "string" ? body.endDate : "";

    if (!startDate || !endDate) {
      return NextResponse.json(
        { ok: false, message: "startDate / endDate が必要です。", recordCount: 0, errorCount: 0 },
        { status: 400 }
      );
    }

    if (startDate !== endDate || diffDaysInclusiveYmd(startDate, endDate) !== 1) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "この API は同一日の startDate=endDate（1日分）のみ指定できます。長期間はブラウザが日ごとに分割して呼び出してください。",
          recordCount: 0,
          errorCount: 0,
        },
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
    try {
      const result = await runFusionSolarCollector(userId, startDate, endDate, { wallBudgetMs });
      return NextResponse.json({
        ok: result.ok,
        message: result.message,
        recordCount: result.recordCount,
        errorCount: result.errorCount,
        startDate,
        endDate,
      });
    } catch (collectorErr) {
      const detail = collectorErr instanceof Error ? collectorErr.message : String(collectorErr);
      logger.error(
        "fusion-solar window collector threw",
        { userId, extra: { startDate, endDate, detail } },
        collectorErr
      );
      return NextResponse.json(
        {
          ok: false,
          message: `FusionSolar 収集中に例外が発生しました: ${detail}`,
          recordCount: 0,
          errorCount: 0,
          startDate,
          endDate,
        },
        { status: 500 }
      );
    } finally {
      releaseCollectorLock(userId, "fusion-solar");
    }
  } catch (e) {
    return handleApiError(request, e);
  }
}
