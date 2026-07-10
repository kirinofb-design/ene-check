import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { ensureDbReachable } from "@/lib/ensureDbReachable";
import { warmFusionSolarSession } from "@/lib/fusionSolarSessionWarm";
import { prewarmVercelChromiumExecutable } from "@/lib/playwrightRuntime";

/** FusionSolar のログインセッションだけを確立して DB に保存する（本番一括の前処理） */
export const maxDuration = 120;

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

    try {
      await ensureDbReachable();
    } catch {
      return NextResponse.json(
        { ok: false, message: "データベース接続に失敗しました。数秒待ってから再実行してください。" },
        { status: 503 }
      );
    }

    await prewarmVercelChromiumExecutable().catch(() => {});
    const result = await warmFusionSolarSession(userId);
    return NextResponse.json(result);
  } catch (e) {
    return handleApiError(request, e);
  }
}
