import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";

export async function POST(request: Request) {
  const body = await request.json();
  const { email, name, password } = body as {
    email?: string;
    name?: string;
    password?: string;
  };

  if (!email || !password) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "email と password は必須です。" } },
      { status: 400 }
    );
  }

  const isValidFormat =
    typeof password === "string" &&
    password.length >= 8 &&
    password.length <= 128 &&
    /[A-Za-z]/.test(password) &&
    /[0-9]/.test(password);

  if (!isValidFormat) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_PASSWORD",
          message: "パスワードは 8〜128文字の英数字混在で入力してください。",
        },
      },
      { status: 400 }
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: { code: "EMAIL_TAKEN", message: "このメールアドレスは既に登録されています。" } },
      { status: 409 }
    );
  }

  const hashed = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      email,
      name: name ?? null,
      password: hashed,
    },
  });

  return NextResponse.json({
    data: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
  });
}

