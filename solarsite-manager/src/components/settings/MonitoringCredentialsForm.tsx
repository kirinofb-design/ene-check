"use client";

import { useEffect, useMemo, useState } from "react";
import {
  MONITORING_AUTH_TARGETS,
  type MonitoringSystemAuthTarget,
} from "@/lib/monitoringSystemsAuth";

type CredentialRow = {
  systemId: string;
  loginId: string;
  updatedAt: string;
};

type RowState = {
  loginId: string;
  password: string;
  savedLoginId?: string;
  savedAt?: string;
};

export function MonitoringCredentialsForm() {
  const targets = useMemo(() => MONITORING_AUTH_TARGETS, []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [testLoading, setTestLoading] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<
    Record<string, { ok: boolean; message: string } | null>
  >({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/monitoring-credentials");
        const json = await res.json();
        if (!res.ok) {
          setError(json?.error?.message ?? "取得に失敗しました。");
          return;
        }
        const list = (json?.data ?? []) as CredentialRow[];
        const next: Record<string, RowState> = {};
        for (const t of targets) {
          const hit = list.find((c) => c.systemId === t.systemId);
          next[t.systemId] = {
            loginId: hit?.loginId ?? "",
            password: "",
            savedLoginId: hit?.loginId,
            savedAt: hit?.updatedAt,
          };
        }
        if (!cancelled) setRows(next);
      } catch {
        if (!cancelled) setError("ネットワークエラーが発生しました。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [targets]);

  async function saveOne(systemId: string) {
    setOk(null);
    setError(null);
    setSaving(systemId);
    try {
      const row = rows[systemId];
      const res = await fetch("/api/monitoring-credentials", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemId,
          loginId: row?.loginId ?? "",
          password: row?.password ?? "",
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? "保存に失敗しました。");
        return;
      }
      const updated = json.data as { loginId: string; updatedAt: string };
      setRows((prev) => ({
        ...prev,
        [systemId]: {
          ...prev[systemId],
          password: "",
          savedLoginId: updated.loginId,
          savedAt: updated.updatedAt,
        },
      }));
      setOk("保存しました。");
    } catch {
      setError("ネットワークエラーが発生しました。");
    } finally {
      setSaving(null);
    }
  }

  async function testConnection(systemId: string) {
    setTestResult((prev) => ({ ...prev, [systemId]: null }));
    setTestLoading(systemId);
    try {
      const res = await fetch("/api/auto-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemId }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: { message?: string };
      };
      const resultOk = res.ok && json?.ok === true;
      const resultMessage =
        typeof json?.message === "string"
          ? json.message
          : typeof json?.error?.message === "string"
            ? json.error.message
            : "接続テストに失敗しました。";
      setTestResult((prev) => ({
        ...prev,
        [systemId]: { ok: resultOk, message: resultMessage },
      }));
    } catch {
      setTestResult((prev) => ({
        ...prev,
        [systemId]: { ok: false, message: "ネットワークエラーが発生しました。" },
      }));
    } finally {
      setTestLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="text-xs text-slate-500" style={{ fontSize: "13px", color: "#64748b" }}>
        認証情報を読み込み中...
      </div>
    );
  }

  const cardStyle = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box" as const,
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    background: "#ffffff",
    padding: "10px",
    boxShadow: "0 2px 8px rgba(15, 23, 42, 0.05)",
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px",
  };
  const inputStyle = {
    width: "100%",
    maxWidth: "100%",
    boxSizing: "border-box" as const,
    borderRadius: "10px",
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    padding: "7px 10px",
    fontSize: "13px",
    color: "#0f172a",
    outline: "none",
    height: "36px",
  };
  const secondaryBtnStyle = {
    borderRadius: "10px",
    border: "1px solid #94a3b8",
    background: "#f8fafc",
    padding: "8px 12px",
    fontSize: "12px",
    fontWeight: 700,
    color: "#334155",
    cursor: "pointer",
  };
  const primaryBtnStyle = {
    borderRadius: "10px",
    border: "1px solid #0284c7",
    background: "#0ea5e9",
    padding: "8px 12px",
    fontSize: "12px",
    fontWeight: 700,
    color: "#ffffff",
    cursor: "pointer",
  };
  const orderedTargetIds: MonitoringSystemAuthTarget["systemId"][] = [
    "eco-megane",
    "fusion-solar",
    "sunny-portal",
    "grand-arch",
    "solar-monitor-sf",
    "solar-monitor-se",
  ];
  const targetById = new Map(targets.map((t) => [t.systemId, t]));
  const orderedTargets = [
    ...orderedTargetIds.map((id) => targetById.get(id)).filter(Boolean),
    ...targets.filter((t) => !orderedTargetIds.includes(t.systemId)),
  ];

  return (
    <div
      className="space-y-3"
      style={{ width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box" }}
    >
      <p style={{ margin: "6px 0 0", fontSize: "12px", color: "#64748b", lineHeight: 1.6 }}>
        パスワードは暗号化して保存します。保存後は復号して画面表示しません（再入力で上書き更新します）。
      </p>

      {error && (
        <p className="text-xs text-red-400 bg-red-950/40 border border-red-900 rounded px-2 py-1">
          {error}
        </p>
      )}
      {ok && (
        <p className="text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-900 rounded px-2 py-1">
          {ok}
        </p>
      )}

      <div className="settings-credential-grid" style={{ width: "100%", minWidth: 0 }}>
        {orderedTargets.map((t) => {
          const row = rows[t!.systemId] ?? { loginId: "", password: "" };
          const saved = row.savedLoginId ? `登録済み（ID: ${row.savedLoginId}）` : "未登録";
          return (
            <div
              key={t!.systemId}
              className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-3"
              style={cardStyle}
            >
                  <div className="space-y-1" style={{ minWidth: 0 }}>
                    <div className="text-sm font-medium text-slate-200" style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>{t!.label}</div>
                    <a
                      href={t!.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-sky-400 hover:text-sky-300 break-all"
                      style={{
                        fontSize: "13px",
                        color: "#0284c7",
                        textDecoration: "underline",
                        wordBreak: "break-all",
                      }}
                    >
                      {t!.url}
                    </a>
                    <div className="text-[10px] text-slate-500" style={{ fontSize: "12px", color: "#64748b" }}>{saved}</div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => testConnection(t!.systemId)}
                      disabled={testLoading === t!.systemId}
                      className="rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-60"
                      style={secondaryBtnStyle}
                    >
                      {testLoading === t!.systemId ? "テスト中..." : "接続テスト"}
                    </button>
                    <button
                      type="button"
                      onClick={() => saveOne(t!.systemId)}
                      disabled={saving === t!.systemId}
                      className="rounded-md bg-sky-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-400 disabled:opacity-60"
                      style={primaryBtnStyle}
                    >
                      {saving === t!.systemId ? "保存中..." : "保存"}
                    </button>
                  </div>

                  {testLoading === t!.systemId && (
                    <span className="text-xs text-slate-400">接続テスト実行中...</span>
                  )}
                  {testLoading !== t!.systemId && (() => {
                    const rowResult = testResult[t!.systemId];
                    if (rowResult == null) return null;
                    return (
                      <span
                        className={
                          rowResult.ok
                            ? "text-xs text-emerald-400"
                            : "text-xs text-red-400"
                        }
                        style={{ wordBreak: "break-word", maxWidth: "100%" }}
                      >
                        {rowResult.ok ? "成功: " : "失敗: "}
                        {rowResult.message}
                      </span>
                    );
                  })()}

                  <div className="settings-credential-fields">
                    <div className="space-y-1" style={{ minWidth: 0 }}>
                      <label className="text-xs font-medium text-slate-200">
                        ログインID
                      </label>
                      <input
                        className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500"
                        style={inputStyle}
                        value={row.loginId}
                        onChange={(e) =>
                          setRows((prev) => ({
                            ...prev,
                            [t!.systemId]: { ...prev[t!.systemId], loginId: e.target.value },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1" style={{ minWidth: 0 }}>
                      <label className="text-xs font-medium text-slate-200">
                        パスワード（上書き保存）
                      </label>
                      <input
                        type="password"
                        className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500"
                        style={inputStyle}
                        value={row.password}
                        onChange={(e) =>
                          setRows((prev) => ({
                            ...prev,
                            [t!.systemId]: { ...prev[t!.systemId], password: e.target.value },
                          }))
                        }
                      />
                    </div>
                  </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

