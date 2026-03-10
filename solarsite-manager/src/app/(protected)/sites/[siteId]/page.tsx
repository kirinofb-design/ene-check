import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function SiteDetailPage({
  params,
}: {
  params: { siteId: string };
}) {
  const site = await prisma.site.findUnique({
    where: { id: params.siteId },
    include: {
      dailyGenerations: {
        orderBy: { date: "desc" },
        take: 30,
      },
    },
  });

  if (!site) notFound();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{site.siteName}</h1>
        <div className="flex items-center gap-2">
          <Link
            href={`/sites/${site.id}/edit`}
            className="text-xs text-sky-400 hover:text-sky-300"
          >
            編集
          </Link>
          <Link
            href="/sites"
            className="text-xs text-slate-400 hover:text-slate-300"
          >
            ← 一覧へ
          </Link>
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-2 text-sm">
        <div><span className="text-slate-500">所在地:</span> {site.location ?? "未設定"}</div>
        <div><span className="text-slate-500">設備容量:</span> {site.capacity} kW</div>
        <div><span className="text-slate-500">監視システム:</span> {site.monitoringSystem}</div>
        <a
          href={site.monitoringUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sky-400 hover:text-sky-300"
        >
          監視URLを開く
        </a>
      </div>

      <section>
        <h2 className="text-sm font-medium text-slate-300 mb-2">直近の発電量データ</h2>
        <div className="rounded-lg border border-slate-800 overflow-x-auto">
          <table className="min-w-[520px] w-full text-xs">
            <thead className="bg-slate-900/80">
              <tr className="text-left text-slate-300">
                <th className="px-3 py-2">日付</th>
                <th className="px-3 py-2">発電量 (kWh)</th>
                <th className="px-3 py-2">ステータス</th>
              </tr>
            </thead>
            <tbody>
              {site.dailyGenerations.map((g) => (
                <tr key={g.id} className="border-t border-slate-800">
                  <td className="px-3 py-2">
                    {g.date.toISOString().slice(0, 10)}
                  </td>
                  <td className="px-3 py-2">{g.generation}</td>
                  <td className="px-3 py-2">{g.status ?? "-"}</td>
                </tr>
              ))}
              {site.dailyGenerations.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-center text-slate-500">
                    データがありません。/upload からファイルをアップロードしてください。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
