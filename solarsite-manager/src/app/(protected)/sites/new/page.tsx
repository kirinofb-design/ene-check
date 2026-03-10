"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MONITORING_SYSTEM_PRESETS, resolvePreset } from "@/lib/monitoringSystems";

export default function NewSitePage() {
  const router = useRouter();
  const [siteName, setSiteName] = useState("");
  const [location, setLocation] = useState("");
  const [capacity, setCapacity] = useState<number | "">("");
  const [monitoringSystem, setMonitoringSystem] = useState<string>(
    MONITORING_SYSTEM_PRESETS[0]?.id ?? "other"
  );
  const [monitoringUrl, setMonitoringUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSelectMonitoringSystem(next: string) {
    setMonitoringSystem(next);
    const preset = resolvePreset(next);
    if (preset?.defaultUrl) {
      setMonitoringUrl(preset.defaultUrl);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!siteName || !capacity || !monitoringSystem || !monitoringUrl) {
      setError("必須項目を入力してください。");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteName,
          location: location || null,
          capacity: typeof capacity === "string" ? Number(capacity) : capacity,
          monitoringSystem,
          monitoringUrl,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? "サイト登録に失敗しました。");
        return;
      }

      router.push("/sites");
    } catch {
      setError("ネットワークエラーが発生しました。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">サイト新規登録 (/sites/new)</h1>
      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-md border border-slate-800 bg-slate-900/60 p-4"
      >
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-200">
            サイト名 *
          </label>
          <input
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500"
            value={siteName}
            onChange={(e) => setSiteName(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-200">
            所在地（任意）
          </label>
          <input
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-200">
            設備容量 (kW) *
          </label>
          <input
            type="number"
            min={0}
            step="0.1"
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500"
            value={capacity}
            onChange={(e) =>
              setCapacity(e.target.value === "" ? "" : Number(e.target.value))
            }
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-200">
            監視システム *
          </label>
          <select
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500"
            value={monitoringSystem}
            onChange={(e) => handleSelectMonitoringSystem(e.target.value)}
          >
            {MONITORING_SYSTEM_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-200">
            監視システム URL *
          </label>
          <input
            type="url"
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500"
            value={monitoringUrl}
            onChange={(e) => setMonitoringUrl(e.target.value)}
          />
          <p className="text-[10px] text-slate-500">
            プリセットを選ぶとURLが自動入力されます（必要なら上書き可）。
          </p>
        </div>

        {error && (
          <p className="text-xs text-red-400 bg-red-950/40 border border-red-900 rounded px-2 py-1">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-60"
        >
          {loading ? "登録中..." : "登録"}
        </button>
      </form>
    </div>
  );
}

