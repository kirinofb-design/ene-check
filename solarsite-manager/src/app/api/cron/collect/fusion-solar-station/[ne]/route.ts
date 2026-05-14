import { NextResponse } from "next/server";
import { acquireCollectorLock, releaseCollectorLock } from "@/lib/collectorLock";
import { ensureDbReachable } from "@/lib/ensureDbReachable";
import { runFusionSolarCollector } from "@/lib/fusionSolarCollector";
import { logger } from "@/lib/logger";
import { isAuthorizedByCronSecret, resolveCronUserId } from "@/lib/cronCollect";

export const maxDuration = 300;

function yesterdayJstYmd(): string {
  const jstNowMs = Date.now() + 9 * 60 * 60 * 1000;
  const jstNow = new Date(jstNowMs);
  const yester = new Date(Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate() - 1, 0, 0, 0, 0));
  return `${yester.getUTCFullYear()}-${String(yester.getUTCMonth() + 1).padStart(2, "0")}-${String(yester.getUTCDate()).padStart(2, "0")}`;
}

export async function GET(
  request: Request,
  context: { params: { ne: string } }
) {
  if (!isAuthorizedByCronSecret(request)) {
    return NextResponse.json({ ok: false, message: "UNAUTHORIZED" }, { status: 401 });
  }

  const ne = (context.params.ne ?? "").trim();
  if (!/^\d{8,}$/.test(ne)) {
    return NextResponse.json({ ok: false, message: "INVALID_NE" }, { status: 400 });
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

  const day = yesterdayJstYmd();
  const lock = acquireCollectorLock(userId, "fusion-solar");
  if (!lock.ok) {
    return NextResponse.json(
      {
        ok: false,
        message: lock.message,
        system: "fusion-solar",
        ne,
        startDate: day,
        endDate: day,
        recordCount: 0,
        errorCount: 0,
      },
      { status: 409 }
    );
  }

  let result;
  try {
    logger.info("cron fusion station started", { userId, extra: { ne, day } });
    result = await runFusionSolarCollector(userId, day, day, { stationNeAllowList: [ne] });
  } finally {
    releaseCollectorLock(userId, "fusion-solar");
  }

  logger.info("cron fusion station finished", {
    userId,
    extra: { ne, day, ok: result.ok, recordCount: result.recordCount, errorCount: result.errorCount, message: result.message },
  });

  return NextResponse.json({
    ok: result.ok,
    message: result.message,
    system: "fusion-solar",
    ne,
    startDate: day,
    endDate: day,
    recordCount: result.recordCount,
    errorCount: result.errorCount,
  });
}
