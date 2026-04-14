"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type ApiGetResult = {
  ok?: boolean;
  exists?: boolean;
  expiresAt?: string;
  expiresInHours?: number;
};

export function SmaCookieForm() {
  const [loading, setLoading] = useState(true);
  const [registered, setRegistered] = useState(false);
  const [expiresInHours, setExpiresInHours] = useState<number | null>(null);
  const [formsLoginValue, setFormsLoginValue] = useState("");
  const [cookieJsonValue, setCookieJsonValue] = useState("");
  const [useCookieJson, setUseCookieJson] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const res = await fetch("/api/sma-cookie");
        const json = (await res.json()) as ApiGetResult & { error?: { message?: string } };
        if (!cancelled) {
          setRegistered(!!json?.exists);
          setExpiresInHours(typeof json?.expiresInHours === "number" ? json.expiresInHours : null);
        }
      } catch {
        if (!cancelled) {
          setRegistered(false);
          setExpiresInHours(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveCookie() {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const body: { formsLogin?: string; cookieJson?: string } = {};
      if (useCookieJson) {
        const raw = cookieJsonValue.trim();
        if (!raw) {
          setError("Cookie の JSON 配列を入力するか、モードを切り替えてください。");
          return;
        }
        body.cookieJson = raw;
      } else {
        const formsLogin = formsLoginValue.trim();
        if (!formsLogin) {
          setError(".SunnyPortalFormsLogin の値を入力してください。");
          return;
        }
        body.formsLogin = formsLogin;
      }

      const res = await fetch("/api/sma-cookie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = (await res.json()) as { ok?: boolean; message?: string; expiresAt?: string; error?: { message?: string } };
      if (!res.ok || json?.ok !== true) {
        setError(json?.error?.message ?? json?.message ?? "保存に失敗しました。");
        return;
      }

      const expiresAt = json?.expiresAt ? new Date(json.expiresAt) : null;
      const hours = expiresAt ? (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60) : null;

      setRegistered(true);
      setExpiresInHours(typeof hours === "number" && !Number.isNaN(hours) ? hours : null);
      setMessage(`Cookie を登録しました（有効期限: ${hours != null ? Math.max(0, Math.round(hours * 10) / 10) : "?"}時間後）。`);
      setModalOpen(false);
    } catch {
      setError("ネットワークエラーが発生しました。");
    } finally {
      setSaving(false);
    }
  }

  const cardStyle = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box" as const,
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    background: "#ffffff",
    padding: "14px",
    boxShadow: "0 2px 8px rgba(15, 23, 42, 0.05)",
  };
  const primaryBtnStyle = {
    borderRadius: "10px",
    border: "1px solid #d97706",
    background: "#f59e0b",
    padding: "8px 12px",
    fontSize: "12px",
    fontWeight: 700,
    color: "#ffffff",
    cursor: "pointer",
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
  const inputStyle = {
    width: "100%",
    minHeight: "100px",
    borderRadius: "10px",
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    padding: "10px 12px",
    fontSize: "14px",
    color: "#0f172a",
    outline: "none",
  };

  return (
    <div
      className="space-y-3"
      style={{ width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box" }}
    >
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-2" style={cardStyle}>
        <div className="flex items-start justify-between gap-3" style={{ minWidth: 0 }}>
          <div className="space-y-1" style={{ minWidth: 0, flex: "1 1 0%" }}>
            <div className="text-sm font-medium text-slate-200" style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>SMA Sunny Portal Cookie（任意）</div>
            <div className="text-xs text-slate-500" style={{ fontSize: "13px", color: "#475569" }}>
              通常は保存済みログイン情報で自動収集します。ここはフォールバック時のみ利用します。
            </div>
            {loading ? null : registered ? (
              <div className="text-xs text-emerald-400">
                登録済み（残り: {expiresInHours != null ? `${Math.max(0, Math.round(expiresInHours * 10) / 10)}時間` : "?"}）
              </div>
            ) : (
              <div className="text-xs text-red-400">未登録</div>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setMessage(null);
              setError(null);
              setModalOpen(true);
              setUseCookieJson(false);
            }}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-60"
            style={primaryBtnStyle}
          >
            Cookie を手動登録
          </button>
        </div>
      </div>

      {message && (
        <div className="text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-900 rounded px-2 py-1">
          {message}
        </div>
      )}
      {error && <div className="text-xs text-red-400 bg-red-950/40 border border-red-900 rounded px-2 py-1">{error}</div>}

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => {
              setModalOpen(false);
            }}
          />
          <div className="relative mx-auto mt-16 max-w-2xl p-4">
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 space-y-4" style={{ border: "1px solid #cbd5e1", borderRadius: "14px", background: "#ffffff", boxShadow: "0 14px 30px rgba(15, 23, 42, 0.25)" }}>
              <div className="space-y-1">
                <div className="text-sm font-medium text-slate-200" style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>SMA Cookie 登録ガイド</div>
                <div className="text-xs text-slate-500" style={{ fontSize: "13px", color: "#475569" }}>
                  `.SunnyPortalFormsLogin` のみ登録します。
                </div>
              </div>

              <div className="text-xs text-slate-300 leading-relaxed space-y-2" style={{ fontSize: "13px", color: "#334155", lineHeight: 1.7 }}>
                <div>手順（簡易）:</div>
                <div>1. Chrome で Sunny Portal にログイン</div>
                <div>2. F12 → Application → Cookies → https://www.sunnyportal.com</div>
                <div>3. `.SunnyPortalFormsLogin` の value だけ貼る、または下の「配列モード」で同サイトの Cookie をまとめて貼る</div>
                <div style={{ marginTop: 8, color: "#b45309" }}>
                  認証だけでは足りない場合は「配列モード」を試してください。DB の Site 名は「坂口（高圧）」「大塚（高圧）」と一致している必要があります。
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer" style={{ fontSize: "13px", color: "#0f172a" }}>
                <input
                  type="checkbox"
                  checked={useCookieJson}
                  onChange={(e) => setUseCookieJson(e.target.checked)}
                />
                Cookie 配列（JSON）で登録する（上級者・セッション維持に有効なことがあります）
              </label>

              {useCookieJson ? (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-200">www.sunnyportal.com の Cookie 配列（JSON）</label>
                  <textarea
                    value={cookieJsonValue}
                    onChange={(e) => setCookieJsonValue(e.target.value)}
                    className="w-full min-h-[140px] rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500"
                    style={{ ...inputStyle, minHeight: "140px", fontFamily: "monospace", fontSize: "12px" }}
                    placeholder='[{"name":"...","value":"...","domain":".sunnyportal.com",...}, ...]'
                  />
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-200">.SunnyPortalFormsLogin（value）</label>
                  <textarea
                    value={formsLoginValue}
                    onChange={(e) => setFormsLoginValue(e.target.value)}
                    className="w-full min-h-[100px] rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-500"
                    style={inputStyle}
                    placeholder="ここに value を貼り付け"
                  />
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                  style={secondaryBtnStyle}
                >
                  キャンセル
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void saveCookie()}
                    disabled={saving}
                    className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-60"
                    style={primaryBtnStyle}
                  >
                    {saving ? "保存中..." : "保存"}
                  </button>
                  <Link
                    href="/reports"
                    className="rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                    style={secondaryBtnStyle}
                  >
                    /reportsへ
                  </Link>
                </div>
              </div>

              <div className="text-[11px] text-slate-500">
                Cookie は期限付きです。期限切れになった場合は再度登録してください。
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

