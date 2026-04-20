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

export function FusionSolarCollectSection() {
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
  const isCappedMessage = (message: string): boolean =>
    message.includes("実行時間の上限") || message.includes("ここまでにしました");

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      const maxAttempts = 4;
      let attempt = 0;
      let totalRecordCount = 0;
      let totalErrorCount = 0;
      let lastRes: Response | null = null;
      let json: {
        ok?: boolean;
        message?: string;
        recordCount?: number;
        errorCount?: number;
        error?: { message?: string };
      } = {};
      while (attempt < maxAttempts) {
        attempt++;
        const res = await fetch("/api/collect/fusion-solar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startDate, endDate }),
        });
        lastRes = res;
        if (res.status === 504) {
          setResult({
            ok: false,
            message:
              "サーバーが応答するまでに時間がかかりすぎました（タイムアウト）。期間を短く分けて再実行するか、時間帯を変えて試してください。",
            recordCount: 0,
            errorCount: 0,
          });
          return;
        }
        json = (await res.json()) as {
          ok?: boolean;
          message?: string;
          recordCount?: number;
          errorCount?: number;
          error?: { message?: string };
        };
        totalRecordCount += typeof json?.recordCount === "number" ? json.recordCount : 0;
        totalErrorCount += typeof json?.errorCount === "number" ? json.errorCount : 0;
        const message =
          typeof json?.message === "string"
            ? json.message
            : typeof json?.error?.message === "string"
              ? json.error.message
              : "実行に失敗しました。";
        const canContinue = res.ok && json?.ok === true && isCappedMessage(message);
        if (!canContinue) break;
      }
      const ok = Boolean(lastRes?.ok) && json?.ok === true;
      const baseMessage =
        typeof json?.message === "string"
          ? json.message
          : typeof json?.error?.message === "string"
            ? json.error.message
            : "実行に失敗しました。";
      setResult({
        ok,
        message:
          attempt > 1
            ? `${baseMessage}（自動再実行 ${attempt} 回 / 累計 保存 ${totalRecordCount} 件・スキップ ${totalErrorCount} 件）`
            : baseMessage,
        recordCount: attempt > 1 ? totalRecordCount : typeof json?.recordCount === "number" ? json.recordCount : 0,
        errorCount: attempt > 1 ? totalErrorCount : typeof json?.errorCount === "number" ? json.errorCount : 0,
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
      <h2 className="text-sm font-medium text-slate-300">FusionSolar データ収集</h2>
      <p className="text-xs text-slate-500">
        期間を指定して FusionSolar から日別の発電所別データを取得し、PCS発電量(kWh)を保存します。
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
          {loading ? "取得中..." : "FusionSolar データ取得"}
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
