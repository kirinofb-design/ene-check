
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function SignupPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!email || !password) {
      setError("メールアドレスとパスワードは必須です。");
      return;
    }

    if (password !== confirmPassword) {
      setError("パスワードと確認用パスワードが一致していません。");
      return;
    }

    const isValidFormat =
      password.length >= 8 &&
      password.length <= 128 &&
      /[A-Za-z]/.test(password) &&
      /[0-9]/.test(password);

    if (!isValidFormat) {
      setError("パスワードは 8〜128文字の英数字混在で入力してください。");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, password }),
      });

      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? "登録に失敗しました。");
        return;
      }

      setSuccess("登録が完了しました。ログイン画面に移動します。");
      setTimeout(() => {
        router.push("/auth/login");
      }, 1200);
    } catch {
      setError("ネットワークエラーが発生しました。時間をおいて再度お試しください。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-xl font-semibold mb-4">新規登録（F-1）</h1>
      <p className="text-sm text-slate-400 mb-6">
        Spec.md セクション 6.1 `/auth/signup` に対応する画面です。
        メールアドレス・氏名・パスワードを登録してからログインします。
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
          <label className="text-xs font-medium text-slate-200">氏名</label>
          <input
            type="text"
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="任意"
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
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-200">
            パスワード（確認）
          </label>
          <input
            type="password"
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
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

        {success && (
          <p className="text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-900 rounded px-2 py-1">
            {success}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-60"
        >
          {loading ? "登録中..." : "新規登録"}
        </button>

        <div className="flex items-center justify-end text-xs text-slate-400 mt-2">
          <Link href="/auth/login">すでにアカウントをお持ちの方はこちら</Link>
        </div>
      </form>
    </div>
  );
}

