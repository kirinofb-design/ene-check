"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Site {
  id: string;
  siteName: string;
  location: string | null;
  capacity: number;
  monitoringSystem: string;
  monitoringUrl: string;
  startDate: Date | null;
  expectedAnnualGeneration: number | null;
}

interface Props {
  site: Site;
}

export function SiteEditForm({ site }: Props) {
  const router = useRouter();
  const [siteName, setSiteName] = useState(site.siteName);
  const [location, setLocation] = useState(site.location ?? "");
  const [capacity, setCapacity] = useState<number | "">(site.capacity);
  const [monitoringSystem, setMonitoringSystem] = useState(site.monitoringSystem);
  const [monitoringUrl, setMonitoringUrl] = useState(site.monitoringUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!siteName || !monitoringSystem || !monitoringUrl) {
      setError("サイト名・監視システム・URLは必須です。");
      return;
    }

    const cap = typeof capacity === "number" ? capacity : Number(capacity);
    if (Number.isNaN(cap) || cap < 0) {
      setError("設備容量は0以上の数値を入力してください。");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/sites/${site.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteName,
          location: location || null,
          capacity: cap,
          monitoringSystem,
          monitoringUrl,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? "更新に失敗しました。");
        return;
      }

      router.push(`/sites/${site.id}`);
    } catch {
      setError("ネットワークエラーが発生しました。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-md border border-slate-800 bg-slate-900/60 p-4"
    >
      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-200">サイト名 *</label>
        <input
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500"
          value={siteName}
          onChange={(e) => setSiteName(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-200">所在地</label>
        <input
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-200">設備容量 (kW) *</label>
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
        <label className="text-xs font-medium text-slate-200">監視システム *</label>
        <input
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500"
          value={monitoringSystem}
          onChange={(e) => setMonitoringSystem(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-200">監視システム URL *</label>
        <input
          type="url"
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500"
          value={monitoringUrl}
          onChange={(e) => setMonitoringUrl(e.target.value)}
        />
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
        {loading ? "更新中..." : "更新"}
      </button>
    </form>
  );
}
