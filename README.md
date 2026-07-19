# ChronoPilot

「人生をデバッグするAI」をコンセプトにした、1人用のAI Life OSです。タスクを並べるのではなく、予定・移動・睡眠・必須作業・成長・休息を計算し、「今やること」を1つ表示します。ゲームは正当な休息として扱い、睡眠を削らずに再計画します。

## 実装済み

- 「今」1アクション、次の予定、完了、延期、再計画、自由時間、ゲーム開始・終了
- 今日のタイムライン、タスク・プロジェクト登録、朝ルーティン、起床・出発逆算
- 可処分時間（必須・成長・自由・安心ゲーム・未確定）の決定論的計算
- 成長目標・成果物入力、Life Balance、1〜5段階のQOL振り返り
- Google OAuth（Supabase Auth）と許可メール制限
- Google Calendarをログイン権限と分離してOAuth接続、暗号化更新トークン、差分upsert
- OpenAI互換API、JSON構造化出力、Zod検証、再試行、未設定時フォールバック
- 30テーブルのPostgreSQL migration、全所有テーブルのRLS、初回ひな型
- iPhone下部ナビ、PCサイドバー、Safe Area、ダークモード、Reduced Motion
- PWA、Service Worker、オフラインキャッシュ、更新通知、Push購読API、Vercel Cron

## 技術構成

Next.js 16 / React / TypeScript / App Router / Tailwind CSS / Supabase Auth・PostgreSQL・RLS / OpenAI互換API / Google Calendar API / Web Push / Vitest / Playwright / Vercel。

Node.js 20以上、npm、Supabaseアカウント、Google Cloudプロジェクト、Vercelアカウントが必要です。AIを使わない場合はOpenAIキー不要です。DockerがあればSupabaseをローカル起動できます。

## 最短起動

```bash
npm install
cp .env.example .env.local
npm run dev
```

Windows PowerShellでは `Copy-Item .env.example .env.local` を使います。Supabase変数が空なら、外部へデータを送らないブラウザ内デモモードで `http://localhost:3000` をすぐ試せます。本番利用では必ずSupabaseを設定してください。

## 環境変数

`.env.example` を `.env.local` とVercel Project Settingsへ登録します。

| 変数 | 用途 |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | 本番では `https://chronopilot.vercel.app`。ローカルでは `http://localhost:3000` |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ブラウザで使用可能なSupabase公開値 |
| `SUPABASE_SERVICE_ROLE_KEY` | Cron専用。クライアントへ渡さない |
| `ALLOWED_GOOGLE_EMAILS` | 許可メール。複数はカンマ区切り。空は全Googleユーザー許可 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth / Calendar |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Calendar更新トークン用。32文字以上のランダム値 |
| `OPENAI_API_KEY` / `OPENAI_MODEL` / `OPENAI_BASE_URL` | OpenAI互換API。未設定ならルール方式 |
| `CRON_SECRET` | Vercel CronのBearer secret |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push |

秘密値は `NEXT_PUBLIC_` を付けず、ログやGitへ入れないでください。暗号鍵は `openssl rand -base64 48`、Cron secretは `openssl rand -hex 32` などで生成できます。

## Supabase設定

1. Supabase Dashboardでプロジェクトを作成します。
2. CLIを導入し、リポジトリ直下で次を実行します。

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

ローカル検証はDocker起動後に次を実行します。

```bash
npx supabase start
npx supabase db reset
```

Migrationは [supabase/migrations/20260719000000_initial.sql](supabase/migrations/20260719000000_initial.sql) にあります。すべてのユーザー所有テーブルでRLSを有効かつ強制し、`auth.uid() = user_id` のselect/insert/update/deleteポリシーを設定します。外部イベントには `(user_id, external_calendar_id, external_event_id)` のUnique制約があります。初回ログイン時に、編集可能な論文プロジェクト、ルーティン、ゲーム設定、能力領域を本人所有データとして作ります。

Dashboardの Authentication > Providers > Google を有効にし、Google Client ID/Secretを設定してください。SupabaseのSite URLは本番URL、Redirect URLsには次を登録します。

```text
http://localhost:3000/auth/callback
https://YOUR_DOMAIN/auth/callback
```

## Google Cloud / Calendar設定

1. Google Cloud ConsoleでGoogle Calendar APIを有効化します。
2. OAuth同意画面を設定し、個人利用なら自分をTest userへ追加します。
3. Web application OAuth clientへ次を登録します。

```text
Authorized JavaScript origins:
http://localhost:3000
https://YOUR_DOMAIN

Authorized redirect URIs:
https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
http://localhost:3000/api/calendar/callback
https://YOUR_DOMAIN/api/calendar/callback
```

Supabaseログインは基本プロフィール、Calendar接続はCalendar scopeを別途要求します。更新トークンはAES-256-GCMで暗号化してDBへ保存し、Local Storageへ置きません。初期書き込みモードは「常に確認」です。

## AI、Push、Cron

OpenAI互換サービスを使う場合はAPI key、model、必要ならbase URLを設定します。AI出力はJSONとしてZod検証され、1回再試行します。時刻、重複、出発、起床、可処分時間はAIへ委ねません。

VAPID鍵は `npx web-push generate-vapid-keys` で作成できます。iPhoneのWeb PushはHTTPS、ホーム画面へ追加したPWA、ユーザー操作後の通知許可が前提です。OSの集中モードや省電力により配信時刻は保証されません。

Vercel CronはHobbyプランでも追加課金なしで動くよう `/api/cron/sync` を1日1回呼び、`Authorization: Bearer $CRON_SECRET` を検証します。現在のCronは各ユーザーの同期ジョブを安全にqueueへ積み、本人操作のCalendar同期Routeが実同期を行います。Proプランで高頻度同期が必要なら `vercel.json` を `*/30 * * * *` に変更できます。

## テストと品質確認

```bash
npm test
npm run typecheck
npm run lint
npx playwright install chromium webkit
npm run test:e2e
npm run build
```

OAuth・Google API・Pushは外部認証情報なしでもRoute境界と構造化検証をテストでき、実接続は環境別の認証情報で確認します。

## Vercelデプロイ（GitHub不要）

```bash
npm install
npx vercel login
npx vercel link
npx vercel env add NEXT_PUBLIC_APP_URL production
# .env.exampleの残りを同様に登録
npx vercel deploy --prod
```

デプロイ後、`NEXT_PUBLIC_APP_URL=https://chronopilot.vercel.app`、Supabase Site URL、Google OAuth origin/redirectを実URLへ更新して再デプロイします。`vercel.json` にframeworkとCronがあります。Preview URLは都度変わるため、Google OAuth redirectを無制限に追加せず、認証検証は固定の本番または専用preview domainを推奨します。PWA・PushにはHTTPSが必須です。

## iPhoneへ追加

Safariで本番HTTPS URLを開き、共有ボタン →「ホーム画面に追加」→「追加」を選択します。ホーム画面から起動後、設定画面で価値の説明を確認して通知を許可します。SafariタブのままではStandalone限定機能やPush条件が異なります。

## よくあるエラー

- `ACCOUNT_NOT_ALLOWED`: `ALLOWED_GOOGLE_EMAILS` の綴りとカンマ区切りを確認。
- OAuth redirect mismatch: SupabaseとGoogle Cloud双方に、スキーム・ドメイン・パスまで完全一致で登録。
- Calendar更新トークンなし: Googleアカウントのアプリ接続を解除し、`prompt=consent` で再接続。
- RLSで保存失敗: Migration適用、ログインセッション、レコードの`user_id`を確認。クライアント入力からuser_idは受けません。
- PWAが更新されない: アプリ内更新バナーを押すか、一度終了して再起動。
- iPhone通知が出ない: iOS 16.4以上、ホーム画面PWA、通知許可、集中モードを確認。

## セキュリティとバックアップ

Service role、AI key、Google secret、VAPID private keyはサーバー専用です。Calendar tokenは暗号化保存、OAuth state cookieはHttpOnly/SameSite、Routeごとにセッションと許可メールを再検証します。CSP、frame拒否、MIME sniffing拒否、権限ポリシーを設定済みです。暗号鍵を失うと既存Calendar tokenは復号できないため、パスワードマネージャー等へ安全に保管してください。

Supabase DashboardのDatabase Backupsを有効化するか、定期的に次を実行します。

```bash
npx supabase db dump --linked -f backup.sql
```

復元手順を定期的に別プロジェクトで確認し、バックアップと暗号鍵は別の安全な場所で管理してください。
