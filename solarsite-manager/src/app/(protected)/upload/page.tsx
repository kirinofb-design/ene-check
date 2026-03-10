"use client";

import { useState, useEffect } from "react";

interface Site {
  id: string;
  siteName: string;
}

export default function UploadPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [siteId, setSiteId] = useState<string>("");

  useEffect(() => {
    fetch("/api/sites")
      .then((r) => r.json())
      .then((json) => setSites(json.data ?? []))
      .catch(() => {});
  }, []);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!file) {
      setError("アップロードするファイルを選択してください。");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError("ファイルサイズは 10MB 以内にしてください。");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    if (siteId) formData.append("siteId", siteId);

    setLoading(true);
    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json?.error?.message ?? "アップロードに失敗しました。");
        return;
      }

      const summary = json.data?.summary;
      setResult(
        `合計行数: ${summary.totalRows}, 成功: ${summary.successCount}, エラー: ${summary.errorCount}`
      );
    } catch {
      setError("ネットワークエラーが発生しました。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">データアップロード（F-3, F-4）</h1>
      <p className="text-sm text-slate-400">
        Spec.md セクション 6.1 `/upload` および 10（データ形式仕様）に対応する画面です。
        Excel/CSV ファイルを選択し、発電量データを取り込みます。
      </p>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-md border border-slate-800 bg-slate-900/60 p-4"
      >
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-200">
            対象サイト
          </label>
          <select
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500"
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
          >
            <option value="">未指定（最初のサイトに紐付け）</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.siteName}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-200">
            ファイル選択（.xlsx / .xls / .csv, 10MB 以内）
          </label>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-xs text-slate-300"
          />
        </div>

        {error && (
          <p className="text-xs text-red-400 bg-red-950/40 border border-red-900 rounded px-2 py-1">
            {error}
          </p>
        )}

        {result && (
          <p className="text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-900 rounded px-2 py-1">
            {result}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-60"
        >
          {loading ? "アップロード中..." : "アップロードして取込"}
        </button>
      </form>
    </div>
  );
}

