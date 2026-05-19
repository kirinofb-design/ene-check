/**
 * 「全データ一括取得」をブラウザからシステム別 API に分割して実行するか。
 *
 * - `NEXT_PUBLIC_COLLECT_ALL_STRATEGY=chunked` … 常に分割（本番相当の安定性）
 * - `NEXT_PUBLIC_COLLECT_ALL_STRATEGY=server` … 常に `POST /api/collect/all` のみ（長 maxDuration の自前ホスト向け）
 * - 未設定 … localhost / 127.0.0.1 / `*.vercel.app` では分割（本番と同じ段階実行）
 * - 上記以外の自前ホストのみサーバ一括
 *
 * 開発でサーバ一括にすると eco→SMA→ラプラス→…→Fusion が 1 リクエストに載り、
 * Fusion がログインループ・タイムアウトで欠損しやすいため localhost も分割を既定にする。
 */
export function shouldUseClientChunkedFullCollect(): boolean {
  if (typeof window === "undefined") return false;
  const mode = process.env.NEXT_PUBLIC_COLLECT_ALL_STRATEGY?.trim().toLowerCase();
  if (mode === "server" || mode === "monolith") return false;
  if (mode === "chunked" || mode === "client" || mode === "split") return true;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h.endsWith(".vercel.app");
}
