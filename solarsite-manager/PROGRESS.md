# 開発状況（PROGRESS）

最終更新: 2026-03-30

## プロジェクト概要
solarsite-manager: 太陽光発電監視システム（Next.js + Prisma + Playwright）

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
- 全11サイト登録済み・recordCount 正常確認済み
- 注意: J-023（落居/笠名高圧）は monitoringSystem フィルタを
  `laplaceCode != null` の全Siteに変更済み

### ✅ Solar Monitor（池新田・本社）- 運用実装
- `src/lib/solarMonitorCollector.ts`（共有コア）
- `src/lib/solarMonitorBaseCollector.ts`（ログイン・一覧・レポートDL・XLSXパース）
- `src/app/api/collect/solar-monitor-sf/route.ts`
- systemId: `solar-monitor-sf`（MonitoringCredential）
- monitoringSystem: `solar-monitor`（Site テーブル）
- 対象Site: 池新田南（低圧）／本社（低圧）
- config `loginUrl`: `…/frontier/pg/hk/HatsudenshoListPage.aspx`（要: 画面上に `txtUserName` / `txtPassword` / `btnLogin` があること。無い場合は `LoginPage.aspx` へ変更が必要な可能性あり）

#### 実装内容
- `loginAndOpenSolarMonitorMenu`: ブラウザでフォーム入力 → `btnLogin` クリック → Cookie はコンテキストが保持
- ログイン失敗: `LoginPage.aspx` 残留時に `#lblErrorMessage` をエラー文へ含めて throw（WebForms 文言ではなく URL 前提）
- HKMenuPage では **SF は** `#cphMain_gvList` までそのまま到達（`openPlantListFromMenu = false`）
- 発電所一覧（#cphMain_gvList）から $$eval でリンク取得・siteName 部分一致でクリック
- 2サイト目以降は `collectSolarMonitor` 内で `goBack()` で HKMenu に戻る
- Excel 2段構造（1〜15日 / 16〜31日）対応、`data` シート想定

### ✅ Solar Monitor（須山）- 完了
- 上記と同一の `solarMonitorCollector.ts`（`systemId === "solar-monitor-se"` で分岐）
- `src/lib/solarMonitorSeCollector.ts`（ラッパー）
- `src/app/api/collect/solar-monitor-se/route.ts`
- systemId: `solar-monitor-se`（MonitoringCredential。SF とは別 loginId を想定）
- monitoringSystem: `solar-monitor`（Site テーブル）
- `loginUrl`: `https://solar-monitor.solar-energy.co.jp/ssm/pg/LoginPage.aspx`
- 一覧マッチ: `siteKeyword: "須山"`（例: `Site.siteName` が「須山（高圧）」など）

#### 実装内容
- `solarMonitorBaseCollector.ts` に `loginAndOpenSolarMonitorMenu` を実装
- ASP.NET の PostBack 仕様対応（URL ではなく `form#form1` の `action` で画面判定）
- `openPlantListFromMenu` フラグで SE / SF の画面遷移の差異を吸収
- `linkKeyword`（画面リンク照合）と `siteKeyword`（DB サイト名照合）を分離
- recordCount 27件確認済み（須山（高圧）/ 2026-03）

#### SE 特有フロー
- `openPlantListFromMenu: true` のとき、ログイン後に `#cphMain_ibtnHatsudenJokyo`（発電状況）で一覧へ遷移してから `#cphMain_gvList a` を待つ（SF の HKMenu は一覧付きのためクリック不要）

#### メモ
- 認証情報は発電所・ポータルごとに分かれることが多い。SF 用 ID をそのまま流用しないこと
- 一時デバッグで追加した詳細 `console.log` は削除済み（`[FATAL]` エラーログは維持）

### ⬜ SMA Sunny Portal（坂口・大塚）- 保留
- Cookie注入方式はサーバー側でブロックのため保留中

---

## UI（データ収集ページ）
`src/components/reports/DataCollectSection.tsx`
- eco-megane / FusionSolar / SMA / ラプラス
- Solar Monitor（池新田・本社）: `/api/collect/solar-monitor-sf`
- Solar Monitor（須山）: `/api/collect/solar-monitor-se`

---

## 次のタスク（優先順）
1. 全コレクター一括取得ボタン実装（順番に実行）
2. Solar Monitor SF（池新田・本社）の25日・26日データ欠損の調査

---

## DB・環境メモ
- DB: SQLite（Prisma）
- 認証情報: MonitoringCredential テーブルに暗号化保存（`CREDENTIALS_ENCRYPTION_KEY` 要設定）
- 日付保存: JST → UTC 00:00 変換して保存
