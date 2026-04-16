# 運用メモ（データ一括取得）

最終更新: 2026-04-15

## 1) まず見るポイント

- `全データ一括取得` のダイアログで、失敗システム名とメッセージを確認する
- 開発ログでは `/api/collect/all` の所要時間と、各 collector の進捗ログを確認する
- DB接続エラー（`Can't reach database server ...`）はコード不具合ではなく、接続断が原因

## 2) 再発時の切り分け手順

1. **DB到達性**
   - エラーが `PrismaClientInitializationError` / `Can't reach database server` の場合、まず再実行
   - 数回失敗する場合は Neon 側状態・ネットワーク（VPN/社内NW）を確認

2. **SMA**
   - Day→Month 遷移、画像マップ抽出のログ有無を確認
   - 目印ログ:
     - `smaCollector: using image map extracted rows`
     - `smaCollector: extracted table rows`

3. **ラプラス**
   - `laplaceCollector: month processed` の `recordCount` / `errorCount` を確認
   - `laplaceCode` 未設定サイトはフォールバック辞書で補完される

4. **Solar Monitor**
   - `solar-monitor` / `solar-monitor-sf` / `solar-monitor-se` の混在を許容する実装
   - `month processed` の件数を確認

## 3) 現在の恒久対策

- `all` API:
  - 6システム同時実行（`Promise.all`）
  - 実行前に DB 到達確認（`SELECT 1`）+ リトライ
- `SMA`:
  - Cookie同意バナー回避
  - Month遷移強化
  - 画像マップ抽出フォールバック
  - デバッグOFF時の待機短縮
- `Laplace`:
  - 既知サイト名→`laplaceCode` 補完辞書
  - 停止中サイト（落居）の期間0固定ルール
- `Prisma`:
  - 開発環境の `query` ログを既定OFF（必要時のみ `PRISMA_QUERY_LOG=1`）

## 4) 速度最適化の現状

- 一括取得時間は「最遅 collector」にほぼ依存
- 既定で headless 実行
- `SMA_DEBUG_HEADFUL=0` / `SMA_DEBUG_TRACE=0` 前提で最適化済み

## 5) 本番反映チェック

1. `main` に push 済みか確認
2. Vercel の Production が対象コミットで完了しているか確認
3. 画面が古い場合はハードリロード（`Ctrl+F5`）

## 6) 注意事項

- 一時的な接続障害時は、短時間で「即失敗」することがある（DB未到達）
- その場合はロジックより接続要因を先に疑う

