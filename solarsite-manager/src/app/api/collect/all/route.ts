import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { runEcoMeganeCollector } from "@/lib/ecoMeganeCollector";
import { runFusionSolarCollector } from "@/lib/fusionSolarCollector";
import { runSmaCollector } from "@/lib/smaCollector";
import { runLaplaceCollector } from "@/lib/laplaceCollector";
import { runSolarMonitorCollector } from "@/lib/solarMonitorCollector";

type CollectorStepResult = {
  key: string;
  ok: boolean;
  message: string;
  recordCount: number;
  errorCount: number;
};

async function runNamedCollector(
  key: string,
  runner: () => Promise<{ ok: boolean; message: string; recordCount: number; errorCount: number }>
): Promise<CollectorStepResult> {
  try {
    const result = await runner();
    return { key, ...result };
  } catch (e) {
    return {
      key,
      ok: false,
      message: e instanceof Error ? e.message : "コレクター実行に失敗しました。",
      recordCount: 0,
      errorCount: 0,
    };
  }
}

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

    const runSolarMonitorStep = async (
      key: "solar-monitor-sf" | "solar-monitor-se",
      successMessage: string
    ): Promise<CollectorStepResult> => {
      try {
        const result = await runSolarMonitorCollector(userId, startDate, endDate, key);
        return { key, ok: true, message: successMessage, ...result };
      } catch (e) {
        return {
          key,
          ok: false,
          message: e instanceof Error ? e.message : "コレクター実行に失敗しました。",
          recordCount: 0,
          errorCount: 0,
        };
      }
    };

    // 6 システムを同時起動（所要時間の短縮）。SQLite では同時書き込みでロックが出ることがある。
    const steps = await Promise.all([
      runNamedCollector("eco-megane", () => runEcoMeganeCollector(userId, startDate, endDate)),
      runNamedCollector("fusion-solar", () => runFusionSolarCollector(userId, startDate, endDate)),
      runNamedCollector("sma", () => runSmaCollector(userId, startDate, endDate)),
      runNamedCollector("laplace", () => runLaplaceCollector(userId, startDate, endDate)),
      runSolarMonitorStep("solar-monitor-sf", "Solar Monitor（池新田・本社）データ取得が完了しました。"),
      runSolarMonitorStep("solar-monitor-se", "Solar Monitor（須山）データ取得が完了しました。"),
    ]);

    const recordCount = steps.reduce((sum, s) => sum + s.recordCount, 0);
    const errorCount = steps.reduce((sum, s) => sum + s.errorCount, 0);

    const allOk = steps.every((s) => s.ok);
    const statusWord = allOk ? "完了" : "一部失敗";

    return NextResponse.json({
      ok: allOk,
      message: `全コレクター実行が${statusWord}しました（保存: ${recordCount}件 / スキップ: ${errorCount}件）。`,
      recordCount,
      errorCount,
      steps,
    });
  } catch (e) {
    return handleApiError(request, e);
  }
}
