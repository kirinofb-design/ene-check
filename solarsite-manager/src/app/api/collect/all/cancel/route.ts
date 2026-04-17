import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { requestCollectorCancel } from "@/lib/collectorLock";

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

    const result = requestCollectorCancel(userId, "all");
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, message: result.message },
        { status: 400 }
      );
    }
    return NextResponse.json({
      ok: true,
      accepted: result.accepted,
      message: result.accepted
        ? "実行取消を受け付けました。進行中の処理の区切りで停止します。"
        : "現在実行中のデータ取得処理はありません。",
    });
  } catch (e) {
    return handleApiError(request, e);
  }
}

