# 開発状況（PROGRESS）

最終更新: 2026-04-14

## プロジェクト概要
solarsite-manager: 太陽光発電監視システム統合（Next.js 14 + Prisma + NextAuth + Playwright / Puppeteer）

---

## デプロイ・インフラ
- **GitHub**: `kirinofb-design/ene-check`（アプリは `solarsite-manager` サブディレクトリ）
- **Vercel**: 上記リポジトリ連携、`Root Directory = solarsite-manager`、**Production ビルド成功（Ready）** 確認済み
- **ビルド関連の主な修正（2026-04 頃）**
  - `package.json` の `build`: `prisma generate && next build`
  - `tsconfig.json`: `prisma.config.ts`・`scripts/` を除外（型チェック衝突回避）、`lib` に ES2021（`replaceAll` 等）
  - `/login`: `useSearchParams` を `Suspense` でラップ
  - NextAuth（`src/auth.ts`）: `trustHost: true`、`pages.signIn` / `pages.error` → `/login`（既定 `/api/auth/error` の真っ白回避）
  - その他: Prisma トランザクション型、`logger` / コレクター周りの型、到達不能だった旧 SMA Puppeteer 本体の削除（`runSmaCollector` は `smaCollectorCookie` のみ）
- **接続テスト関連（2026-04 追加）**
  - `next.config.mjs`: `experimental.serverComponentsExternalPackages` に `playwright-core` と `@sparticuz/chromium` を追加
  - `next.config.mjs`: `outputFileTracingIncludes` は **`experimental.outputFileTracingIncludes`** 配下に配置（Next 14.2.35 の警告回避）
  - `src/lib/autoLogin.ts`: `playwright-core` + `@sparticuz/chromium` で実行、Chromium 起動失敗時のエラー詳細を返すよう改善

---

## コレクター実装状況

### ✅ eco-megane（完了）
- `src/lib/ecoMeganeCollector.ts`
- Playwright でログイン → CSV取得 → DailyGeneration に upsert

### ✅ FusionSolar（完了）
- `src/lib/fusionSolarCollector.ts`
- Playwright でログイン → 発電所×月ループ → 日別データ upsert

### ✅ ラプラス／L・eye総合監視（完了）
- `src/lib/laplaceCollector.ts`
- `Site.laplaceCode` で発電所照合（J-023〜J-057）
- 注意: J-023（落居/笠名高圧）は monitoringSystem フィルタを `laplaceCode != null` の全 Site に変更済み

### ✅ Solar Monitor（池新田・本社）- 運用実装
- `src/lib/solarMonitorCollector.ts` / `solarMonitorBaseCollector.ts`
- API: `/api/collect/solar-monitor-sf`
- systemId: `solar-monitor-sf`、monitoringSystem: `solar-monitor`
- `loginUrl`: `…/frontier/pg/hk/HatsudenshoListPage.aspx`（`txtUserName` / `txtPassword` / `btnLogin` 要確認）

### ✅ Solar Monitor（須山）- 完了
- `solarMonitorSeCollector.ts`、API: `/api/collect/solar-monitor-se`
- systemId: `solar-monitor-se`、`loginUrl`: `…/ssm/pg/LoginPage.aspx`
- 発電状況ボタン（`#cphMain_ibtnHatsudenJokyo`）経由で一覧へ（Playwright `waitForSelector` は `state: "visible"`）

### ⬜ SMA Sunny Portal（坂口・大塚）- 保留
- Cookie 注入は環境によりブロックされうるため保留。実行経路は `src/lib/smaCollector.ts` → `smaCollectorCookie.ts`

---

## UI・API
- データ収集: `src/components/reports/DataCollectSection.tsx`（システム別 API へ振り分け、`/api/collect/all` あり）
- Excel: `GET /api/reports/export-excel?month=YYYY-MM`
- レポート・設定まわりの UI 調整を反映
  - タイトル文字色（ダーク背景での可読性）を統一
  - 「設定」「レポート」ナビボタンの文字位置・高さを統一
  - ボタン行→ページタイトル→カードの余白バランスを揃え、ページ間の見え方を統一
- ログイン運用メモ
  - ローカルで `DATABASE_URL` が未設定/不正だと、`/api/auth/signup` と `/api/auth/callback/credentials` が Prisma 初期化エラーで失敗
  - `.env.local`（`DATABASE_URL` / `NEXTAUTH_SECRET` / `NEXTAUTH_URL` / `CREDENTIALS_ENCRYPTION_KEY`）設定後、`npm run dev` 再起動で復旧

---

## 次のタスク（優先順）
1. Solar Monitor SF の日別欠損（例: 25・26 日）の調査
2. 重い収集処理の **Vercel 外実行**（タイムアウト対策）の要否判断
3. ログイン画面の「テスト用ユーザー」表記の扱い整理（接続先 DB 依存のため注記 or 削除）
4. `README.md` の環境説明を現状運用（PostgreSQL 前提）に追随させる

---

## DB・環境メモ
- ローカル: PostgreSQL（Neon など）の `DATABASE_URL` を `.env.local` に設定して運用
- `NEXTAUTH_URL`（例: `http://localhost:3000`）未設定時はヘルスチェックが `ok: false` になりうる
- 認証情報: `MonitoringCredential` に暗号化保存（`CREDENTIALS_ENCRYPTION_KEY` 必須）
- 日付: JST → UTC 00:00 で保存
