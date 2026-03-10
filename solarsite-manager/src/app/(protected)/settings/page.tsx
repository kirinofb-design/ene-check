import { auth } from "@/auth";

export default async function SettingsPage() {
  const session = await auth();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">プロフィール設定</h1>
      <p className="text-sm text-slate-400">
        ログイン中のアカウント情報を表示します。
      </p>

      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-3 max-w-md">
        <div>
          <span className="text-xs text-slate-500">メールアドレス</span>
          <p className="text-sm text-slate-200">{session?.user?.email ?? "-"}</p>
        </div>
        <div>
          <span className="text-xs text-slate-500">名前</span>
          <p className="text-sm text-slate-200">{session?.user?.name ?? "未設定"}</p>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        プロフィール編集・パスワード変更は将来のバージョンで対応予定です。
      </p>
    </div>
  );
}
