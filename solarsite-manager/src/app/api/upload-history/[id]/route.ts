import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

interface Params {
  params: { id: string };
}

export async function GET(_req: Request, { params }: Params) {
  const session = await requireAuth();
  const userId = (session.user as { id?: string })?.id;
  if (!userId) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "認証されていません。" } },
      { status: 401 }
    );
  }

  const record = await prisma.uploadHistory.findFirst({
    where: { id: params.id, userId },
    include: {
      site: { select: { siteName: true, monitoringUrl: true } },
      user: { select: { email: true, name: true } },
    },
  });

  if (!record) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "履歴が見つかりません。" } },
      { status: 404 }
    );
  }

  return NextResponse.json({ data: record });
}
