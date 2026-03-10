import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function UploadHistoryPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string })?.id;
  if (!userId) return null;

  const history = await prisma.uploadHistory.findMany({
    where: { userId },
    orderBy: { uploadedAt: "desc" },
    take: 50,
    include: { site: { select: { siteName: true } } },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">アップロード履歴（F-13）</h1>
      <p className="text-sm text-slate-400">
        アップロードしたファイルの取込履歴を確認できます。
      </p>

      <div className="rounded-lg border border-slate-800 overflow-x-auto">
        <table className="min-w-[720px] w-full text-xs">
          <thead className="bg-slate-900/80">
            <tr className="text-left text-slate-300">
              <th className="px-3 py-2">日時</th>
              <th className="px-3 py-2">ファイル名</th>
              <th className="px-3 py-2">サイト</th>
              <th className="px-3 py-2">形式</th>
              <th className="px-3 py-2">サイズ</th>
              <th className="px-3 py-2">成功 / エラー</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id} className="border-t border-slate-800 hover:bg-slate-800/40">
                <td className="px-3 py-2">
                  {h.uploadedAt.toLocaleString("ja-JP")}
                </td>
                <td className="px-3 py-2">{h.fileName}</td>
                <td className="px-3 py-2">
                  {h.site?.siteName ?? "-"}
                </td>
                <td className="px-3 py-2">{h.dataFormat}</td>
                <td className="px-3 py-2">{formatBytes(h.fileSize)}</td>
                <td className="px-3 py-2">
                  <span className="text-emerald-400">{h.successCount}</span>
                  {h.errorCount > 0 && (
                    <span className="text-red-400"> / {h.errorCount}</span>
                  )}
                </td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                  アップロード履歴がありません。/upload からファイルをアップロードしてください。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
