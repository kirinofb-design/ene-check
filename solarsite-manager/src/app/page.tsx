import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          太陽光発電所統合管理システム SolarSite Manager
        </h1>
        <p className="text-sm text-slate-400 leading-relaxed">
          このアプリケーションは、6つの監視システムからエクスポートした発電量データを一元管理し、
          統一されたダッシュボードで可視化するための社内業務用 Web アプリケーションです。
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-300">はじめに</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-2">
            <h3 className="text-sm font-semibold text-slate-200">
              ログイン
            </h3>
            <p className="text-xs text-slate-400">
              既存アカウントでログインしてダッシュボードにアクセスします。
            </p>
            <Link
              href="/auth/login"
              className="inline-flex items-center justify-center rounded-md bg-sky-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-400"
            >
              ログイン
            </Link>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-2">
            <h3 className="text-sm font-semibold text-slate-200">
              新規登録
            </h3>
            <p className="text-xs text-slate-400">
              初めての方はアカウントを作成してください。
            </p>
            <Link
              href="/auth/signup"
              className="inline-flex items-center justify-center rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              新規登録
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
