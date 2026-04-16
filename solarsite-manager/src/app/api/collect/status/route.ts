import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { getCollectorLockState } from "@/lib/collectorLock";

export async function GET(request: Request) {
  try {
    const session = await requireAuth(request);
    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "ログインが必要です。" } },
        { status: 401 }
      );
    }

    const state = getCollectorLockState(userId);
    const allRunning = state.allRunning;
    return NextResponse.json({
      ok: true,
      allRunning,
      smaRunning: state.smaRunning,
      allCancelRequested: state.allCancelRequested,
      message: allRunning
        ? state.allCancelRequested
          ? "実行取消を受け付けています。進行中処理の区切りで停止します。"
          : "実行中（排他ロック中）です。完了してから再実行してください。"
        : null,
    });
  } catch (e) {
    return handleApiError(request, e);
  }
}

