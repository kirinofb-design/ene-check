SolarSite Manager 開発マスタープラン
ドキュメント管理ルール
Source of Truth（唯一の正解）
Spec.md が本プロジェクトの唯一の正解（Source of Truth）です。
すべての実装判断はSpec.mdに基づいて行います
Spec.mdと矛盾する場合は、必ずSpec.mdが優先されます
仕様の変更は必ずSpec.mdを更新してから実装に反映します
不明点や曖昧な箇所がある場合は、実装前にSpec.mdを明確化します
ドキュメント構成
プロジェクトルート/
├── Spec.md                          # 【唯一の正解】仕様書
├── MonitoringSystems_Reference.md   # 監視システム参考情報
├── マスタープラン.md                 # 本ドキュメント（開発計画）
└── docs/
    ├── detailed/                    # 詳細ドキュメント（Spec.mdから生成）
    │   ├── 00-index.md
    │   ├── 01-product-overview.md
    │   ├── 02-functional-requirements.md
    │   ├── 03-screen-design.md
    │   ├── 04-data-model.md
    │   ├── 05-api-specification.md
    │   ├── 06-environment-setup.md
    │   └── 07-testing-strategy.md
    └── development/                 # 開発記録
        ├── decision-log.md          # 技術選定・設計判断記録
        ├── implementation-notes.md  # 実装メモ
        └── troubleshooting.md       # トラブルシューティング


開発原則
1. 仕様駆動開発（Specification-Driven Development）
実装前にSpec.md確認: コーディング開始前に必ず該当箇所を確認
仕様外の機能追加禁止: Spec.mdにない機能は実装しない
変更はSpec.md更新から: 仕様変更が必要な場合は、まずSpec.mdを更新
2. 段階的実装（Incremental Development）
Phase 1 (MVP) → Phase 2 → Phase 3 の順で実装
各Phaseの完了条件を満たしてから次へ進む
優先度P0 → P1 → P2の順で実装
3. 安全性優先（Safety First）
データ損失ゼロ: アップロードデータは必ず保存
トランザクション管理: DBへの複数操作は必ずトランザクション化
バリデーション徹底: クライアント・サーバー両方で検証
エラーハンドリング: すべてのエラーケースを想定
4. テスト駆動（Test-Driven）
単体テスト: 重要なビジネスロジックは必ずテスト
統合テスト: API・DB連携は統合テスト実施
E2Eテスト: 主要フローはE2Eテスト実施

Phase 1: MVP開発計画
目標
6サイトの発電量データを一元管理できる最小限の機能を実装
完了条件
[ ] ユーザー登録・ログインができる
[ ] 6サイトの基本情報を登録できる
[ ] Excelファイルをアップロードしてデータを取り込める
[ ] ダッシュボードで6サイトの発電量が一覧表示される
[ ] 日別の発電量グラフが表示される
[ ] 基本的なアラート（発電停止検知）が動作する

タスク管理
🔴 Critical（即対応必須）
🟡 High（Phase完了に必須）
🟢 Medium（推奨）
⚪ Low（余裕があれば）

Stage 0: プロジェクトセットアップ
0-1. 環境構築
参照: Spec.md セクション2, 9.3
タスク一覧
[ ] 🔴 Next.js 14プロジェクト作成
 npx create-next-app@latest solarsite-manager --typescript --tailwind --app


[ ] 🔴 必要なパッケージのインストール
 # Core dependenciesnpm install prisma @prisma/clientnpm install next-auth@betanpm install bcryptjsnpm install xlsxnpm install rechartsnpm install zod# UI componentsnpx shadcn-ui@latest initnpx shadcn-ui@latest add buttonnpx shadcn-ui@latest add inputnpx shadcn-ui@latest add cardnpx shadcn-ui@latest add tablenpx shadcn-ui@latest add dialognpx shadcn-ui@latest add toast# Dev dependenciesnpm install -D @types/bcryptjsnpm install -D @types/node


[ ] 🔴 PostgreSQL環境構築
ローカル: Docker Composeでセットアップ
または: Supabase / Vercel Postgres
[ ] 🔴 環境変数ファイル作成
 # .env.localDATABASE_URL="postgresql://..."NEXTAUTH_SECRET="generate-32-char-secret"NEXTAUTH_URL="http://localhost:3000"UPLOAD_DIR="./uploads"


[ ] 🟡 Git初期化・リポジトリセットアップ
 git initgit add .git commit -m "Initial commit: Project setup"


[ ] 🟡 .gitignore確認
.env.local
/uploads
/node_modules
/.next
完了確認:
[ ] npm run dev で開発サーバーが起動する
[ ] PostgreSQLに接続できる
[ ] 環境変数が読み込まれる

0-2. ディレクトリ構造作成
参照: Spec.md セクション6.1
ディレクトリ構成
solarsite-manager/
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/
│   │   │   ├── signup/
│   │   │   ├── forgot-password/
│   │   │   └── reset-password/
│   │   ├── (protected)/
│   │   │   ├── dashboard/
│   │   │   ├── upload/
│   │   │   ├── sites/
│   │   │   ├── alerts/
│   │   │   ├── reports/
│   │   │   ├── history/
│   │   │   └── settings/
│   │   ├── api/
│   │   │   ├── auth/
│   │   │   ├── sites/
│   │   │   ├── upload/
│   │   │   ├── generation/
│   │   │   ├── alerts/
│   │   │   ├── upload-history/
│   │   │   └── reports/
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── ui/           # shadcn components
│   │   ├── auth/
│   │   ├── dashboard/
│   │   ├── sites/
│   │   └── common/
│   ├── lib/
│   │   ├── prisma.ts
│   │   ├── auth.ts
│   │   ├── utils.ts
│   │   └── validations/
│   ├── services/
│   │   ├── fileParser.ts
│   │   ├── alertService.ts
│   │   └── generationService.ts
│   └── types/
│       └── index.ts
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── uploads/              # アップロードファイル保存先
├── public/
├── Spec.md
├── MonitoringSystems_Reference.md
├── マスタープラン.md
└── docs/

タスク一覧
[ ] 🔴 ディレクトリ構造作成
[ ] 🔴 基本的なlayout.tsx作成
[ ] 🟡 README.md作成（セットアップ手順）

Stage 1: データベース設計・構築
1-1. Prismaスキーマ定義
参照: Spec.md セクション5（エンティティ）, セクション4.3（認証ルール）
タスク一覧
[ ] 🔴 prisma/schema.prisma 作成
User モデル
Site モデル
DailyGeneration モデル
UploadHistory モデル
Alert モデル
RefreshToken モデル
PasswordResetToken モデル
LoginAttempt モデル
Prismaスキーマ実装チェックリスト
User モデル
[ ] id: String @id @default(cuid())
[ ] email: String @unique
[ ] name: String?
[ ] password: String（bcrypt ハッシュ）
[ ] role: String @default("user")
[ ] createdAt: DateTime @default(now())
[ ] updatedAt: DateTime @updatedAt
[ ] リレーション: UploadHistory[], Alert[]
Site モデル
[ ] id: String @id @default(cuid())
[ ] siteName: String
[ ] location: String?
[ ] capacity: Float（kW）
[ ] monitoringSystem: String（例: "eco-megane"）
[ ] monitoringUrl: String
[ ] startDate: DateTime?
[ ] expectedAnnualGeneration: Float?（kWh）
[ ] createdAt: DateTime @default(now())
[ ] updatedAt: DateTime @updatedAt
[ ] リレーション: DailyGeneration[], Alert[], UploadHistory[]
DailyGeneration モデル
[ ] id: String @id @default(cuid())
[ ] siteId: String
[ ] date: DateTime
[ ] generation: Float（kWh）
[ ] status: String?（"正常", "停止", "異常"）
[ ] notes: String?
[ ] createdAt: DateTime @default(now())
[ ] updatedAt: DateTime @updatedAt
[ ] @@unique([siteId, date])（同一サイト・同一日の重複防止）
[ ] リレーション: Site
UploadHistory モデル
[ ] id: String @id @default(cuid())
[ ] userId: String
[ ] siteId: String?
[ ] fileName: String
[ ] filePath: String
[ ] fileSize: Int（bytes）
[ ] dataFormat: String（"xlsx", "xls", "csv"）
[ ] recordCount: Int（取り込んだレコード数）
[ ] successCount: Int（成功数）
[ ] errorCount: Int（エラー数）
[ ] uploadedAt: DateTime @default(now())
[ ] リレーション: User, Site?
Alert モデル
[ ] id: String @id @default(cuid())
[ ] siteId: String
[ ] alertType: String（"POWER_STOP", "POWER_LOW", "DATA_MISSING"）
[ ] severity: String（"INFO", "WARNING", "CRITICAL"）
[ ] message: String
[ ] detectedAt: DateTime @default(now())
[ ] resolvedAt: DateTime?
[ ] resolvedBy: String?（userId）
[ ] リレーション: Site, User?
RefreshToken モデル
[ ] id: String @id @default(cuid())
[ ] token: String @unique
[ ] userId: String
[ ] expiresAt: DateTime
[ ] createdAt: DateTime @default(now())
[ ] リレーション: User
PasswordResetToken モデル
[ ] id: String @id @default(cuid())
[ ] token: String @unique
[ ] userId: String
[ ] expiresAt: DateTime
[ ] createdAt: DateTime @default(now())
[ ] リレーション: User
LoginAttempt モデル
[ ] id: String @id @default(cuid())
[ ] email: String
[ ] ipAddress: String?
[ ] success: Boolean
[ ] attemptedAt: DateTime @default(now())
タスク実行
[ ] 🔴 スキーマファイル作成
[ ] 🔴 マイグレーション実行
 npx prisma migrate dev --name init


[ ] 🔴 Prisma Client生成
 npx prisma generate


[ ] 🟡 Prisma Studio確認
 npx prisma studio


完了確認:
[ ] すべてのテーブルが作成されている
[ ] リレーションが正しく設定されている
[ ] Prisma Studioでデータ確認できる

1-2. シードデータ作成
参照: Spec.md セクション11.1（初期セットアップ）
タスク一覧
[ ] 🟡 prisma/seed.ts 作成
6サイトの初期データ
テストユーザー（開発用）
シードデータ内容
// 6サイトの基本情報
const sites = [
  {
    siteName: "Site-EcoMegane",
    monitoringSystem: "eco-megane",
    monitoringUrl: "https://eco-megane.jp/",
    capacity: 100, // TBD
    location: "未設定",
  },
  // ... 残り5サイト
];

// テストユーザー
const testUser = {
  email: "test@example.com",
  name: "テストユーザー",
  password: await bcrypt.hash("Test1234", 10),
  role: "user",
};

タスク実行
[ ] 🟡 seed.tsファイル作成
[ ] 🟡 シード実行
 npx prisma db seed


完了確認:
[ ] 6サイトがDBに登録されている
[ ] テストユーザーでログイン可能

Stage 2: 認証機能実装
2-1. NextAuth.js セットアップ
参照: Spec.md セクション4.3（認証ルール）, セクション7（認証・認可）
タスク一覧
[ ] 🔴 src/lib/auth.ts 作成
NextAuth設定
Credentials Provider設定
JWT戦略設定
[ ] 🔴 src/app/api/auth/[...nextauth]/route.ts 作成
[ ] 🔴 認証ヘルパー関数作成
 // src/lib/auth.tsexport async function getServerSession()export async function requireAuth()export async function hashPassword(password: string)export async function verifyPassword(password: string, hash: string)


認証ルール実装チェックリスト
Spec.md 4.3より
[ ] パスワード検証: 8〜128文字、英字1文字以上＋数字1文字以上
[ ] アクセストークン: 有効期限24時間
[ ] リフレッシュトークン: 有効期限30日、ローテーション方式
[ ] アカウントロック: ログイン失敗5回で15分間ロック
[ ] 同時セッション: 最大3デバイス
タスク実行
[ ] 🔴 NextAuth基本設定
[ ] 🔴 パスワードバリデーション実装
[ ] 🟡 ログイン試行記録（LoginAttempt）
[ ] 🟡 アカウントロック機能
[ ] 🟢 リフレッシュトークンローテーション
完了確認:
[ ] ログイン・ログアウトが動作する
[ ] セッション管理が機能する
[ ] パスワードルールが適用される

2-2. 認証画面実装
参照: Spec.md セクション6.1（画面一覧）
タスク一覧
[ ] 🔴 ログイン画面 (/auth/login)
メール・パスワード入力フォーム
バリデーション表示
エラーメッセージ
[ ] 🔴 新規登録画面 (/auth/signup)
メール・名前・パスワード入力
パスワード確認
利用規約同意（オプション）
[ ] 🟡 パスワードリセット申請 (/auth/forgot-password)
[ ] 🟡 パスワード再設定 (/auth/reset-password/:token)
UI実装チェックリスト
[ ] shadcn/ui Button, Input, Card使用
[ ] フォームバリデーション（zod）
[ ] ローディング状態表示
[ ] エラー・成功メッセージ表示
完了確認:
[ ] 新規ユーザー登録ができる
[ ] 登録後ログインできる
[ ] 不正な入力でエラーが表示される

2-3. 認証ミドルウェア
参照: Spec.md セクション7.1（認可レベル）
タスク一覧
[ ] 🔴 middleware.ts 作成
未認証ユーザーを /auth/login にリダイレクト
認証済みユーザーは保護されたページにアクセス可能
[ ] 🔴 保護されたルート定義
 const protectedRoutes = [  '/dashboard',  '/upload',  '/sites',  '/alerts',  '/reports',  '/history',  '/settings',];


完了確認:
[ ] 未ログイン時、保護ページにアクセスするとログイン画面へリダイレクト
[ ] ログイン後、保護ページにアクセスできる

Stage 3: サイトマスタ管理機能
3-1. サイトAPI実装
参照: Spec.md セクション8.2（API一覧）
タスク一覧
[ ] 🔴 GET /api/sites - サイト一覧取得
[ ] 🔴 GET /api/sites/:id - サイト詳細取得
[ ] 🔴 POST /api/sites - サイト新規登録
[ ] 🟡 PATCH /api/sites/:id - サイト情報更新
[ ] 🟢 DELETE /api/sites/:id - サイト削除
API実装チェックリスト
共通（Spec.md 8.1）
[ ] レスポンス形式: { "data": ... } または { "error": {...} }
[ ] 日時形式: ISO 8601 UTC
[ ] 認証チェック: requireAuth()
[ ] エラーハンドリング
タスク実行
// src/app/api/sites/route.ts
export async function GET(req: Request) {
  const session = await requireAuth();
  const sites = await prisma.site.findMany();
  return Response.json({ data: sites });
}

export async function POST(req: Request) {
  const session = await requireAuth();
  const body = await req.json();
  // バリデーション
  const site = await prisma.site.create({ data: body });
  return Response.json({ data: site });
}

完了確認:
[ ] APIが正しいレスポンスを返す
[ ] エラーケースが適切に処理される
[ ] 認証が機能している

3-2. サイト管理画面実装
参照: Spec.md セクション6.1（画面一覧）
タスク一覧
[ ] 🔴 サイト一覧画面 (/sites)
サイトのカード表示またはテーブル表示
サイト名、設備容量、監視システム
「新規登録」ボタン
[ ] 🔴 サイト新規登録画面 (/sites/new)
サイト名、所在地、設備容量、監視システム、URL入力
バリデーション
[ ] 🟡 サイト編集画面 (/sites/:siteId/edit)
UI実装チェックリスト
[ ] shadcn/ui Card, Table使用
[ ] フォームバリデーション
[ ] 監視システムURLのクイックリンク
[ ] レスポンシブデザイン
完了確認:
[ ] サイト一覧が表示される
[ ] 新規サイトを登録できる
[ ] サイト情報を編集できる

Stage 4: ファイルアップロード機能
4-1. ファイルパーサー実装
参照: Spec.md セクション10（データ形式仕様）
タスク一覧
[ ] 🔴 src/services/fileParser.ts 作成
Excel/CSVパース機能
ヘッダー行自動検出
日付カラム自動検出
発電量カラム自動検出
サイト名推定
ファイルパーサー実装チェックリスト
Spec.md 10.3より
1. ヘッダー行の自動検出
[ ] 1〜3行目をスキャン
[ ] 日付・発電量カラムを含む行を判定
[ ] カラム名の揺れ対応（日本語/英語、全角/半角）
2. 日付フォーマットの自動認識
[ ] YYYY-MM-DD
[ ] YYYY/MM/DD
[ ] MM/DD/YYYY
[ ] DD/MM/YYYY
[ ] YYYY年MM月DD日
[ ] Excelシリアル値
3. 発電量カラムの推定
[ ] カラム名に「発電」「Generation」「Energy」「kWh」を含む
[ ] 数値型かつ0以上
[ ] MWh単位の場合は1000倍
4. サイト名の特定
[ ] ファイル名から抽出
[ ] ファイル内のサイト名カラムから取得
[ ] ユーザー手動選択
5. エンコーディング対応
[ ] UTF-8
[ ] Shift-JIS
[ ] CP932
タスク実行
// src/services/fileParser.ts
export interface ParsedData {
  date: Date;
  generation: number;
  status?: string;
  notes?: string;
}

export interface ParseResult {
  success: boolean;
  data: ParsedData[];
  errors: string[];
  warnings: string[];
  summary: {
    totalRows: number;
    successCount: number;
    errorCount: number;
  };
}

export async function parseFile(
  file: File,
  siteId?: string
): Promise<ParseResult> {
  // 実装
}

完了確認:
[ ] 各監視システムのサンプルファイルをパースできる
[ ] 日付・発電量が正しく抽出される
[ ] エラー行が適切にスキップされる

4-2. アップロードAPI実装
参照: Spec.md セクション8.2, 10.5（アップロード後の処理フロー）
タスク一覧
[ ] 🔴 POST /api/upload - ファイルアップロード
[ ] 🟡 POST /api/upload/validate - フォーマット検証（プレビュー）
アップロード処理フロー実装
Spec.md 10.5より
[ ] ファイル受信
[ ] ファイル形式検証（.xlsx, .xls, .csv）
[ ] フォーマット自動判定
[ ] データパース＆バリデーション
[ ] DB登録（トランザクション）
[ ] Site未登録なら自動作成
[ ] DailyGeneration登録（同一日は上書き）
[ ] UploadHistory記録
[ ] アラート条件チェック
[ ] 完了通知 + 処理サマリー返却
エラーハンドリング実装
Spec.md 10.4より
[ ] 日付カラムが見つからない → アップロード失敗
[ ] 発電量カラムが見つからない → アップロード失敗
[ ] 不正な日付形式 → その行をスキップ、ログ記録
[ ] 発電量が負の値 → その行をスキップ、警告ログ
[ ] 重複する日付データ → 最新の値で上書き
[ ] ファイル形式不正 → アップロード失敗
タスク実行
// src/app/api/upload/route.ts
export async function POST(req: Request) {
  const session = await requireAuth();
  const formData = await req.formData();
  const file = formData.get('file') as File;
  const siteId = formData.get('siteId') as string;
  
  // ファイル保存
  const filePath = await saveFile(file);
  
  // パース
  const parseResult = await parseFile(file, siteId);
  
  // DB登録（トランザクション）
  await prisma.$transaction(async (tx) => {
    // DailyGeneration登録
    // UploadHistory記録
  });
  
  // アラートチェック
  await checkAlerts(siteId);
  
  return Response.json({ data: parseResult });
}

完了確認:
[ ] ファイルアップロードが成功する
[ ] データがDBに正しく登録される
[ ] 処理サマリーが返却される
[ ] エラーケースが適切に処理される

4-3. アップロード画面実装
参照: Spec.md セクション6.1（画面一覧）
タスク一覧
[ ] 🔴 アップロード画面 (/upload)
ファイル選択（ドラッグ&ドロップ対応）
サイト選択ドロップダウン
アップロードボタン
進行状況表示
処理結果サマリー表示
UI実装チェックリスト
[ ] ファイル形式チェック（クライアント側）
[ ] ファイルサイズチェック（10MB以内）
[ ] ドラッグ&ドロップUI
[ ] プログレスバー
[ ] 成功・エラーメッセージ
[ ] 処理結果詳細（成功数、エラー数、警告内容）
完了確認:
[ ] ファイルを選択してアップロードできる
[ ] 進行状況が表示される
[ ] 処理結果が確認できる

Stage 5: ダッシュボード実装
5-1. 発電量取得API実装
参照: Spec.md セクション8.2（API一覧）
タスク一覧
[ ] 🔴 GET /api/generation/daily - 日別発電量取得
[ ] 🔴 GET /api/generation/monthly - 月別集計取得
[ ] 🔴 GET /api/generation/yearly - 年別集計取得
[ ] 🔴 GET /api/generation/latest - 最新発電状況取得（全サイト）
API実装チェックリスト
[ ] クエリパラメータ: siteId, startDate, endDate
[ ] 集計処理: Prismaで効率的に集計
[ ] キャッシュ検討: 頻繁にアクセスされるデータはキャッシュ
タスク実行
// src/app/api/generation/daily/route.ts
export async function GET(req: Request) {
  const session = await requireAuth();
  const { searchParams } = new URL(req.url);
  const siteId = searchParams.get('siteId');
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  
  const data = await prisma.dailyGeneration.findMany({
    where: {
      siteId,
      date: {
        gte: new Date(startDate),
        lte: new Date(endDate),
      },
    },
    orderBy: { date: 'asc' },
  });
  
  return Response.json({ data });
}

完了確認:
[ ] APIが正しいデータを返す
[ ] 日付範囲フィルタが機能する
[ ] パフォーマンスが許容範囲内

5-2. ダッシュボード画面実装
参照: Spec.md セクション6.1（画面一覧）, セクション3（機能一覧 F-5, F-6, F-8）
タスク一覧
[ ] 🔴 ダッシュボード (/dashboard)
6サイトのサマリーカード表示
サイト名
最新発電量
今日の発電量
今月累計
ステータス（正常/異常）
全サイト合計の発電量グラフ
日別発電量推移グラフ（過去30日）
アラート通知（未解決のみ）
UI実装チェックリスト
[ ] Rechartsでグラフ表示
LineChart（日別推移）
BarChart（サイト別比較）
[ ] レスポンシブグリッドレイアウト
[ ] リアルタイム更新（オプション）
[ ] ローディングスケルトン
タスク実行
// src/app/(protected)/dashboard/page.tsx
export default async function DashboardPage() {
  const sites = await prisma.site.findMany();
  const latestData = await getLatestGeneration();
  const dailyData = await getDailyGeneration({ days: 30 });
  const alerts = await getUnresolvedAlerts();
  
  return (
    <div>
      {/* サマリーカード */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sites.map(site => (
          <SiteCard key={site.id} site={site} data={latestData[site.id]} />
        ))}
      </div>
      
      {/* グラフ */}
      <GenerationChart data={dailyData} />
      
      {/* アラート */}
      <AlertList alerts={alerts} />
    </div>
  );
}

完了確認:
[ ] 6サイトのサマリーが表示される
[ ] グラフが正しく描画される
[ ] アラートが表示される
[ ] レスポンシブ対応

Stage 6: アラート機能実装
6-1. アラートサービス実装
参照: Spec.md セクション4.2（アラート検知ルール）
タスク一覧
[ ] 🔴 src/services/alertService.ts 作成
発電停止検知
発電量低下検知
データ未更新検知
アラート検知ルール実装
Spec.md 4.2より
1. 発電停止検知
[ ] 条件: 発電量が0kWh の日が連続2日以上
[ ] アラートタイプ: "POWER_STOP"
[ ] 重要度: "CRITICAL"
2. 発電量低下検知
[ ] 条件: 過去30日平均の50%未満が3日連続
[ ] アラートタイプ: "POWER_LOW"
[ ] 重要度: "WARNING"
3. データ未更新検知
[ ] 条件: 最終アップロードから7日間データなし
[ ] アラートタイプ: "DATA_MISSING"
[ ] 重要度: "WARNING"
タスク実行
// src/services/alertService.ts
export async function checkAlerts(siteId: string): Promise<Alert[]> {
  const alerts: Alert[] = [];
  
  // 発電停止検知
  const stopAlert = await checkPowerStop(siteId);
  if (stopAlert) alerts.push(stopAlert);
  
  // 発電量低下検知
  const lowAlert = await checkPowerLow(siteId);
  if (lowAlert) alerts.push(lowAlert);
  
  // データ未更新検知
  const missingAlert = await checkDataMissing(siteId);
  if (missingAlert) alerts.push(missingAlert);
  
  return alerts;
}

async function checkPowerStop(siteId: string): Promise<Alert | null> {
  // 過去2日間のデータを取得
  const recentData = await prisma.dailyGeneration.findMany({
    where: { siteId },
    orderBy: { date: 'desc' },
    take: 2,
  });
  
  // 2日連続で発電量が0の場合
  if (recentData.length === 2 && 
      recentData[0].generation === 0 && 
      recentData[1].generation === 0) {
    return await prisma.alert.create({
      data: {
        siteId,
        alertType: 'POWER_STOP',
        severity: 'CRITICAL',
        message: '発電が停止しています（2日連続0kWh）',
      },
    });
  }
  
  return null;
}

完了確認:
[ ] 各アラート検知ロジックが正しく動作する
[ ] アラートが適切に生成される
[ ] 重複アラートが生成されない

6-2. アラートAPI実装
参照: Spec.md セクション8.2（API一覧）
タスク一覧
[ ] 🔴 GET /api/alerts - アラート一覧取得
[ ] 🔴 PATCH /api/alerts/:id/resolve - アラート解決
タスク実行
// src/app/api/alerts/route.ts
export async function GET(req: Request) {
  const session = await requireAuth();
  const { searchParams } = new URL(req.url);
  const resolved = searchParams.get('resolved') === 'true';
  
  const alerts = await prisma.alert.findMany({
    where: resolved ? {} : { resolvedAt: null },
    include: { site: true },
    orderBy: { detectedAt: 'desc' },
  });
  
  return Response.json({ data: alerts });
}

// src/app/api/alerts/[id]/resolve/route.ts
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await requireAuth();
  
  const alert = await prisma.alert.update({
    where: { id: params.id },
    data: {
      resolvedAt: new Date(),
      resolvedBy: session.user.id,
    },
  });
  
  return Response.json({ data: alert });
}

完了確認:
[ ] アラート一覧が取得できる
[ ] アラートを解決済みにできる

6-3. アラート一覧画面実装
参照: Spec.md セクション6.1（画面一覧）
タスク一覧
[ ] 🔴 アラート一覧画面 (/alerts)
未解決アラート一覧
アラートタイプ・重要度別フィルタ
「解決済みにする」ボタン
解決済みアラート表示切替
UI実装チェックリスト
[ ] アラートカード表示
重要度別カラー（CRITICAL: 赤、WARNING: 黄）
サイト名
アラート内容
検知日時
[ ] フィルタ機能
[ ] ソート機能（日時順）
完了確認:
[ ] アラート一覧が表示される
[ ] アラートを解決済みにできる
[ ] フィルタ・ソートが機能する

Stage 7: Phase 1 完了確認
Phase 1 完了チェックリスト
機能要件（Spec.md セクション3より P0機能）
[ ] ✅ F-1: ユーザー認証
[ ] 新規登録ができる
[ ] ログイン・ログアウトができる
[ ] ✅ F-2: サイトマスタ管理
[ ] 6サイトの基本情報を登録できる
[ ] サイト情報を編集できる
[ ] ✅ F-3: Excelファイルアップロード
[ ] ファイルをアップロードできる
[ ] データが取り込まれる
[ ] ✅ F-4: マルチフォーマット自動認識
[ ] 異なるフォーマットのファイルをパースできる
[ ] ✅ F-5: 発電量ダッシュボード
[ ] 6サイト全体の発電量が表示される
[ ] ✅ F-6: 日別発電量表示
[ ] 日単位の発電量グラフが表示される
[ ] ✅ F-7: 月別・年別集計
[ ] 月次・年次のサマリーが表示される
[ ] ✅ F-8: リアルタイム状況表示
[ ] 最新の発電状況が表示される
[ ] ✅ F-9: 異常・アラート管理
[ ] アラートが検知される
[ ] アラート一覧が表示される
非機能要件（Spec.md セクション9より）
[ ] ページ読み込み: LCP 3秒以内
[ ] API応答時間: p95で500ms以内
[ ] ファイルアップロード: 10MB/ファイルを30秒以内
[ ] HTTPS通信（本番環境）
[ ] パスワードbcryptハッシュ化
受け入れテスト
[ ] エンドユーザー（再エネ促進課メンバー）による動作確認
[ ] 6つの監視システムのサンプルデータを実際にアップロード
[ ] ダッシュボードで正常に表示確認
[ ] アラートが適切に動作確認
ドキュメント
[ ] README.md（セットアップ手順）
[ ] API仕様書（自動生成または手書き）
[ ] 運用マニュアル（ユーザー向け）

Phase 2: 機能拡充（参考）
Phase 1完了後、以下の機能を実装:
Phase 2 実装機能
[ ] F-10: サイト別詳細表示
[ ] F-11: サイト間比較分析
[ ] F-12: データエクスポート
[ ] F-13: データ履歴管理
詳細は Phase 1 完了後に別途計画します。

Phase 3: 運用改善（参考）
Phase 2完了後、以下の機能を実装:
Phase 3 実装機能
[ ] F-14: 監視システムリンク管理
[ ] F-15: カスタムフォーマット定義
[ ] データ自動バックアップ
[ ] パフォーマンス最適化
[ ] エラーログ・監視機能
[ ] モバイル対応改善
詳細は Phase 2 完了後に別途計画します。

トラブルシューティング
よくある問題と解決方法
1. Prismaマイグレーションエラー
問題: prisma migrate dev がエラーになる
解決方法:
# データベースをリセット
npx prisma migrate reset

# 再度マイグレーション
npx prisma migrate dev --name init

2. NextAuth認証エラー
問題: ログイン後すぐにログアウトされる
解決方法:
NEXTAUTH_SECRET が正しく設定されているか確認
NEXTAUTH_URL が正しいか確認（http://localhost:3000）
3. ファイルアップロードエラー
問題: ファイルアップロードが失敗する
解決方法:
UPLOAD_DIR ディレクトリが存在し、書き込み権限があるか確認
ファイルサイズが10MB以内か確認
ファイル形式が .xlsx, .xls, .csv か確認
4. パフォーマンス問題
問題: ダッシュボードの読み込みが遅い
解決方法:
Prismaクエリを最適化（select, includeを適切に使用）
データベースインデックスを追加
キャッシュを導入（React Query等）

開発時の注意事項
コーディング規約
TypeScript: 型定義を徹底
命名規則:
コンポーネント: PascalCase
関数・変数: camelCase
定数: UPPER_SNAKE_CASE
コメント: 複雑なロジックには必ずコメント
エラーハンドリング: try-catch を適切に使用
Git運用
ブランチ戦略:
main: 本番用
develop: 開発用
feature/*: 機能追加用
コミットメッセージ:
形式: [type] 概要
type: feat, fix, docs, style, refactor, test, chore
例: [feat] サイトマスタ管理API実装
レビュー観点
[ ] Spec.mdとの整合性
[ ] セキュリティ上の問題はないか
[ ] パフォーマンスに問題はないか
[ ] テストは書かれているか
[ ] エラーハンドリングは適切か

次のステップ
Phase 1開始前の準備
[ ] Spec.mdを再度熟読
[ ] MonitoringSystems_Reference.mdを確認
[ ] 開発環境をセットアップ（Stage 0）
[ ] サンプルデータを準備（各監視システムから）
Phase 1開始
Stage 0: プロジェクトセットアップ から開始
各Stageのタスクを順番に実行
完了確認を必ず実施
問題があればトラブルシューティングを参照

参考リンク
技術ドキュメント
Next.js 14: https://nextjs.org/docs
Prisma: https://www.prisma.io/docs
NextAuth.js v5: https://authjs.dev/
shadcn/ui: https://ui.shadcn.com/
Recharts: https://recharts.org/
xlsx (SheetJS): https://docs.sheetjs.com/
プロジェクトドキュメント
Spec.md: 本プロジェクトの唯一の正解
MonitoringSystems_Reference.md: 監視システム参考情報
マスタープラン.md: 本ドキュメント

最終更新: 2025-02-02 バージョン: 1.0.0 ステータス: Phase 1 開発準備完了
