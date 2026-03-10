太陽光発電所統合管理システム 仕様書
1. プロダクト概要
1.1 基本情報
項目
内容
名称（仮）
SolarSite Manager
種別
社内業務用Webアプリケーション
対象ユーザー
再エネ促進課メンバー（5-10名）

1.2 コンセプト
6つの太陽光発電所がそれぞれ異なるベンダーの遠隔監視システム（eco-megane、Huawei FusionSolar、SMA Sunny Portal、Grand Arch、Solar Frontier、Solar Energy）で管理されているため、各サイトから手動ダウンロードしたExcelデータを一元管理し、統一されたダッシュボードで発電量・稼働状況を可視化することで、課内メンバーが効率的にモニタリング・レポーティングできる業務支援システム。
解決する課題:
6つの異なるベンダーの監視システムに個別ログインして確認する手間
各システムのUI・データ形式が異なるため比較が困難
発電量データの集計・比較作業の煩雑さ（Excel手作業）
異常発生時の早期発見と対応の遅れ
月次・年次レポート作成の工数

2. 技術スタック
レイヤー
技術
フロントエンド
Next.js 14 (App Router) + TypeScript
UI フレームワーク
Tailwind CSS + shadcn/ui
バックエンド
Next.js API Routes
データベース
PostgreSQL 16
ORM
Prisma
認証
NextAuth.js v5 (Auth.js)
ストレージ
ローカルファイルシステム or AWS S3
チャート表示
Recharts
Excel処理
xlsx (SheetJS)


3. 機能一覧
ID
機能名
概要
優先度
F-1
ユーザー認証
メールアドレス＋パスワード認証
P0
F-2
サイトマスタ管理
6サイトの基本情報登録・編集（名称、URL、設備容量など）
P0
F-3
Excelファイルアップロード
各サイトの発電データファイルをアップロード
P0
F-4
マルチフォーマット自動認識
異なるフォーマットのExcel/CSVを自動判定・パース
P0
F-5
発電量ダッシュボード
6サイト全体の発電量を一覧・グラフ表示
P0
F-6
日別発電量表示
日単位での発電量推移グラフ・テーブル
P0
F-7
月別・年別集計
月次・年次での発電量サマリー
P0
F-8
リアルタイム状況表示
最新データに基づく現在の発電状況
P0
F-9
異常・アラート管理
発電停止・低下の検知と通知
P0
F-10
サイト別詳細表示
各発電所の詳細データ閲覧
P1
F-11
サイト間比較分析
複数サイトの発電量比較（正規化あり）
P1
F-12
データエクスポート
CSV/Excelでのレポート出力
P1
F-13
データ履歴管理
過去アップロードファイルの閲覧・再取込
P1
F-14
監視システムリンク管理
各サイトの監視システムURLクイックアクセス
P2
F-15
カスタムフォーマット定義
特殊なフォーマットのマッピングルール保存
P2

優先度: P0 = MVP必須、P1 = MVP推奨、P2 = 将来対応

4. 主要ビジネスルール
4.1 データ管理ルール
ルール
仕様
対応ファイル形式
Excel (.xlsx, .xls), CSV (.csv)
ファイルサイズ
最大10MB/ファイル
データ保持期間
3年分のデータを保持（それ以降はアーカイブ）
同一日データ重複
同じサイト・同じ日付のデータは最新アップロードで上書き
必須データ項目
日付、発電量（kWh）
サイト数上限
初期6サイト、将来的に拡張可能
マルチベンダー対応
各監視システムの異なるフォーマットを自動認識
エンコーディング
UTF-8, Shift-JIS, CP932 を自動判定

4.2 アラート検知ルール
ルール
仕様
発電停止検知
発電量が0kWh の日が連続2日以上
発電量低下検知
過去30日平均の50%未満が3日連続
データ未更新検知
最終アップロードから7日間データなし

4.3 認証ルール
ルール
仕様
パスワード
8〜128文字、英字1文字以上＋数字1文字以上
アクセストークン
有効期限24時間
リフレッシュトークン
有効期限30日、ローテーション方式
アカウントロック
ログイン失敗5回で15分間ロック
同時セッション
最大3デバイス


5. エンティティ
5.1 主要エンティティ
エンティティ
説明
主要属性
User
ユーザー
email, name, role
Site
発電所サイト
siteName, location, capacity(kW), monitoringSystem, monitoringUrl
DailyGeneration
日別発電量データ
siteId, date, generation(kWh), status
UploadHistory
アップロード履歴
userId, siteId, fileName, uploadedAt, recordCount, dataFormat
Alert
アラート情報
siteId, alertType, detectedAt, resolvedAt, message

5.2 認証・セキュリティ関連
エンティティ
説明
RefreshToken
リフレッシュトークン管理
PasswordResetToken
パスワードリセット用
LoginAttempt
ログイン試行記録（ロック判定用）

5.3 主要な関連
User 1──N UploadHistory
Site 1──N DailyGeneration
Site 1──N Alert
User 1──N Alert (アラート確認者)


6. 画面・URL設計
6.1 画面一覧
パス
画面名
認証
/
Topページ（ログイン前）
不要
/auth/login
ログイン
不要
/auth/signup
新規登録
不要
/auth/forgot-password
パスワードリセット申請
不要
/auth/reset-password/:token
パスワード再設定
不要
/dashboard
ダッシュボード（6サイト統合ビュー）
必須
/upload
データアップロード
必須
/sites
サイト一覧・管理
必須
/sites/new
サイト新規登録
必須
/sites/:siteId
サイト詳細（個別発電所データ）
必須
/sites/:siteId/edit
サイト情報編集
必須
/alerts
アラート一覧
必須
/reports
レポート出力
必須
/history
アップロード履歴
必須
/settings/profile
プロフィール設定
必須

6.2 主要フロー
初回登録フロー:
新規登録 → メール認証（オプション） → ログイン → ダッシュボード

データ登録・閲覧フロー:
ログイン → データアップロード → 自動パース＆DB登録 → ダッシュボードで可視化 → アラート確認

日常運用フロー:
ログイン → ダッシュボード確認 → （必要に応じて）サイト詳細閲覧 → アラート対応


7. 認証・認可
7.1 認可レベル
レベル
説明
Public
認証不要（ログイン画面など）
User
ログイン必須（全課内メンバー共通権限）

初期フェーズでは管理者権限は設けず、全員が同等の権限を持つ
7.2 将来の拡張予定
機能
説明
Admin権限
サイト登録・削除、ユーザー管理
閲覧専用権限
データ閲覧のみ可能（アップロード不可）


8. API概要
8.1 共通仕様
項目
仕様
ベースURL
/api
認証ヘッダー
Authorization: Bearer <JWT> (NextAuth session)
レスポンス形式
{ "data": ... } または { "error": { "code": "...", "message": "..." } }
日時形式
ISO 8601 UTC（例: 2025-03-01T05:00:00.000Z）

8.2 主要エンドポイント
メソッド
パス
説明
認可
POST
/api/auth/signup
新規登録
Public
POST
/api/auth/login
ログイン
Public
POST
/api/auth/logout
ログアウト
User
GET
/api/auth/me
自分の情報
User
GET
/api/sites
サイト一覧取得
User
GET
/api/sites/:id
サイト詳細取得
User
POST
/api/sites
サイト新規登録
User
PATCH
/api/sites/:id
サイト情報更新
User
DELETE
/api/sites/:id
サイト削除
User
POST
/api/upload
ファイルアップロード
User
POST
/api/upload/validate
ファイルフォーマット検証（プレビュー）
User
GET
/api/generation/daily
日別発電量取得（クエリ: siteId, startDate, endDate）
User
GET
/api/generation/monthly
月別集計取得
User
GET
/api/generation/yearly
年別集計取得
User
GET
/api/generation/latest
最新発電状況取得（全サイト）
User
GET
/api/generation/compare
サイト間比較データ取得
User
GET
/api/alerts
アラート一覧取得
User
PATCH
/api/alerts/:id/resolve
アラート解決済みにする
User
GET
/api/upload-history
アップロード履歴取得
User
GET
/api/upload-history/:id
特定アップロードの詳細
User
POST
/api/upload-history/:id/reprocess
データ再処理
User
GET
/api/reports/export
レポートCSV/Excel出力
User


9. 非機能要件
9.1 パフォーマンス
項目
要件
ページ読み込み
LCP 3秒以内
API応答時間
p95で500ms以内
ファイルアップロード
10MB/ファイルを30秒以内
ダッシュボード描画
初期表示2秒以内

9.2 セキュリティ
項目
要件
通信
HTTPS必須
パスワード
bcryptでハッシュ化（salt rounds: 10）
CSRF対策
NextAuth組み込み機能で対応
ファイルアップロード
ウイルススキャン（将来対応）

9.3 必須環境変数
変数名
説明
DATABASE_URL
PostgreSQL接続文字列
NEXTAUTH_SECRET
NextAuth.js署名用シークレット（32文字以上）
NEXTAUTH_URL
アプリケーションのベースURL
UPLOAD_DIR
アップロードファイル保存先（ローカルの場合）
AWS_S3_BUCKET
S3バケット名（S3利用の場合）
AWS_ACCESS_KEY_ID
AWS認証情報（S3利用の場合）
AWS_SECRET_ACCESS_KEY
AWS認証情報（S3利用の場合）

詳細は detailed/06-environment-setup.md 参照

10. データ形式仕様
10.1 対象監視システム一覧
No.
システム名
ベンダー
URL
想定フォーマット
01
eco-megane
NTTスマイルエナジー
https://eco-megane.jp/
CSV/Excel
02
FusionSolar
Huawei
https://jp5.fusionsolar.huawei.com/
Excel
03
Sunny Portal
SMA
https://www.sunnyportal.com/
CSV/Excel
04
Grand Arch
不明
https://grandarch.energymntr.com/
Excel
05
Solar Monitor
Solar Frontier
https://solar-monitor.solar-frontier.com/
CSV/Excel
06
Solar Monitor
Solar Energy
https://solar-monitor.solar-energy.co.jp/
CSV/Excel

10.2 基本想定フォーマット
各監視システムから出力されるファイルは、以下のカラムを含むことを想定（実際のフォーマットは各システムで異なる）:
カラム名候補
型
必須
説明
日付 / Date / 年月日
日付
✓
YYYY-MM-DD, YYYY/MM/DD, MM/DD/YYYY など
サイト名 / Site / 発電所名 / Plant
文字列
-
発電所の識別名（ファイル名から推定も可）
発電量 / Generation / 発電電力量 / Energy
数値
✓
kWh単位（一部MWh単位の可能性あり）
ステータス / Status / 状態
文字列
-
"正常", "停止", "異常", "Normal", "Fault" など
備考 / Notes / Memo
文字列
-
自由記述

10.3 パース処理の柔軟性対応
マルチフォーマット対応戦略:
ヘッダー行の自動検出


1〜3行目の中から日付・発電量カラムを含む行を自動判定
カラム名の揺れに対応（日本語/英語、全角/半角、大文字/小文字）
日付フォーマットの自動認識

 対応形式:
- YYYY-MM-DD, YYYY/MM/DD
- MM/DD/YYYY, DD/MM/YYYY
- YYYY年MM月DD日
- Excel日付シリアル値


発電量カラムの推定


カラム名に「発電」「Generation」「Energy」「kWh」を含む列
数値型かつ0以上の値を持つ列
MWh単位の場合は自動的に1000倍してkWhに変換
サイト名の特定


ファイル名から抽出（例: site01_202501.xlsx → "site01"）
アップロード時にユーザーが手動選択
ファイル内のサイト名カラムから取得
10.4 エラーハンドリング
エラー種別
対応
日付カラムが見つからない
アップロード失敗、エラーメッセージ表示
発電量カラムが見つからない
アップロード失敗、エラーメッセージ表示
不正な日付形式
その行をスキップ、ログに記録
発電量が負の値
その行をスキップ、警告ログ
重複する日付データ
最新の値で上書き（UploadHistoryに記録）
ファイル形式不正
アップロード失敗、サポート形式を案内

10.5 アップロード後の処理フロー
1. ファイル受信 → ウイルススキャン（将来対応）
   ↓
2. ファイル形式検証（.xlsx, .xls, .csv）
   ↓
3. フォーマット自動判定
   ├─ ヘッダー行検出
   ├─ 日付カラム特定
   ├─ 発電量カラム特定
   └─ サイト名特定
   ↓
4. データパース＆バリデーション
   ├─ 日付の正規化
   ├─ 発電量の単位統一（kWh）
   └─ 異常値チェック
   ↓
5. DB登録
   ├─ Site未登録なら自動作成
   ├─ DailyGeneration登録（同一日は上書き）
   └─ UploadHistory記録
   ↓
6. アラート条件チェック
   └─ Alert自動生成
   ↓
7. 完了通知 + 処理サマリー表示
   （成功件数、スキップ件数、警告内容）


11. 初期セットアップ
11.1 サイトマスタ初期登録
アプリケーション導入時に、以下6サイトの基本情報を登録:
No.
サイト名（仮）
監視システム
監視URL
設備容量
備考
01
Site-EcoMegane
eco-megane (NTT)
https://eco-megane.jp/
TBD
要ヒアリング
02
Site-Huawei
FusionSolar (Huawei)
https://jp5.fusionsolar.huawei.com/
TBD
要ヒアリング
03
Site-SMA
Sunny Portal (SMA)
https://www.sunnyportal.com/
TBD
要ヒアリング
04
Site-GrandArch
Grand Arch
https://grandarch.energymntr.com/
TBD
要ヒアリング
05
Site-SolarFrontier
Solar Monitor (SF)
https://solar-monitor.solar-frontier.com/
TBD
要ヒアリング
06
Site-SolarEnergy
Solar Monitor (SE)
https://solar-monitor.solar-energy.co.jp/
TBD
要ヒアリング

追加で登録が必要な情報:
正式なサイト名称
所在地（都道府県・市区町村）
設備容量（kW）
稼働開始日
想定年間発電量（kWh）
担当者名（オプション）
11.2 初回データ投入フロー
1. 管理画面で6サイトの基本情報を登録
   ↓
2. 各監視システムから直近1ヶ月分のデータをダウンロード
   ↓
3. アップロード画面で各サイトを選択してファイル投入
   ↓
4. フォーマット自動認識 → データ取込
   ↓
5. ダッシュボードで正常に表示されることを確認
   ↓
6. （オプション）過去データの一括投入

11.3 運用開始後のデータ更新頻度
更新頻度
想定運用
推奨
毎日または毎週（最新データを反映）
最低限
月1回（月次レポート作成前）
アラート対応
異常検知時は即時確認・手動更新


12. 詳細ドキュメント参照
実装タスク
参照ファイル
全体像・用語確認
detailed/00-index.md, detailed/01-product-overview.md
機能要件詳細
detailed/02-functional-requirements.md
画面詳細実装
detailed/03-screen-design.md
DB設計・ORM
detailed/04-data-model.md
API詳細実装
detailed/05-api-specification.md
環境構築
detailed/06-environment-setup.md
テスト実装
detailed/07-testing-strategy.md


13. 開発フェーズ
Phase 1: MVP (最小機能プロダクト)
認証機能（ログイン・新規登録）
サイトマスタ管理（6サイト登録・編集）
マルチフォーマット自動認識機能
Excelアップロード＆パース機能
ダッシュボード（6サイト一覧表示）
日別発電量グラフ表示
基本的なアラート検知
Phase 2: 機能拡充
月別・年別集計機能
サイト詳細ページ
サイト間比較分析（設備容量で正規化）
アラート管理UI強化
データエクスポート機能
アップロード履歴管理
Phase 3: 運用改善
カスタムフォーマット定義機能
監視システム直接リンク機能
データ自動バックアップ
パフォーマンス最適化
エラーログ・監視機能
モバイル対応改善

更新履歴
日付
変更内容
2025-02-02
初版作成
2025-02-02
6サイトURL情報追加、マルチベンダー対応強化、初期セットアップ手順追加


