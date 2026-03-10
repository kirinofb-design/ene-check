import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

interface Params {
  params: { id: string };
}

export async function PATCH(_req: Request, { params }: Params) {
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
}
