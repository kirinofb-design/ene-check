import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { ensureDbReachable } from "@/lib/ensureDbReachable";
import { postCollectAfterAllSystems } from "@/lib/postCollectFinalize";

/** DB のみ（ブラウザ一括の最終段） */
export const maxDuration = 60;

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
        { ok: false, message: "startDate / endDate が必要です。" },
        { status: 400 }
      );
    }

    try {
      await ensureDbReachable();
    } catch {
      return NextResponse.json(
        { ok: false, message: "データベース接続に失敗しました。" },
        { status: 503 }
      );
    }

    const { mirrorSync } = await postCollectAfterAllSystems(startDate, endDate);

    return NextResponse.json({
      ok: true,
      message: "一括取得の後処理（ルール適用・ミラー同期）が完了しました。",
      mirrorSync,
    });
  } catch (e) {
    return handleApiError(request, e);
  }
}
