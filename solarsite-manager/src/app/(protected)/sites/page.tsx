import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function SitesPage() {
  const sites = await prisma.site.findMany({
    orderBy: { siteName: "asc" },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">サイト一覧・管理（F-2）</h1>
          <p className="text-sm text-slate-400">
            Spec.md セクション 6.1 `/sites` とサイトマスタ管理機能に対応します。
          </p>
        </div>
        <Link
          href="/sites/new"
          className="rounded-md bg-sky-500 px-3 py-2 text-xs font-medium text-white hover:bg-sky-400"
        >
          新規登録
        </Link>
      </div>

      <div className="overflow-hidden rounded-md border border-slate-800 bg-slate-900/60">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-900/80">
            <tr className="text-left text-slate-300">
              <th className="px-3 py-2">サイト名</th>
              <th className="px-3 py-2">所在地</th>
              <th className="px-3 py-2">設備容量 (kW)</th>
              <th className="px-3 py-2">監視システム</th>
              <th className="px-3 py-2">監視URL</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((site) => (
              <tr
                key={site.id}
                className="border-t border-slate-800 hover:bg-slate-800/40"
              >
                <td className="px-3 py-2">{site.siteName}</td>
                <td className="px-3 py-2">{site.location ?? "-"}</td>
                <td className="px-3 py-2">{site.capacity}</td>
                <td className="px-3 py-2">{site.monitoringSystem}</td>
                <td className="px-3 py-2">
                  <a
                    href={site.monitoringUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-400 hover:text-sky-300 underline-offset-2 hover:underline"
                  >
                    リンク
                  </a>
                </td>
              </tr>
            ))}
            {sites.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-4 text-center text-slate-500 text-xs"
                >
                  登録されているサイトがありません。「新規登録」から追加してください。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

