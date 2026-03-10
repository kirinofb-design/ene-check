import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { GenerationChart } from "@/components/dashboard/GenerationChart";

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function DashboardPage() {
  const sites = await prisma.site.findMany({ orderBy: { siteName: "asc" } });

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);

  const dailyRecords = await prisma.dailyGeneration.findMany({
    where: {
      date: { gte: start, lte: end },
    },
    orderBy: { date: "asc" },
    include: { site: { select: { siteName: true } } },
  });

  const latestBySite: Record<
    string,
    { siteName: string; date: Date; generation: number; status: string | null }
  > = {};
  for (const site of sites) {
    const latest = await prisma.dailyGeneration.findFirst({
      where: { siteId: site.id },
      orderBy: { date: "desc" },
    });
    latestBySite[site.id] = {
      siteName: site.siteName,
      date: latest?.date ?? new Date(0),
      generation: latest?.generation ?? 0,
      status: latest?.status ?? null,
    };
  }

  const dateSet = new Set<string>();
  const byDate: Record<string, Record<string, number>> = {};
  for (const r of dailyRecords) {
    const d = toYMD(r.date);
    dateSet.add(d);
    if (!byDate[d]) byDate[d] = {};
    byDate[d][r.site.siteName] = r.generation;
  }
  const sortedDates = Array.from(dateSet).sort();
  const chartData = sortedDates.map((d) => {
    const row: Record<string, string | number> = { date: d };
    for (const s of sites) {
      row[s.siteName] = byDate[d]?.[s.siteName] ?? 0;
    }
    return row;
  });

  const alerts = await prisma.alert.findMany({
    where: { resolvedAt: null },
    include: { site: { select: { siteName: true } } },
    orderBy: { detectedAt: "desc" },
    take: 10,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">ダッシュボード（F-5〜F-8）</h1>

      <section>
        <h2 className="text-sm font-medium text-slate-300 mb-3">サイト別最新発電状況</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {sites.map((site) => {
            const info = latestBySite[site.id];
            return (
              <Link
                key={site.id}
                href={`/sites/${site.id}`}
                className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 hover:bg-slate-800/60 transition-colors"
              >
                <div className="text-sm font-medium text-slate-200">{site.siteName}</div>
                <div className="mt-1 text-lg font-semibold text-sky-400">
                  {info?.generation ?? 0} kWh
                </div>
                <div className="text-xs text-slate-500">
                  {info?.date && info.date.getTime() > 0
                    ? toYMD(info.date)
                    : "データなし"}
                </div>
                {info?.status && (
                  <span
                    className={`inline-block mt-1 text-xs px-1.5 py-0.5 rounded ${
                      info.status === "正常"
                        ? "bg-emerald-900/60 text-emerald-300"
                        : "bg-amber-900/60 text-amber-300"
                    }`}
                  >
                    {info.status}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-slate-300 mb-3">日別発電量推移（過去30日）</h2>
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <GenerationChart data={chartData} siteNames={sites.map((s) => s.siteName)} />
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-slate-300">未解決アラート</h2>
          <Link
            href="/alerts"
            className="text-xs text-sky-400 hover:text-sky-300"
          >
            すべて見る
          </Link>
        </div>
        {alerts.length === 0 ? (
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-500">
            未解決のアラートはありません。
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.map((a) => (
              <div
                key={a.id}
                className={`rounded-lg border p-3 text-sm ${
                  a.severity === "CRITICAL"
                    ? "border-red-900/60 bg-red-950/30"
                    : "border-amber-900/60 bg-amber-950/30"
                }`}
              >
                <span className="font-medium text-slate-200">{a.site.siteName}</span>
                <span className="text-slate-400"> — {a.message}</span>
                <div className="text-xs text-slate-500 mt-1">
                  {a.detectedAt.toLocaleString("ja-JP")}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
