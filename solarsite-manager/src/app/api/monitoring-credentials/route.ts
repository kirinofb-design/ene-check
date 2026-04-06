import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { encryptSecret } from "@/lib/encryption";
import { MONITORING_AUTH_TARGETS } from "@/lib/monitoringSystemsAuth";

const allowedSystemIds = new Set(MONITORING_AUTH_TARGETS.map((t) => t.systemId));

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

    const creds = await prisma.monitoringCredential.findMany({
      where: { userId },
      select: {
        systemId: true,
        loginId: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ data: creds });
  } catch (e) {
    return handleApiError(request, e);
  }
}

export async function PUT(request: Request) {
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
    const { systemId, loginId, password } = body as {
      systemId?: string;
      loginId?: string;
      password?: string;
    };

    if (!systemId || !allowedSystemIds.has(systemId as any)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "systemId が不正です。" } },
        { status: 400 }
      );
    }
    if (!loginId || !password) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "loginId と password は必須です。" } },
        { status: 400 }
      );
    }

    const encryptedPassword = encryptSecret(password);

    const existing = await prisma.monitoringCredential.findFirst({
      where: { userId, systemId },
      select: { id: true },
    });

    if (existing) {
      const updated = await prisma.monitoringCredential.update({
        where: { id: existing.id },
        data: {
          loginId,
          encryptedPassword,
        },
        select: { systemId: true, loginId: true, updatedAt: true },
      });
      return NextResponse.json({ data: updated });
    }

    const created = await prisma.monitoringCredential.create({
      data: {
        userId,
        systemId,
        loginId,
        encryptedPassword,
      },
      select: { systemId: true, loginId: true, updatedAt: true },
    });
    return NextResponse.json({ data: created }, { status: 201 });
  } catch (e) {
    return handleApiError(request, e);
  }
}

