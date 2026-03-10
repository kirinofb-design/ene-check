export default function ReportsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">レポート出力（F-12, 将来）</h1>
      <p className="text-sm text-slate-400">
        Spec.md セクション 6.1 `/reports` に対応する画面です。
        Phase 1 では優先度 P1 のため、将来的に CSV / Excel エクスポート UI を実装します。
      </p>
      <div className="rounded-md border border-dashed border-slate-700 p-4 text-xs text-slate-500">
        `/api/reports/export` エンドポイントと連携し、期間・サイト条件を指定してレポートを生成します。
      </div>
    </div>
  );
}

