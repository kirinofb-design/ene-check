"use client";

import { useEffect, useState } from "react";
import { MONITORING_SYSTEM_PRESETS } from "@/lib/monitoringSystems";

const SYSTEM_LABEL_BY_ID: Record<string, string> = {
  "eco-megane": "eco-megane",
  "fusion-solar": "FusionSolar",
  "sunny-portal": "SMA",
  "grand-arch": "ラプラス",
  "solar-monitor-sf": "SolarMonitor_池新田・本社",
  "solar-monitor-se": "SolarMonitor_須山",
};

type SiteRow = {
  id: string;
  siteName: string;
  monitoringSystem: string;
};

const SYSTEM_SORT_ORDER: Record<string, number> = {
  "eco-megane": 1,
  "fusion-solar": 2,
  "sunny-portal": 3,
  "grand-arch": 4,
  "solar-monitor-sf": 5,
  "solar-monitor-se": 6,
};

export default function AddSitePage() {
  const [siteName, setSiteName] = useState("");
  const [monitoringSystem, setMonitoringSystem] = useState<string>(
    MONITORING_SYSTEM_PRESETS[0]?.id ?? "eco-megane"
  );
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingSites, setLoadingSites] = useState(false);
  const [deletingSiteId, setDeletingSiteId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sortedSites = [...sites].sort((a, b) => {
    const orderA = SYSTEM_SORT_ORDER[a.monitoringSystem] ?? 999;
    const orderB = SYSTEM_SORT_ORDER[b.monitoringSystem] ?? 999;
    if (orderA !== orderB) return orderA - orderB;
    return a.siteName.localeCompare(b.siteName, "ja");
  });

  async function loadSites() {
    setLoadingSites(true);
    try {
      const res = await fetch("/api/sites", { cache: "no-store" });
      const data = await res.json();
      const rows = Array.isArray(data?.data) ? (data.data as SiteRow[]) : [];
      setSites(rows);
    } catch {
      // ignore load error; add form should still work
    } finally {
      setLoadingSites(false);
    }
  }

  useEffect(() => {
    void loadSites();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const name = siteName.trim();
    if (!name || !monitoringSystem) {
      setError("発電所名とシステム名を入力してください。");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteName: name,
          monitoringSystem,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "発電所の追加に失敗しました。");
        return;
      }
      setMessage("発電所を追加しました。Excel出力では既存行の後ろに追加されます。");
      setSiteName("");
      await loadSites();
    } catch {
      setError("通信エラーが発生しました。");
    } finally {
      setLoading(false);
    }
  }

  async function onDeleteSite(site: SiteRow) {
    const ok = window.confirm(`「${site.siteName}」を削除しますか？`);
    if (!ok) return;
    setDeletingSiteId(site.id);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/sites/${site.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error?.message ?? "削除に失敗しました。");
        return;
      }
      setMessage(`「${site.siteName}」を削除しました。`);
      await loadSites();
    } catch {
      setError("削除時に通信エラーが発生しました。");
    } finally {
      setDeletingSiteId(null);
    }
  }

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "1120px",
        minWidth: 0,
        margin: "0",
        paddingTop: "10px",
        display: "flex",
        flexDirection: "column",
        gap: 0,
      }}
    >
      <h1
        style={{
          margin: 0,
          marginBottom: "8px",
          fontSize: "30px",
          lineHeight: 1.2,
          fontWeight: 800,
          letterSpacing: "-0.02em",
        }}
      >
        編集
      </h1>
      <div
        style={{
          display: "flex",
          gap: "12px",
          alignItems: "stretch",
          maxWidth: "812px",
        }}
      >
        <section
          style={{
            width: "400px",
            backgroundColor: "#ffffff",
            borderRadius: "16px",
            border: "1px solid #e2e8f0",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
            padding: "24px",
          }}
        >
          <h2 style={{ margin: 0, marginBottom: "8px", fontSize: "18px", fontWeight: 700, color: "#1e293b" }}>
            発電所追加
          </h2>
          <p style={{ fontSize: "12px", color: "#64748b", marginTop: 0 }}>
            発電所名とシステム名を入力して、新しい発電所を追加します。
          </p>
          <form onSubmit={onSubmit} style={{ display: "grid", gap: "14px" }}>
            <label style={{ fontSize: "12px", fontWeight: 700, color: "#334155" }}>
              発電所名
              <input
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                style={{
                  width: "100%",
                  marginTop: "6px",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: "1px solid #cbd5e1",
                }}
                placeholder="例: 新規発電所A"
              />
            </label>
            <label style={{ fontSize: "12px", fontWeight: 700, color: "#334155" }}>
              システム名
              <select
                value={monitoringSystem}
                onChange={(e) => setMonitoringSystem(e.target.value)}
                style={{
                  width: "100%",
                  marginTop: "6px",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: "1px solid #cbd5e1",
                }}
              >
                {MONITORING_SYSTEM_PRESETS.filter((p) => p.id !== "other").map((p) => (
                  <option key={p.id} value={p.id}>
                    {SYSTEM_LABEL_BY_ID[p.id] ?? p.label}
                  </option>
                ))}
              </select>
            </label>

            {error && <p style={{ margin: 0, color: "#dc2626", fontSize: "12px" }}>{error}</p>}
            {message && <p style={{ margin: 0, color: "#15803d", fontSize: "12px" }}>{message}</p>}

            <button
              type="submit"
              disabled={loading}
              style={{
                padding: "10px 12px",
                borderRadius: "8px",
                border: "none",
                backgroundColor: loading ? "#94a3b8" : "#2563eb",
                color: "#fff",
                fontWeight: 700,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "追加中..." : "発電所を追加"}
            </button>
          </form>
        </section>

        <section
          style={{
            width: "400px",
            backgroundColor: "#ffffff",
            borderRadius: "16px",
            border: "1px solid #e2e8f0",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
            padding: "24px",
          }}
        >
          <h2 style={{ margin: 0, marginBottom: "8px", fontSize: "18px", fontWeight: 700, color: "#1e293b" }}>
            発電所削除
          </h2>
          {loadingSites ? (
            <p style={{ margin: 0, fontSize: "12px", color: "#64748b" }}>読み込み中...</p>
          ) : sites.length === 0 ? (
            <p style={{ margin: 0, fontSize: "12px", color: "#64748b" }}>削除対象がありません。</p>
          ) : (
            <div style={{ display: "grid", gap: "8px", maxHeight: "220px", overflowY: "auto" }}>
              {sortedSites.map((s) => (
                <div
                  key={s.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "8px",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    padding: "8px 10px",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.siteName}
                    </div>
                    <div style={{ fontSize: "11px", color: "#64748b" }}>
                      {SYSTEM_LABEL_BY_ID[s.monitoringSystem] ?? s.monitoringSystem}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteSite(s)}
                    disabled={deletingSiteId === s.id}
                    style={{
                      border: "none",
                      borderRadius: "6px",
                      padding: "6px 10px",
                      backgroundColor: deletingSiteId === s.id ? "#cbd5e1" : "#ef4444",
                      color: "#fff",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: deletingSiteId === s.id ? "not-allowed" : "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {deletingSiteId === s.id ? "削除中..." : "削除"}
                  </button>
                </div>
              ))}
            </div>
          )}
          {(error || message) && (
            <div style={{ marginTop: "10px", display: "grid", gap: "6px" }}>
              {error && <p style={{ margin: 0, color: "#dc2626", fontSize: "12px" }}>{error}</p>}
              {message && <p style={{ margin: 0, color: "#15803d", fontSize: "12px" }}>{message}</p>}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

