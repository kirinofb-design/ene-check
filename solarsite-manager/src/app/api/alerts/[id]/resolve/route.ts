import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";

interface Params {
  params: { id: string };
}

export async function PATCH(_req: Request, { params }: Params) {
  try {
    const session = await requireAuth();
    const { id } = params;

    const alert = await prisma.alert.update({
      where: { id },
      data: {
        resolvedAt: new Date(),
        resolvedBy: (session.user as { id?: string })?.id ?? null,
      },
    });

    return NextResponse.json({ data: alert });
  } catch (e) {
    // _req を受け取っていないため簡易。Route の形を崩さないためここは 500 に寄せる
    return NextResponse.json(
      { error: { code: "INTERNAL_SERVER_ERROR", message: "サーバーエラーが発生しました。" } },
      { status: 500 }
    );
  }
}
