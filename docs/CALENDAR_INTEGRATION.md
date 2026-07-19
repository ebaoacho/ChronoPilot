# Google Calendar連携設計

## 認証の分離

Supabase AuthのGoogleログインはアプリへの本人確認です。Google Calendar連携は別のOAuth同意で `calendar` scopeを取得します。ログインしただけでカレンダー権限を要求しません。

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

DBは `confirm`, `today`, `all`, `readonly` を保持できます。現バージョンで完成しているのはOAuth接続、読み取り同期、変更・削除検知用データ、画面表示です。ChronoPilotの計画をGoogleへ書き戻す操作はまだ有効化していません。意図せず大量登録しないため、書き込み実装時も `confirm` を初期値にします。

## 必要なGoogle設定

Google CloudでCalendar APIを有効にし、OAuth redirect URIへ以下を登録します。

```text
https://chronopilot.vercel.app/api/calendar/callback
http://localhost:3000/api/calendar/callback
```

Supabase Authのcallback URI (`https://PROJECT_REF.supabase.co/auth/v1/callback`) とは別です。
