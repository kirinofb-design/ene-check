import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { prewarmVercelChromiumExecutable } from "@/lib/playwrightRuntime";

export const maxDuration = 60;

/**
 * ブラウザからの分割一括取得で、最初の Playwright 系の前に 1 回だけ呼ぶ。
 * `/tmp` 上の Chromium 実行ファイル競合（ETXTBSY）を減らす。
 */
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

    await prewarmVercelChromiumExecutable();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(request, e);
  }
}
