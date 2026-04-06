import { auth } from "@/auth";
import { redirect } from "next/navigation";
import DataCollectSection from "@/components/reports/DataCollectSection";

/**
 * データ収集UIは `@/components/reports/DataCollectSection` に集約。
 * 一括取得（handleFetchAll 相当）は同コンポーネント内の `runAllCollectors`。
 */
export default async function DataCollectionPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">データ収集</h1>
      <p className="text-sm text-slate-400">
        レポート画面と同じ収集UIです。Solar Monitor はエンドポイントで systemId が分離されます（須山:
        /api/collect/solar-monitor-se、池新田・本社: /api/collect/solar-monitor-sf）。
      </p>
      <DataCollectSection />
    </div>
  );
}
