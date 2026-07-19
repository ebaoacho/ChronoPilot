# ChronoPilot AI設計

## 目的

ChronoPilotのAIは「時間管理が得意なもう一人の自分」として、迷いや急な変更を会話で整理します。AIに予定表の事実や時刻計算を創作させず、アプリが計算した事実を自然な日本語、優先順位、選択肢へ変換します。

## 現在AIを使う箇所

| 機能 | AIの役割 | AIが停止した場合 |
| --- | --- | --- |
| Life Coach (`/api/ai/chat`) | 気持ちを受け止める表現、選択肢、説明 | 同じ時間判定をルールベースで回答 |
| 自然言語追加 (`/api/ai/decompose`) | 文章から予定・準備タスクを抽出 | 正規表現でタイトル、準備時間、移動時間を抽出 |
| 日次計画／再計画プロバイダ | 計算済み空き枠への優先順位付け、変更理由 | フォールバックスケジューラが配置 |

`AiPlanningProvider`には起床、出発、ゲーム交渉、成長、振り返り用の境界もありますが、現時点で時刻計算そのものは決定論的ドメインロジックが担当します。未接続のメソッドを「AI実装済み」とは扱いません。

## AIを使わない箇所

- 現在時刻、加減算、開始・終了時刻
- 予定の重複、次の予定、空き時間、可処分時間
- 睡眠確保、起床時刻、出発時刻
- Google Calendarのイベント内容、同期差分、所有権
- 経路の所要時間と距離
- 認証、許可メール、RLS、入力検証

経路時間はGoogle Routes APIの結果、または利用者が手入力した値だけを使います。AIは移動時間を推測しません。

## Life Coachのデータフロー

```text
ブラウザの相談文
  + 今日の計画・タスク・可処分時間
  + 任意の経路結果
        ↓ Zod検証
決定論的な影響判定
        ↓
OpenAI互換API（説明と選択肢）
        ↓ Zod検証・最大2回試行
判定・時間影響を決定論的結果で固定
        ↓
UIへ構造化レスポンス
```

レスポンスは `reply`, `intent`, `verdict`, `confidence`, `estimatedMinutes`, `impacts`, `options`, `questions`, `assumptions` を持ち、`lifeCoachResultSchema`で検証します。AIの応答が失敗・未設定・不正な場合は `buildFallbackCoachAnswer` を返します。

## 会話方針

- 休息やゲームを罪悪感の対象にしない
- 睡眠を削る案を優先しない
- 嘆きには最初に短く共感し、実行可能な選択肢へつなぐ
- 喫煙の質問では感情を否定せず、喫煙を推奨せず、予定への影響と健康判断を分離する
- データがない事実を断定せず、質問または仮定として表示する

## プライバシーとセキュリティ

- APIキーはサーバー環境変数だけで保持します。
- APIは毎回Supabaseセッションを検証します。
- `user_id`をリクエストから受け取りません。
- 会話履歴は現在DBに保存せず、同一タブの `sessionStorage` に最大20件だけ保持します。
- 現在地は利用者がボタンを押した時だけ取得し、DBやLocal Storageへ保存しません。
- メッセージやトークンをサーバーログへ出しません。

## 主な実装ファイル

- `components/life-coach-chat.tsx`: 会話UI、現在地の明示的取得
- `app/api/ai/chat/route.ts`: 認証、入力検証、フォールバック、AI呼び出し
- `lib/domain/life-coach.ts`: 決定論的な予定影響判定
- `lib/ai/provider.ts`: OpenAI互換APIと構造化応答
- `app/api/routes/estimate/route.ts`: サーバー側の経路検索
- `lib/integrations/google-routes.ts`: Google Routes APIアダプター

## 運用と費用

`OPENAI_API_KEY`がなければ会話はルールベースで動作します。`GOOGLE_MAPS_API_KEY`がなければ移動時間を手入力できます。Google Routes APIはGoogle Cloudで課金アカウントとRoutes APIの有効化が必要な任意機能です。利用量、予算アラート、APIキーのサーバー制限をGoogle Cloud側でも設定してください。

参考: [OpenAI GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)、[Google Routes API](https://developers.google.com/maps/documentation/routes/compute_route_directions)、[Routes APIの料金](https://developers.google.com/maps/documentation/routes/usage-and-billing)
