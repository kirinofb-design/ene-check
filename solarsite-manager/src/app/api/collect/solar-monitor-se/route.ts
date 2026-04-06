import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { runSolarMonitorCollector } from "@/lib/solarMonitorCollector";

export async function POST(req: Request) {
  // 強制出力（Next.jsのログ機能を介さない）
  process.stdout.write("\n\n##########################################\n");
  process.stdout.write("🔥 API REACHED: /api/collect/solar-monitor-se\n");
  process.stdout.write("##########################################\n\n");

  try {
    const session = await requireAuth(req);
    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        {
          ok: false,
          message: "ログインが必要です。",
          recordCount: 0,
          errorCount: 0,
        },
        { status: 401 }
      );
    }

    const body = (await req.json()) as { startDate?: string; endDate?: string };
    const startDate = typeof body?.startDate === "string" ? body.startDate : "";
    const endDate = typeof body?.endDate === "string" ? body.endDate : "";

    // コレクター実行（常に solar-monitor-se。本社・池新田は /api/collect/solar-monitor-sf）
    const result = await runSolarMonitorCollector(userId, startDate, endDate, "solar-monitor-se");

    if (result.recordCount === 0) {
      console.log("[solar-monitor-se] 保存件数 0 件（空振りの可能性）", {
        systemId: "solar-monitor-se",
        targetPeriod: { startDate, endDate },
        recordCount: result.recordCount,
        errorCount: result.errorCount,
        note: "詳細はサーバーログの [SOLAR_MONITOR_EMPTY_FETCH] を参照",
      });
    }

    return NextResponse.json({
      ok: true,
      message: "データ取得に成功しました",
      recordCount: result.recordCount,
      errorCount: result.errorCount,
    });
  } catch (error) {
    console.error("SolarMonitor API Error:", error);
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "未知のエラーが発生しました",
        recordCount: 0,
        errorCount: 0,
      },
      { status: 500 }
    );
  }
}
