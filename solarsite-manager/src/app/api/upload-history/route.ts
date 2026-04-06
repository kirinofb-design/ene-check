import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";

export async function GET(request: Request) {
  try {
    const session = await requireAuth(request);
    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "認証されていません。" } },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get("siteId");
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100);

    const where: { userId: string; siteId?: string } = { userId };
    if (siteId) where.siteId = siteId;

    const history = await prisma.uploadHistory.findMany({
      where,
      orderBy: { uploadedAt: "desc" },
      take: limit,
      include: {
        site: { select: { siteName: true } },
        user: { select: { email: true, name: true } },
      },
    });

    return NextResponse.json({ data: history });
  } catch (e) {
    return handleApiError(request, e);
  }
}
