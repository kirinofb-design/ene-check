import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

interface Params {
  params: { id: string };
}

export async function GET(_req: Request, { params }: Params) {
  await requireAuth();

  const site = await prisma.site.findUnique({
    where: { id: params.id },
  });

  if (!site) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "サイトが見つかりません。" } },
      { status: 404 }
    );
  }

  return NextResponse.json({ data: site });
}

export async function PATCH(request: Request, { params }: Params) {
  await requireAuth();
  const body = (await request.json()) as Record<string, unknown>;

  const data: Record<string, unknown> = {};
  if (typeof body.siteName === "string") data.siteName = body.siteName;
  if (typeof body.location === "string" || body.location === null) data.location = body.location;
  if (typeof body.capacity === "number" && body.capacity >= 0) data.capacity = body.capacity;
  if (typeof body.monitoringSystem === "string") data.monitoringSystem = body.monitoringSystem;
  if (typeof body.monitoringUrl === "string") data.monitoringUrl = body.monitoringUrl;

  const site = await prisma.site.update({
    where: { id: params.id },
    data,
  });

  return NextResponse.json({ data: site });
}

export async function DELETE(_req: Request, { params }: Params) {
  await requireAuth();

  await prisma.site.delete({
    where: { id: params.id },
  });

  return NextResponse.json({ data: { id: params.id } });
}

