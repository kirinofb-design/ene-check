import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runEcoMeganeCollector } from "@/lib/ecoMeganeCollector";
import { runFusionSolarCollector } from "@/lib/fusionSolarCollector";
import { runSmaCollector } from "@/lib/smaCollector";
import { runLaplaceCollector } from "@/lib/laplaceCollector";
import { runSolarMonitorCollector } from "@/lib/solarMonitorCollector";
import { ensureDbReachable } from "@/lib/ensureDbReachable";

export const maxDuration = 300;

type CollectSystemId =
  | "eco-megane"
  | "fusion-solar"
  | "sma"
  | "laplace"
  | "solar-monitor-sf"
  | "solar-monitor-se";

type CollectResult = { ok: boolean; message: string; recordCount: number; errorCount: number };

function isAuthorizedInternal(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

function diffDaysInclusive(startDate: string, endDate: string): number {
  const s = Date.parse(`${startDate}T00:00:00.000Z`);
  const e = Date.parse(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return 0;
  return Math.floor((e - s) / (24 * 60 * 60 * 1000)) + 1;
}

async function resolveInternalUserId(): Promise<string | null> {
  const byId = process.env.CRON_COLLECT_USER_ID?.trim();
  if (byId) return byId;

  const byEmail = process.env.CRON_COLLECT_USER_EMAIL?.trim();
  if (byEmail) {
    const user = await prisma.user.findUnique({
      where: { email: byEmail },
      select: { id: true },
    });
    if (user?.id) return user.id;
  }

  const cred = await prisma.monitoringCredential.findFirst({
    select: { userId: true },
    orderBy: { createdAt: "asc" },
  });
  return cred?.userId ?? null;
}

export async function POST(request: Request) {
  if (!isAuthorizedInternal(request)) {
    return NextResponse.json({ ok: false, message: "UNAUTHORIZED" }, { status: 401 });
  }

  const body = (await request.json()) as {
    system?: CollectSystemId;
    startDate?: string;
    endDate?: string;
    userId?: string;
  };
  const system = body.system;
  const startDate = String(body.startDate ?? "");
  const endDate = String(body.endDate ?? "");
  const requestedUserId = String(body.userId ?? "").trim();

  if (!system || !startDate || !endDate) {
    return NextResponse.json(
      { ok: false, message: "system/startDate/endDate が必要です。", recordCount: 0, errorCount: 0 },
      { status: 400 }
    );
  }

  const userId = requestedUserId || (await resolveInternalUserId());
  if (!userId) {
    return NextResponse.json(
      { ok: false, message: "実行ユーザーを特定できません。", recordCount: 0, errorCount: 0 },
      { status: 400 }
    );
  }

  try {
    await ensureDbReachable(3);
  } catch {
    return NextResponse.json(
      { ok: false, message: "データベース接続に失敗しました。", recordCount: 0, errorCount: 0 },
      { status: 503 }
    );
  }

  const run = async (): Promise<CollectResult> => {
    switch (system) {
      case "eco-megane":
        return runEcoMeganeCollector(userId, startDate, endDate);
      case "fusion-solar": {
        const requestDays = diffDaysInclusive(startDate, endDate);
        const wallBudgetMs =
          requestDays > 7 ? 90_000 : requestDays > 3 ? 120_000 : 150_000;
        return runFusionSolarCollector(userId, startDate, endDate, { wallBudgetMs });
      }
      case "sma":
        return runSmaCollector(userId, startDate, endDate);
      case "laplace":
        return runLaplaceCollector(userId, startDate, endDate);
      case "solar-monitor-sf": {
        const r = await runSolarMonitorCollector(userId, startDate, endDate, "solar-monitor-sf");
        return {
          ok: true,
          message: "Solar Monitor（池新田・本社）データ取得が完了しました。",
          recordCount: r.recordCount,
          errorCount: r.errorCount,
        };
      }
      case "solar-monitor-se": {
        const r = await runSolarMonitorCollector(userId, startDate, endDate, "solar-monitor-se");
        return {
          ok: true,
          message: "Solar Monitor（須山）データ取得が完了しました。",
          recordCount: r.recordCount,
          errorCount: r.errorCount,
        };
      }
      default:
        return { ok: false, message: "UNKNOWN_SYSTEM", recordCount: 0, errorCount: 0 };
    }
  };

  try {
    const result = await run();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "collector failed", recordCount: 0, errorCount: 0 },
      { status: 500 }
    );
  }
}

