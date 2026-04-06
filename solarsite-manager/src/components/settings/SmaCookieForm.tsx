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
      const formsLogin = formsLoginValue.trim();
      if (!formsLogin) {
        setError(".SunnyPortalFormsLogin の値を入力してください。");
        return;
      }

      const res = await fetch("/api/sma-cookie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formsLogin }),
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
            <div className="text-sm font-medium text-slate-200" style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>SMA Sunny Portal Cookie（Step 2）</div>
            <div className="text-xs text-slate-500" style={{ fontSize: "13px", color: "#475569" }}>
              Cookie を登録すると、/Plants へアクセスしてデータ取得できます。
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
            }}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-60"
            style={primaryBtnStyle}
          >
            SMA Cookie を登録
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
                <div>
                  手順：
                </div>
                <div>
                  1. Chrome で Sunny Portal にログイン
                </div>
                <div>
                  2. F12 → Application → Cookies → https://www.sunnyportal.com
                </div>
                <div>
                  3. `.SunnyPortalFormsLogin` の value をコピーして入力欄に貼り付ける
                </div>
              </div>

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

