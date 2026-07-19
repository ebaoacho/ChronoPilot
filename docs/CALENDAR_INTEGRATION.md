# Google Calendar連携設計

## 認証の分離

Supabase AuthのGoogleログインはアプリへの本人確認です。Google Calendar連携は別のOAuth同意で、予定の閲覧・登録用`calendar.events`とカレンダー一覧取得用`calendar.calendarlist.readonly`だけを取得します。ログインしただけでカレンダー権限を要求しません。

Calendarのrefresh tokenはAES-256-GCMで暗号化して `calendar_connections.encrypted_refresh_token` に保存します。ブラウザのLocal Storageへ保存せず、access tokenもAPI Route内だけで使用します。

## 同期フロー

```text
設定からCalendar接続
  → Google OAuth同意
  → 暗号化refresh tokenを保存
  → /api/calendar/sync
  → calendarListと選択カレンダーのeventsを取得
  → external_calendar_eventsへupsert
  → /api/calendar/events
  → 今日画面にGoogle予定とChronoPilot計画を分けて表示
```

重複防止キーは `(user_id, external_calendar_id, external_event_id)` です。キャンセルされたイベントには `deleted_at` を設定し、通常表示から除外します。RLSとAPI側の `user_id` 条件を併用します。

## カレンダー画面で確認できる内容

- Google Calendar由来かChronoPilot由来か
- 予定名、開始・終了時刻、場所
- Google側の登録先calendar ID
- 同期件数と最終同期時刻
- ChronoPilot内のブロック種別（タスク、移動、休憩、ゲーム等）

「同期」ボタンはGoogle側から最新状態を再取得します。DB migrationが未適用の場合、この画面は取得エラーを明示します。

## 書き込みモード

DBは `confirm`, `today`, `all`, `readonly` を保持できます。AI予定提案は、目標を作業へ分解した後、最新のGoogle予定とChronoPilot計画の空き時間へ決定論的に配置します。既定の `confirm` ではプレビュー後に明示的な登録操作が必要です。「提案後、そのまま登録」を利用者が選んだ場合は、同じ操作内で登録まで実行します。`readonly` では書き込みません。

登録直前にGoogle Calendarを再取得し、重複が見つかった場合は登録を止めて再提案を求めます。イベントIDはユーザー・提案・ブロックから決定論的に生成するため、通信再試行でも二重登録しません。登録イベントにはChronoPilot提案IDをGoogleのprivate extended propertiesとDBの`raw`へ保存します。

## 必要なGoogle設定

Google CloudでCalendar APIを有効にし、OAuth redirect URIへ以下を登録します。

```text
https://chronopilot.vercel.app/api/calendar/callback
http://localhost:3000/api/calendar/callback
```

Supabase Authのcallback URI (`https://PROJECT_REF.supabase.co/auth/v1/callback`) とは別です。
