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

    const steps: CollectorStepResult[] = [];
    let recordCount = 0;
    let errorCount = 0;

    const runStep = async (
      key: string,
      runner: () => Promise<{ ok: boolean; message: string; recordCount: number; errorCount: number }>
    ) => {
      const result = await runner();
      steps.push({ key, ...result });
      recordCount += result.recordCount;
      errorCount += result.errorCount;
    };

    const runStepThrowing = async (
      key: string,
      runner: () => Promise<{ recordCount: number; errorCount: number }>,
      successMessage: string
    ) => {
      const result = await runner();
      steps.push({ key, ok: true, message: successMessage, ...result });
      recordCount += result.recordCount;
      errorCount += result.errorCount;
    };

    // 失敗時も次へ進めるため、各ステップ単位で握って集約する
    const tasks: Array<{ key: string; run: () => Promise<void> }> = [
      { key: "eco-megane", run: () => runStep("eco-megane", () => runEcoMeganeCollector(userId, startDate, endDate)) },
      {
        key: "fusion-solar",
        run: () => runStep("fusion-solar", () => runFusionSolarCollector(userId, startDate, endDate)),
      },
      { key: "sma", run: () => runStep("sma", () => runSmaCollector(userId, startDate, endDate)) },
      { key: "laplace", run: () => runStep("laplace", () => runLaplaceCollector(userId, startDate, endDate)) },
      {
        key: "solar-monitor-sf",
        run: () =>
          runStepThrowing(
            "solar-monitor-sf",
            () => runSolarMonitorCollector(userId, startDate, endDate, "solar-monitor-sf"),
            "Solar Monitor（池新田・本社）データ取得が完了しました。"
          ),
      },
      {
        key: "solar-monitor-se",
        run: () =>
          runStepThrowing(
            "solar-monitor-se",
            () => runSolarMonitorCollector(userId, startDate, endDate, "solar-monitor-se"),
            "Solar Monitor（須山）データ取得が完了しました。"
          ),
      },
    ];

    for (const task of tasks) {
      try {
        await task.run();
      } catch (e) {
        steps.push({
          key: task.key,
          ok: false,
          message: e instanceof Error ? e.message : "コレクター実行に失敗しました。",
          recordCount: 0,
          errorCount: 0,
        });
      }
    }

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
