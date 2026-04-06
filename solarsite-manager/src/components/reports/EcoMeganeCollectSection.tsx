"use client";

import { useMemo, useState } from "react";

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstDayOfMonthYmd(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

export function EcoMeganeCollectSection() {
  const defaults = useMemo(() => {
    const end = todayYmd();
    const start = firstDayOfMonthYmd();
    return { start, end };
  }, []);

  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
    recordCount: number;
    errorCount: number;
  } | null>(null);

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/collect/eco-megane", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        recordCount?: number;
        errorCount?: number;
        error?: { message?: string };
      };
      const ok = res.ok && json?.ok === true;
      setResult({
        ok,
        message:
          typeof json?.message === "string"
            ? json.message
            : typeof json?.error?.message === "string"
              ? json.error.message
              : "実行に失敗しました。",
        recordCount: typeof json?.recordCount === "number" ? json.recordCount : 0,
        errorCount: typeof json?.errorCount === "number" ? json.errorCount : 0,
      });
    } catch {
      setResult({
        ok: false,
        message: "ネットワークエラーが発生しました。",
        recordCount: 0,
        errorCount: 0,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-3">
      <h2 className="text-sm font-medium text-slate-300">データ収集</h2>
      <p className="text-xs text-slate-500">
        期間を指定して eco-megane から日別CSVを取得し、発電電力量(kWh)を保存します。
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-200">開始日</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-200">終了日</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500"
          />
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={loading}
          className="rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-60"
        >
          {loading ? "取得中..." : "eco-megane データ取得"}
        </button>
      </div>

      {result && (
        <div
          className={
            result.ok
              ? "text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-900 rounded px-3 py-2"
              : "text-xs text-red-400 bg-red-950/40 border border-red-900 rounded px-3 py-2"
          }
        >
          <div className="font-medium">
            {result.ok ? "成功" : "失敗"}（保存: {result.recordCount}件 / スキップ:{" "}
            {result.errorCount}件）
          </div>
          <div className="mt-1 text-slate-200">{result.message}</div>
        </div>
      )}
    </section>
  );
}

