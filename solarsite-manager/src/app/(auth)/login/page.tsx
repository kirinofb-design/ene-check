
"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";

export default function LoginPage() {
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email || !password) {
      setError("メールアドレスとパスワードを入力してください。");
      return;
    }

    setLoading(true);
    const result = await signIn("credentials", {
      redirect: false,
      email,
      password,
      callbackUrl: from,
    });
    setLoading(false);

    if (result?.error) {
      setError("メールアドレスまたはパスワードが正しくありません。");
      return;
    }

    if (result?.url) {
      window.location.href = result.url;
    }
  }

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-xl font-semibold mb-4">ログイン（F-1）</h1>
      <p className="text-sm text-slate-400 mb-6">
        Spec.md セクション 4.3 / 6.1 / 7 に基づき、メールアドレスとパスワードによる認証を行います。
      </p>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-md border border-slate-800 bg-slate-900/60 p-4"
      >
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-200">
            メールアドレス
          </label>
          <input
            type="email"
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-200">
            パスワード
          </label>
          <input
            type="password"
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <p className="text-[10px] text-slate-500">
            パスワードは 8〜128文字の英数字混在で入力してください。
          </p>
        </div>

        {error && (
          <p className="text-xs text-red-400 bg-red-950/40 border border-red-900 rounded px-2 py-1">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-60"
        >
          {loading ? "ログイン中..." : "ログイン"}
        </button>

        <div className="flex items-center justify-between text-xs text-slate-400 mt-2">
          <Link href="/auth/forgot-password">パスワードをお忘れですか？</Link>
          <Link href="/auth/signup">新規登録はこちら</Link>
        </div>
      </form>

      <p className="mt-4 text-xs text-slate-500">
        テスト用ユーザー: <code>test@example.com / Test1234</code>
        （`prisma/seed.ts` で作成）
      </p>
    </div>
  );
}

