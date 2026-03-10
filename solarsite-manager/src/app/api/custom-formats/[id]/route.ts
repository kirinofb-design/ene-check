import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    await requireAuth(request);
    const body = await request.json();

    const { name, isActive, config } = body as {
      name?: string;
      isActive?: boolean;
      config?: unknown;
    };

    const updated = await prisma.customFormat.update({
      where: { id: params.id },
      data: {
        ...(name != null ? { name } : {}),
        ...(typeof isActive === "boolean" ? { isActive } : {}),
        ...(config !== undefined ? { config: JSON.stringify(config) } : {}),
      },
    });

    return NextResponse.json({ data: updated });
  } catch (e) {
    return handleApiError(request, e);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    await requireAuth(request);

    await prisma.customFormat.delete({
      where: { id: params.id },
    });

    return NextResponse.json({ data: { id: params.id } });
  } catch (e) {
    return handleApiError(request, e);
  }
}

