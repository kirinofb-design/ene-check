import { prisma } from "@/lib/prisma";
import { AlertList } from "@/components/alerts/AlertList";

export default async function AlertsPage() {
  const [unresolved, resolved] = await Promise.all([
    prisma.alert.findMany({
      where: { resolvedAt: null },
      include: { site: { select: { siteName: true } } },
      orderBy: { detectedAt: "desc" },
    }),
    prisma.alert.findMany({
      where: { resolvedAt: { not: null } },
      include: { site: { select: { siteName: true } } },
      orderBy: { detectedAt: "desc" },
      take: 20,
    }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">アラート一覧（F-9）</h1>
      <p className="text-sm text-slate-400">
        Spec.md セクション 4.2 のアラート検知ルールに基づいて検出された通知です。
      </p>

      <section>
        <h2 className="text-sm font-medium text-slate-300 mb-3">未解決</h2>
        <AlertList alerts={unresolved} resolved={false} />
      </section>

      <section>
        <h2 className="text-sm font-medium text-slate-300 mb-3">解決済み</h2>
        <AlertList alerts={resolved} resolved={true} />
      </section>
    </div>
  );
}
