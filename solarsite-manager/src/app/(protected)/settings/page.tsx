import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export default async function SettingsPage() {
  const session = await auth();

  const sites = await prisma.site.findMany({
    orderBy: { siteName: "asc" },
    select: { id: true, siteName: true },
  });

  const formats = await prisma.customFormat.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">設定</h1>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-300">プロフィール</h2>
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-3 max-w-md">
          <div>
            <span className="text-xs text-slate-500">メールアドレス</span>
            <p className="text-sm text-slate-200">{session?.user?.email ?? "-"}</p>
          </div>
          <div>
            <span className="text-xs text-slate-500">名前</span>
            <p className="text-sm text-slate-200">{session?.user?.name ?? "未設定"}</p>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-300">カスタムフォーマット定義（F-15）</h2>
        <p className="text-xs text-slate-500">
          監視システムごとのカラム名の揺れを吸収するため、日付カラム・発電量カラムの候補を登録できます。
        </p>
        <CustomFormatManager sites={sites} initialFormats={formats} />
      </section>
    </div>
  );
}

"use client";

import { useState } from "react";

type SiteOption = { id: string; siteName: string };
type CustomFormatDto = {
  id: string;
  name: string;
  monitoringSystem: string;
  siteId: string | null;
  isActive: boolean;
  config: string;
};

function parseConfig(config: string): { dateKeys: string; generationKeys: string } {
  try {
    const obj = JSON.parse(config || "{}") as {
      dateKeys?: string[];
      generationKeys?: string[];
    };
    return {
      dateKeys: (obj.dateKeys ?? []).join(","),
      generationKeys: (obj.generationKeys ?? []).join(","),
    };
  } catch {
    return { dateKeys: "", generationKeys: "" };
  }
}

function buildConfig(dateKeys: string, generationKeys: string) {
  const d = dateKeys
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const g = generationKeys
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    dateKeys: d,
    generationKeys: g,
  };
}

function CustomFormatManager({
  sites,
  initialFormats,
}: {
  sites: SiteOption[];
  initialFormats: CustomFormatDto[];
}) {
  const [formats, setFormats] = useState(initialFormats);
  const [name, setName] = useState("");
  const [monitoringSystem, setMonitoringSystem] = useState("");
  const [siteId, setSiteId] = useState<string>("");
  const [dateKeys, setDateKeys] = useState("日付,date,年月日");
  const [generationKeys, setGenerationKeys] = useState(
    "発電量,generation,energy,発電電力量"
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name || !monitoringSystem) {
      setError("名前と監視システムIDは必須です。");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/custom-formats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          monitoringSystem,
          siteId: siteId || null,
          config: buildConfig(dateKeys, generationKeys),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? "作成に失敗しました。");
        return;
      }
      setFormats((prev) => [json.data as CustomFormatDto, ...prev]);
      setName("");
    } catch {
      setError("ネットワークエラーが発生しました。");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(id: string, current: boolean) {
    const res = await fetch(`/api/custom-formats/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !current }),
    });
    const json = await res.json();
    if (res.ok) {
      setFormats((prev) => prev.map((f) => (f.id === id ? (json.data as CustomFormatDto) : f)));
    }
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleCreate}
        className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-xs max-w-2xl"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <div className="text-slate-300 font-medium">名前 *</div>
            <input
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-50 outline-none focus:border-sky-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <div className="text-slate-300 font-medium">監視システムID *</div>
            <input
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-50 outline-none focus:border-sky-500"
              placeholder="eco-megane / fusion-solar など"
              value={monitoringSystem}
              onChange={(e) => setMonitoringSystem(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <div className="text-slate-300 font-medium">対象サイト（任意）</div>
            <select
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-50 outline-none focus:border-sky-500"
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
            >
              <option value="">（全サイト共通）</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.siteName}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="text-slate-300 font-medium">日付カラム候補（カンマ区切り）</div>
            <input
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-50 outline-none focus:border-sky-500"
              value={dateKeys}
              onChange={(e) => setDateKeys(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <div className="text-slate-300 font-medium">発電量カラム候補（カンマ区切り）</div>
            <input
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-50 outline-none focus:border-sky-500"
              value={generationKeys}
              onChange={(e) => setGenerationKeys(e.target.value)}
            />
          </div>
        </div>
        {error && (
          <p className="text-xs text-red-400 bg-red-950/40 border border-red-900 rounded px-2 py-1">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-sky-500 px-3 py-2 text-xs font-medium text-white hover:bg-sky-400 disabled:opacity-60"
        >
          {saving ? "保存中..." : "カスタムフォーマットを追加"}
        </button>
      </form>

      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-medium text-slate-300">最近追加したフォーマット</div>
          <span className="text-[10px] text-slate-500">
            最大 {formats.length} 件を表示（新しい順）
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[720px] w-full text-xs">
            <thead className="bg-slate-900/80">
              <tr className="text-left text-slate-300">
                <th className="px-2 py-1">名前</th>
                <th className="px-2 py-1">監視システムID</th>
                <th className="px-2 py-1">サイト</th>
                <th className="px-2 py-1">日付カラム</th>
                <th className="px-2 py-1">発電量カラム</th>
                <th className="px-2 py-1 text-center">有効</th>
              </tr>
            </thead>
            <tbody>
              {formats.map((f) => {
                const cfg = parseConfig(f.config);
                const siteLabel =
                  f.siteId && sites.find((s) => s.id === f.siteId)?.siteName;
                return (
                  <tr key={f.id} className="border-t border-slate-800">
                    <td className="px-2 py-1">{f.name}</td>
                    <td className="px-2 py-1">{f.monitoringSystem}</td>
                    <td className="px-2 py-1">{siteLabel ?? "全サイト"}</td>
                    <td className="px-2 py-1">{cfg.dateKeys}</td>
                    <td className="px-2 py-1">{cfg.generationKeys}</td>
                    <td className="px-2 py-1 text-center">
                      <button
                        type="button"
                        onClick={() => toggleActive(f.id, f.isActive)}
                        className={`inline-flex items-center justify-center rounded px-2 py-0.5 text-[10px] ${
                          f.isActive
                            ? "bg-emerald-900/60 text-emerald-300"
                            : "bg-slate-800/60 text-slate-400"
                        }`}
                      >
                        {f.isActive ? "ON" : "OFF"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {formats.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-2 py-4 text-center text-slate-500"
                  >
                    まだカスタムフォーマットは登録されていません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
