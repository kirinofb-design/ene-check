import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";

export async function GET(request: Request) {
  try {
    await requireAuth(request);
    const { searchParams } = new URL(request.url);
    const resolved = searchParams.get("resolved") === "true";

    const alerts = await prisma.alert.findMany({
      where: resolved ? {} : { resolvedAt: null },
      include: { site: { select: { siteName: true } } },
      orderBy: { detectedAt: "desc" },
    });

    return NextResponse.json({ data: alerts });
  } catch (e) {
    return handleApiError(request, e);
  }
}
