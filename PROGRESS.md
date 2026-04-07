# PROGRESS

最終更新: 2026-04-06

> **詳細な開発状況は `solarsite-manager/PROGRESS.md` を参照してください。**

## サマリ
- eco-megane / FusionSolar / ラプラス / Solar Monitor（SF・SE）: 実装済み（詳細はサブプロジェクト側）
- SMA Sunny Portal: Cookie 注入方式はサーバー側制約で保留（`runSmaCollector` は `smaCollectorCookie` 経由）
- **Vercel**: GitHub `ene-check` 連携、`Root Directory: solarsite-manager` で **Production デプロイ成功（Ready）**
- **ローカル認証**: NextAuth（`trustHost`・エラー時 `/login` へ誘導・`?error=` 表示）でログイン確認済み

## 本番・運用メモ（短く）
- Vercel 本番で DB を共有するなら **PostgreSQL 等への移行**が必要（SQLite ファイルはサーバーレスで永続化されにくい）
- ブラウザ自動操作系は Vercel 上では **タイムアウト・制限**に注意（別ホスト・バッチ検討）
