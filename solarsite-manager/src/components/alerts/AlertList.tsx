"use client";

import { useState } from "react";

interface AlertWithSite {
  id: string;
  siteId: string;
  alertType: string;
  severity: string;
  message: string;
  detectedAt: Date;
  resolvedAt: Date | null;
  site: { siteName: string };
}

interface Props {
  alerts: (Omit<AlertWithSite, "detectedAt" | "resolvedAt"> & {
    detectedAt: string | Date;
    resolvedAt: string | Date | null;
  })[];
  resolved: boolean;
}

export function AlertList({ alerts, resolved }: Props) {
  const [updating, setUpdating] = useState<Set<string>>(new Set());

  async function handleResolve(id: string) {
    setUpdating((s) => new Set(s).add(id));
    try {
      await fetch(`/api/alerts/${id}/resolve`, { method: "PATCH" });
      window.location.reload();
    } finally {
      setUpdating((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  }

  if (alerts.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-500">
        {resolved ? "解決済みアラートはありません。" : "未解決のアラートはありません。"}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {alerts.map((a) => (
        <div
          key={a.id}
          className={`rounded-lg border p-3 flex items-start justify-between gap-3 ${
            a.severity === "CRITICAL"
              ? "border-red-900/60 bg-red-950/30"
              : "border-amber-900/60 bg-amber-950/30"
          }`}
        >
          <div>
            <span className="font-medium text-slate-200">{a.site.siteName}</span>
            <span className="text-slate-400"> — {a.message}</span>
            <div className="text-xs text-slate-500 mt-1">
              {new Date(a.detectedAt).toLocaleString("ja-JP")}
              {resolved && a.resolvedAt && (
                <> ・解決: {new Date(a.resolvedAt).toLocaleString("ja-JP")}</>
              )}
            </div>
          </div>
          {!resolved && (
            <button
              onClick={() => handleResolve(a.id)}
              disabled={updating.has(a.id)}
              className="shrink-0 rounded bg-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-50"
            >
              {updating.has(a.id) ? "処理中..." : "解決済みにする"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
