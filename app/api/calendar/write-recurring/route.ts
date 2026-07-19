import { NextResponse } from "next/server";
import { calendarWriteRecurringSchema } from "@/lib/domain/schemas";
import { getGoogleAccessToken, getGoogleEvent, googleEventId, insertGoogleRecurringBlock, type GoogleCalendarConnection } from "@/lib/integrations/google-calendar";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (user.demo) throw new Error("Google Calendar接続が必要です");
    const input = calendarWriteRecurringSchema.parse(await request.json());
    const db = await createSupabaseServer();
    const { data, error } = await db!.from("calendar_connections").select("id,encrypted_refresh_token,selected_calendar_ids,write_mode").eq("user_id", user.id).eq("provider", "google").maybeSingle();
    if (error || !data) throw new Error("Google Calendarが未接続です");
    const connection = data as GoogleCalendarConnection;
    if (connection.write_mode === "readonly") return NextResponse.json({ error: "Calendar設定が読み取り専用です" }, { status: 403 });
    const accessToken = await getGoogleAccessToken(connection);
    const calendarId = "primary";
    const registered: Array<{ id: string; title: string; alreadyExisted: boolean }> = [];
    for (const series of input.series) {
      const eventId = googleEventId(user.id, input.proposalId, series.id);
      const prior = await getGoogleEvent(accessToken, calendarId, eventId);
      const event = prior ?? await insertGoogleRecurringBlock({ accessToken, calendarId, eventId, title: series.title, startsAt: series.startsAt, endsAt: series.endsAt, reason: series.reason, location: series.location, recurrence: series.recurrence, timeZone: series.timeZone, proposalId: input.proposalId, seriesId: series.id });
      const { error: eventError } = await db!.from("external_calendar_events").upsert({
        user_id: user.id, connection_id: connection.id, external_calendar_id: calendarId, external_event_id: event.id,
        etag: event.etag, title: event.summary ?? series.title, starts_at: series.startsAt, ends_at: series.endsAt,
        location: series.location, status: event.status ?? "confirmed", raw: { recurrence: series.recurrence, proposalId: input.proposalId, seriesId: series.id }
      }, { onConflict: "user_id,external_calendar_id,external_event_id" });
      if (eventError) throw new Error("Googleには登録しましたが、同期記録に失敗しました。再実行しても二重登録されません");
      registered.push({ id: event.id, title: event.summary ?? series.title, alreadyExisted: Boolean(prior) });
    }
    const rows = input.blocks.map((block) => ({ id: block.id, user_id: user.id, title: block.title, kind: block.kind ?? "event", starts_at: block.startsAt, ends_at: block.endsAt, status: "planned", fixed: true, metadata: { proposalId: input.proposalId, source: "recurring_schedule", location: block.location } }));
    const { error: blocksError } = await db!.from("plan_blocks").upsert(rows, { onConflict: "id" });
    if (blocksError) throw new Error("Googleには登録しましたが、ChronoPilot計画の保存に失敗しました");
    return NextResponse.json({ registered, proposalId: input.proposalId, occurrences: input.blocks.length, overlapPolicy: "allow" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "定期予定を登録できませんでした" }, { status: 400 });
  }
}
