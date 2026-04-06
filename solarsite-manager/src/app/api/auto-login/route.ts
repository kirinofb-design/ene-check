import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { autoLogin } from "@/lib/autoLogin";
import type { SystemId } from "@/lib/autoLogin";
import { MONITORING_AUTH_TARGETS } from "@/lib/monitoringSystemsAuth";

const allowedSystemIds = new Set(
  MONITORING_AUTH_TARGETS.map((t) => t.systemId)
) as Set<SystemId>;

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

    const body = await request.json();
    const systemId = body?.systemId as string | undefined;
    if (!systemId || !allowedSystemIds.has(systemId as SystemId)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "無効な systemId です。" } },
        { status: 400 }
      );
    }

    const result = await autoLogin(userId, systemId as SystemId);

    return NextResponse.json({
      ok: result.ok,
      message: result.message,
    });
  } catch (e) {
    return handleApiError(request, e);
  }
}
