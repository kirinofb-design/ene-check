import Link from "next/link";
import { auth, signOut } from "@/auth";

async function logout() {
  "use server";
  await signOut({ redirectTo: "/" });
}

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
        <Link
          href="/dashboard"
          className="text-sm text-slate-300 hover:text-sky-400"
        >
          ダッシュボード
        </Link>
        <Link
          href="/sites"
          className="text-sm text-slate-300 hover:text-sky-400"
        >
          サイト
        </Link>
        <Link
          href="/upload"
          className="text-sm text-slate-300 hover:text-sky-400"
        >
          アップロード
        </Link>
        <Link
          href="/alerts"
          className="text-sm text-slate-300 hover:text-sky-400"
        >
          アラート
        </Link>
        <Link
          href="/history"
          className="text-sm text-slate-300 hover:text-sky-400"
        >
          履歴
        </Link>
        <Link
          href="/settings"
          className="text-sm text-slate-300 hover:text-sky-400"
        >
          設定
        </Link>
        <span className="text-slate-600">|</span>
        <span className="text-xs text-slate-500">{session?.user?.email}</span>
        <form action={logout}>
          <button
            type="submit"
            className="text-xs text-slate-500 hover:text-red-400"
          >
            ログアウト
          </button>
        </form>
      </nav>
      {children}
    </div>
  );
}
