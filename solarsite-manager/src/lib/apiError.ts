import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";

export function getRequestId(request: Request): string | undefined {
  return request.headers.get("x-request-id") ?? undefined;
}

function jsonError(
  status: number,
  code: string,
  message: string,
  requestId?: string
) {
  const res = NextResponse.json(
    {
      error: {
        code,
        message,
        requestId,
      },
    },
    { status }
  );
  if (requestId) res.headers.set("x-request-id", requestId);
  return res;
}

export function handleApiError(request: Request, err: unknown) {
  const requestId = getRequestId(request);
  const { pathname } = new URL(request.url);

  // 認証エラーは 401 で返す（現状 requireAuth が Error を投げるため）
  if (err instanceof Error && err.message === "UNAUTHORIZED") {
    logger.warn("API unauthorized", {
      requestId,
      path: pathname,
      method: request.method,
    });
    return jsonError(401, "UNAUTHORIZED", "ログインが必要です。", requestId);
  }

  // Prisma の DB 到達不可（Neon 断/ネットワーク断）を明示する
  if (err instanceof Error) {
    const msg = err.message ?? "";
    if (
      /can't reach database server/i.test(msg) ||
      /P1001/i.test(msg) ||
      /ECONNREFUSED/i.test(msg) ||
      /ENOTFOUND/i.test(msg)
    ) {
      logger.error("API database unreachable", {
        requestId,
        path: pathname,
        method: request.method,
      }, err);
      return jsonError(
        503,
        "DATABASE_UNREACHABLE",
        "データベースに接続できません。時間をおいて再実行してください。",
        requestId
      );
    }
  }

  logger.error("API unhandled error", {
    requestId,
    path: pathname,
    method: request.method,
  }, err);

  return jsonError(500, "INTERNAL_SERVER_ERROR", "サーバーエラーが発生しました。", requestId);
}

