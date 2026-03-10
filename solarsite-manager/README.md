# SolarSite Manager (Phase 1 MVP)

太陽光発電所統合管理システム「SolarSite Manager」の開発用リポジトリです。  
仕様の唯一の正解は親ディレクトリの `doc/01spec.md`（Spec.md）です。

## 実装済み機能（Phase 1）

| 機能 | 説明 |
|------|------|
| **F-1 ユーザー認証** | ログイン・新規登録・ログアウト、パスワードルール（8〜128文字・英数字混在） |
| **F-2 サイトマスタ管理** | サイト一覧・新規登録・詳細・編集、6サイトシード |
| **F-3 Excel/CSV アップロード** | ファイル選択・サイト選択・取込、10MB 制限 |
| **F-4 マルチフォーマット** | 日付・発電量カラムの自動検出（xlsx 対応） |
| **F-5 発電量ダッシュボード** | 6サイトサマリーカード・最新発電状況 |
| **F-6 日別発電量表示** | 過去30日グラフ（Recharts） |
| **F-7 月別・年別集計** | API: /api/generation/monthly, /yearly |
| **F-8 リアルタイム状況** | API: /api/generation/latest、ダッシュボード表示 |
| **F-9 アラート管理** | 発電停止・低下・データ未更新の検知、一覧・解決 |
| **アップロード履歴** | /history で取込履歴一覧、/api/upload-history |
| **設定** | /settings でプロフィール表示 |

## セットアップ手順（開発環境）

### 1. 必要なツール

- Node.js 18 以上
- npm または pnpm / yarn
- データベース: SQLite（開発用、`file:./dev.db`）

### 2. 依存パッケージのインストール

```bash
cd solarsite-manager
npm install
```

### 3. 環境変数の設定

親ディレクトリの `doc/01spec.md` セクション 9.3 を参照し、`.env.example` をコピーして `.env.local` を作成します。

```bash
cp .env.example .env.local
```

主な変数:

- `DATABASE_URL` : `file:./dev.db`（SQLite）
- `NEXTAUTH_SECRET` : 32 文字以上のランダム文字列
- `NEXTAUTH_URL` : `http://localhost:3000`
- `UPLOAD_DIR` : アップロードファイル保存先（デフォルト `./uploads`）

### 4. データベースマイグレーションとシード

```bash
npx prisma migrate dev --name init
npx prisma generate
npm run prisma:seed
```

- マイグレーションでテーブル作成
- シードでテストユーザー（`test@example.com` / `Test1234`）と 6 サイトが登録されます

### 5. 開発サーバー起動

```bash
npm run dev
```

`http://localhost:3000` にアクセスし、ログインまたは新規登録後にダッシュボードを利用できます。

## ディレクトリ構成（抜粋）

```
solarsite-manager/
├── src/
│   ├── app/
│   │   ├── (auth)/          # ログイン・新規登録等
│   │   ├── (protected)/     # 認証必須ページ
│   │   │   ├── dashboard/
│   │   │   ├── sites/
│   │   │   ├── upload/
│   │   │   ├── alerts/
│   │   │   ├── history/
│   │   │   └── settings/
│   │   └── api/             # API ルート
│   ├── components/
│   ├── lib/
│   ├── services/           # fileParser, alertService
│   └── types/
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── uploads/                 # アップロード保存先
├── .env.example
└── README.md
```

詳細な開発計画は親ディレクトリの `doc/02masterplan.md`（マスタープラン）を参照してください。
