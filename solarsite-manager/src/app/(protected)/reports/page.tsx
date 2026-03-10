import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

type SiteSummary = {
  id: string;
  siteName: string;
  totalGeneration: number;
  normalizedKwhPerKw: number | null;
};

function parseDateParam(v: string | null): Date | null {
  if (!v) return null;
  // YYYY-MM-DD のみ許可
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function getSiteSummaries(params: {
  siteId?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
}): Promise<SiteSummary[]> {
  const sites = await prisma.site.findMany({
    orderBy: { siteName: "asc" },
    where: params.siteId ? { id: params.siteId } : undefined,
    include: {
      dailyGenerations: {
        select: { generation: true },
        where:
          params.startDate || params.endDate
            ? {
                date: {
                  gte: params.startDate ?? undefined,
                  lte: params.endDate ?? undefined,
                },
              }
            : undefined,
      },
    },
  });

  return sites.map((s) => {
    const total = s.dailyGenerations.reduce((sum, g) => sum + g.generation, 0);
    const normalized =
      s.capacity > 0 ? total / s.capacity : null; // kWh/kW（期間内合計を容量で割る）
    return {
      id: s.id,
      siteName: s.siteName,
      totalGeneration: total,
      normalizedKwhPerKw: normalized,
    };
  });
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await auth();
  if (!session) redirect("/auth/login");

  const siteId =
    typeof searchParams?.siteId === "string" ? searchParams.siteId : null;
  const startDate = parseDateParam(
    typeof searchParams?.startDate === "string" ? searchParams.startDate : null
  );
  const endDate = parseDateParam(
    typeof searchParams?.endDate === "string" ? searchParams.endDate : null
  );

  const [sites, summaries] = await Promise.all([
    prisma.site.findMany({ select: { id: true, siteName: true } }),
    getSiteSummaries({ siteId, startDate, endDate }),
  ]);

  const exportAction = "/api/reports/export";

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">サイト間比較・レポート（F-11, F-12）</h1>
      <p className="text-sm text-slate-400">
        期間・サイトで絞り込み、累計発電量と容量あたり発電量（kWh/kW）を比較し、CSV でエクスポートできます。
      </p>

      <form
        method="GET"
        action="/reports"
        className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-xs"
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <div className="text-slate-300 font-medium">サイト</div>
            <select
              name="siteId"
              defaultValue={siteId ?? ""}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-50 outline-none focus:border-sky-500"
            >
              <option value="">（全サイト）</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.siteName}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <div className="text-slate-300 font-medium">開始日</div>
            <input
              type="date"
              name="startDate"
              defaultValue={
                typeof searchParams?.startDate === "string"
                  ? searchParams.startDate
                  : ""
              }
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-50 outline-none focus:border-sky-500"
            />
          </div>
          <div className="space-y-1">
            <div className="text-slate-300 font-medium">終了日</div>
            <input
              type="date"
              name="endDate"
              defaultValue={
                typeof searchParams?.endDate === "string"
                  ? searchParams.endDate
                  : ""
              }
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-50 outline-none focus:border-sky-500"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="w-full rounded-md bg-sky-500 px-3 py-2 text-xs font-medium text-white hover:bg-sky-400"
            >
              絞り込み
            </button>
            <a
              href="/reports"
              className="w-full text-center rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800/40"
            >
              クリア
            </a>
          </div>
        </div>
      </form>

      <div className="rounded-lg border border-slate-800 overflow-x-auto">
        <table className="min-w-[720px] w-full text-xs">
          <thead className="bg-slate-900/80">
            <tr className="text-left text-slate-300">
              <th className="px-3 py-2">サイト名</th>
              <th className="px-3 py-2 text-right">累計発電量 (kWh)</th>
              <th className="px-3 py-2 text-right">容量あたり (kWh/kW)</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((s) => (
              <tr key={s.id} className="border-t border-slate-800">
                <td className="px-3 py-2">{s.siteName}</td>
                <td className="px-3 py-2 text-right">
                  {s.totalGeneration.toLocaleString("ja-JP", {
                    maximumFractionDigits: 1,
                  })}
                </td>
                <td className="px-3 py-2 text-right text-slate-200">
                  {s.normalizedKwhPerKw == null
                    ? "-"
                    : s.normalizedKwhPerKw.toLocaleString("ja-JP", {
                        maximumFractionDigits: 2,
                      })}
                </td>
              </tr>
            ))}
            {summaries.length === 0 && (
              <tr>
                <td
                  colSpan={3}
                  className="px-3 py-6 text-center text-slate-500"
                >
                  データがありません。/upload からファイルをアップロードしてください。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form
        action={exportAction}
        method="GET"
        className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-xs"
      >
        <input type="hidden" name="siteId" value={siteId ?? ""} />
        <input
          type="hidden"
          name="startDate"
          value={typeof searchParams?.startDate === "string" ? searchParams.startDate : ""}
        />
        <input
          type="hidden"
          name="endDate"
          value={typeof searchParams?.endDate === "string" ? searchParams.endDate : ""}
        />
        <div className="text-slate-300">
          <div className="font-medium">データエクスポート（絞り込み対応）</div>
          <p className="text-slate-500">
            画面の絞り込み条件で DailyGeneration を CSV でダウンロードします。
          </p>
        </div>
        <button
          type="submit"
          className="rounded-md bg-sky-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-400"
        >
          CSV をダウンロード
        </button>
      </form>
    </div>
  );
}

