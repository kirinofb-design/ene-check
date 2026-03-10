import { NextResponse } from "next/server";
import { auth } from "@/auth";

/**
 * GET /api/auth/me - 自分の情報（Spec 8.2）
 */
export async function GET() {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "認証されていません。" } },
      { status: 401 }
    );
  }

  const user = session.user;
  return NextResponse.json({
    data: {
      id: (user as { id?: string }).id,
      email: user.email,
      name: user.name,
      role: (user as { role?: string }).role ?? "user",
    },
  });
}
