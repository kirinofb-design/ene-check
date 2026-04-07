
"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: "24px", fontSize: "14px", color: "#64748b" }}>読み込み中...</div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

function loginErrorMessage(code: string | null): string | null {
  if (!code) return null;
  if (code === "CredentialsSignin")
    return "メールアドレスまたはパスワードが正しくありません。";
  if (code === "Configuration")
    return "認証の設定に問題があります。管理者に連絡してください。";
  return "ログインに失敗しました。もう一度お試しください。";
}

function LoginForm() {
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/reports";
  const urlAuthError = loginErrorMessage(searchParams.get("error"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email || !password) {
      setError("メールアドレスとパスワードを入力してください。");
      return;
    }

    // 絶対URLで渡すと next-auth クライアント側の URL 解析エラーを避けられる。
    const callbackUrl = new URL(from, window.location.origin).href;

    setLoading(true);
    try {
      const result = await signIn("credentials", {
        redirect: false,
        email,
        password,
        callbackUrl,
      });

      if (!result) {
        setError("ログインに失敗しました。もう一度お試しください。");
        return;
      }

      if (result.error) {
        setError("メールアドレスまたはパスワードが正しくありません。");
        return;
      }

      if (result.url) {
        window.location.href = result.url;
        return;
      }

      setError("ログイン結果を取得できませんでした。");
    } catch {
      setError("ログインに失敗しました。もう一度お試しください。");
    } finally {
      setLoading(false);
    }
  }

  const pageStyle = {
    width: "100%",
    maxWidth: "1120px",
    minHeight: "auto",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "flex-start",
    padding: "8px 0",
  } as const;
  const cardStyle = {
    width: "100%",
    maxWidth: "420px",
    border: "1px solid #dbeafe",
    borderRadius: "16px",
    background: "#ffffff",
    boxShadow: "0 14px 30px rgba(15, 23, 42, 0.08)",
    padding: "22px",
    display: "flex",
    flexDirection: "column" as const,
    gap: "14px",
  };
  const titleStyle = {
    margin: 0,
    fontSize: "30px",
    lineHeight: 1.2,
    fontWeight: 800,
    color: "#0f172a",
    letterSpacing: "-0.02em",
  };
  const descStyle = {
    margin: 0,
    fontSize: "13px",
    color: "#475569",
    lineHeight: 1.6,
  };
  const inputStyle = {
    width: "100%",
    borderRadius: "10px",
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    padding: "10px 12px",
    fontSize: "14px",
    color: "#0f172a",
    outline: "none",
  };
  const primaryBtnStyle = {
    width: "100%",
    borderRadius: "10px",
    border: "1px solid #0284c7",
    background: "#0ea5e9",
    padding: "10px 14px",
    fontSize: "14px",
    fontWeight: 700,
    color: "#ffffff",
    cursor: loading ? "not-allowed" : "pointer",
    opacity: loading ? 0.7 : 1,
  };

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <h1 style={titleStyle}>ログイン（F-1）</h1>
        <p style={descStyle}>
          メールアドレスとパスワードでログインしてください。
        </p>

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: "12px" }}>
          {(error || urlAuthError) && (
            <p
              style={{
                margin: 0,
                fontSize: "12px",
                color: "#b91c1c",
                background: "#fee2e2",
                border: "1px solid #fecaca",
                borderRadius: "8px",
                padding: "8px 10px",
              }}
            >
              {error ?? urlAuthError}
            </p>
          )}

          <div style={{ display: "grid", gap: "6px" }}>
            <label style={{ fontSize: "12px", fontWeight: 700, color: "#334155" }}>
              メールアドレス
            </label>
            <input
              type="email"
              style={inputStyle}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div style={{ display: "grid", gap: "6px" }}>
            <label style={{ fontSize: "12px", fontWeight: 700, color: "#334155" }}>
              パスワード
            </label>
            <input
              type="password"
              style={inputStyle}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <p style={{ margin: 0, fontSize: "11px", color: "#64748b" }}>
              パスワードは 8〜128文字の英数字混在で入力してください。
            </p>
          </div>

          <button type="submit" disabled={loading} style={primaryBtnStyle}>
            {loading ? "ログイン中..." : "ログイン"}
          </button>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "12px", color: "#64748b" }}>
            <Link href="/forgot-password" style={{ color: "#0369a1", textDecoration: "none" }}>
              パスワードをお忘れですか？
            </Link>
            <Link href="/signup" style={{ color: "#0369a1", textDecoration: "none" }}>
              新規登録はこちら
            </Link>
          </div>
        </form>

        <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: "10px" }}>
          <p style={{ margin: 0, fontSize: "12px", color: "#64748b" }}>
            テスト用ユーザー:
            {" "}
            <code style={{ fontFamily: "monospace", color: "#0f172a" }}>test@example.com / Test1234</code>
          </p>
        </div>
      </div>
    </div>
  );
}

