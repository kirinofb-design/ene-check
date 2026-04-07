"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  /** ページ表示のたびに変わる name で、保存済みサイトログインとの自動入力マッチを避ける */
  const [autofillFieldKey] = useState(() => {
    const c = globalThis.crypto;
    return typeof c?.randomUUID === "function"
      ? c.randomUUID()
      : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [testLoading, setTestLoading] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<
    Record<string, { ok: boolean; message: string } | null>
  >({});
  /** 初期表示では入力欄を DOM に出さない（ブラウザがサイトログインを誤自動入力しないようにする） */
  const [credentialFieldsOpen, setCredentialFieldsOpen] = useState<
    Record<string, boolean>
  >({});
  /** 開くたびに増やして入力欄をマウントし直す */
  const [credentialFieldMountGen, setCredentialFieldMountGen] = useState<
    Record<string, number>
  >({});
  /** ユーザーが監視サイト欄を編集したら、遅延ストリップで消さない */
  const userEditedCredRef = useRef(false);
  /** Chrome 等: text + -webkit-text-security でパスワード型の自動入力を避ける。未対応ブラウザは type=password */
  const [secretFieldKind, setSecretFieldKind] = useState<"disc-text" | "password">(
    "password"
  );

  useEffect(() => {
    if (
      typeof CSS !== "undefined" &&
      CSS.supports("-webkit-text-security", "disc")
    ) {
      setSecretFieldKind("disc-text");
    }
  }, []);

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

  useLayoutEffect(() => {
    const openIds = Object.keys(credentialFieldsOpen).filter(
      (k) => credentialFieldsOpen[k]
    );
    if (openIds.length === 0) return;

    const stripAutofill = () => {
      if (userEditedCredRef.current) return;
      setRows((prev) => {
        let next = { ...prev };
        let changed = false;
        for (const id of openIds) {
          const r = next[id];
          if (!r) continue;
          const wantLogin = r.savedLoginId ?? "";
          if (r.loginId !== wantLogin || r.password !== "") {
            next[id] = { ...r, loginId: wantLogin, password: "" };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    };

    const h0 = requestAnimationFrame(() => {
      requestAnimationFrame(stripAutofill);
    });
    const h1 = setTimeout(stripAutofill, 80);
    const h2 = setTimeout(stripAutofill, 220);
    const h3 = setTimeout(stripAutofill, 500);
    return () => {
      cancelAnimationFrame(h0);
      clearTimeout(h1);
      clearTimeout(h2);
      clearTimeout(h3);
    };
  }, [credentialFieldMountGen, credentialFieldsOpen]);

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
      setCredentialFieldsOpen((prev) => ({ ...prev, [systemId]: false }));
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

  function openCredentialFields(systemId: string) {
    userEditedCredRef.current = false;
    setCredentialFieldMountGen((prev) => ({
      ...prev,
      [systemId]: (prev[systemId] ?? 0) + 1,
    }));
    setCredentialFieldsOpen((prev) => ({ ...prev, [systemId]: true }));
    setRows((prev) => {
      const r = prev[systemId];
      if (!r) return prev;
      return {
        ...prev,
        [systemId]: {
          ...r,
          loginId: r.savedLoginId ?? "",
          password: "",
        },
      };
    });
  }

  function closeCredentialFields(systemId: string) {
    setCredentialFieldsOpen((prev) => ({ ...prev, [systemId]: false }));
    setRows((prev) => ({
      ...prev,
      [systemId]: { ...prev[systemId], password: "" },
    }));
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
        <br />
        各カードの「監視サイトの ID・パスワードを入力」から入力欄を開いてください（ブラウザの自動入力ミスを防ぐため、最初から欄は表示しません）。
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

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => testConnection(t!.systemId)}
                      disabled={testLoading === t!.systemId}
                      className="rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-60"
                      style={secondaryBtnStyle}
                    >
                      {testLoading === t!.systemId ? "テスト中..." : "接続テスト"}
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

                  {!credentialFieldsOpen[t!.systemId] ? (
                    <button
                      type="button"
                      onClick={() => openCredentialFields(t!.systemId)}
                      className="w-full rounded-md border border-slate-600 bg-slate-100 px-3 py-2 text-left text-xs font-bold text-slate-800 hover:bg-slate-200"
                      style={{
                        ...secondaryBtnStyle,
                        width: "100%",
                        textAlign: "center" as const,
                        fontWeight: 700,
                      }}
                    >
                      監視サイトの ID・パスワードを入力
                    </button>
                  ) : (
                    <>
                      <form
                        key={`cred-${t!.systemId}-${credentialFieldMountGen[t!.systemId] ?? 0}-${autofillFieldKey}`}
                        className="settings-credential-fields"
                        autoComplete="off"
                        onSubmit={(e) => e.preventDefault()}
                      >
                        <div className="space-y-1" style={{ minWidth: 0 }}>
                          <label
                            className="text-xs font-medium text-slate-200"
                            htmlFor={`monitor-cred-${t!.systemId}-login`}
                          >
                            ログインID
                          </label>
                          <input
                            id={`monitor-cred-${t!.systemId}-login`}
                            name={`mon-${autofillFieldKey}-${t!.systemId}-login`}
                            type="text"
                            inputMode="text"
                            autoCapitalize="off"
                            autoCorrect="off"
                            spellCheck={false}
                            data-lpignore="true"
                            data-1p-ignore="true"
                            data-bwignore
                            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500"
                            style={inputStyle}
                            value={row.loginId}
                            autoComplete="off"
                            onChange={(e) => {
                              userEditedCredRef.current = true;
                              setRows((prev) => ({
                                ...prev,
                                [t!.systemId]: {
                                  ...prev[t!.systemId],
                                  loginId: e.target.value,
                                },
                              }));
                            }}
                          />
                        </div>
                        <div className="space-y-1" style={{ minWidth: 0 }}>
                          <label
                            className="text-xs font-medium text-slate-200"
                            htmlFor={`monitor-cred-${t!.systemId}-password`}
                          >
                            パスワード（上書き保存）
                          </label>
                          {secretFieldKind === "disc-text" ? (
                            <input
                              id={`monitor-cred-${t!.systemId}-password`}
                              name={`mon-${autofillFieldKey}-${t!.systemId}-secret`}
                              type="text"
                              className="monitoring-secret-input w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500"
                              style={inputStyle}
                              value={row.password}
                              autoComplete="off"
                              data-lpignore="true"
                              data-1p-ignore="true"
                              data-bwignore
                              onChange={(e) => {
                                userEditedCredRef.current = true;
                                setRows((prev) => ({
                                  ...prev,
                                  [t!.systemId]: {
                                    ...prev[t!.systemId],
                                    password: e.target.value,
                                  },
                                }));
                              }}
                            />
                          ) : (
                            <input
                              id={`monitor-cred-${t!.systemId}-password`}
                              name={`mon-${autofillFieldKey}-${t!.systemId}-secret`}
                              type="password"
                              data-lpignore="true"
                              data-1p-ignore="true"
                              data-bwignore
                              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500"
                              style={inputStyle}
                              value={row.password}
                              autoComplete="new-password"
                              onChange={(e) => {
                                userEditedCredRef.current = true;
                                setRows((prev) => ({
                                  ...prev,
                                  [t!.systemId]: {
                                    ...prev[t!.systemId],
                                    password: e.target.value,
                                  },
                                }));
                              }}
                            />
                          )}
                        </div>
                      </form>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => saveOne(t!.systemId)}
                          disabled={saving === t!.systemId}
                          className="rounded-md bg-sky-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-400 disabled:opacity-60"
                          style={primaryBtnStyle}
                        >
                          {saving === t!.systemId ? "保存中..." : "保存"}
                        </button>
                        <button
                          type="button"
                          onClick={() => closeCredentialFields(t!.systemId)}
                          className="rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                          style={secondaryBtnStyle}
                        >
                          入力欄を閉じる
                        </button>
                      </div>
                    </>
                  )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

