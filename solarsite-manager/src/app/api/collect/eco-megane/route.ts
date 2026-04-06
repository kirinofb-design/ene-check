import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { runEcoMeganeCollector } from "@/lib/ecoMeganeCollector";

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

    const result = await runEcoMeganeCollector(userId, startDate, endDate);

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: result.message,
          recordCount: result.recordCount,
          errorCount: result.errorCount,
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: result.message,
      recordCount: result.recordCount,
      errorCount: result.errorCount,
    });
  } catch (e) {
    return handleApiError(request, e);
  }
}
