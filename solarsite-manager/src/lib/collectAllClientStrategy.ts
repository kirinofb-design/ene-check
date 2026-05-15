/**
 * 「全データ一括取得」をブラウザからシステム別 API に分割して実行するか。
 *
 * - `NEXT_PUBLIC_COLLECT_ALL_STRATEGY=chunked` … 常に分割（本番相当の安定性）
 * - `NEXT_PUBLIC_COLLECT_ALL_STRATEGY=server` … 常に `POST /api/collect/all` のみ（長 maxDuration の自前ホスト向け）
 * - 未設定 … `*.vercel.app` では分割、それ以外はサーバ一括
 *
 * 本番 Vercel はゲートウェイが先に 504 になることが多く、開発（localhost）と挙動が分かれやすい。
 */
export function shouldUseClientChunkedFullCollect(): boolean {
  if (typeof window === "undefined") return false;
  const mode = process.env.NEXT_PUBLIC_COLLECT_ALL_STRATEGY?.trim().toLowerCase();
  if (mode === "server" || mode === "monolith") return false;
  if (mode === "chunked" || mode === "client" || mode === "split") return true;
  const h = window.location.hostname;
  return h.endsWith(".vercel.app");
}
