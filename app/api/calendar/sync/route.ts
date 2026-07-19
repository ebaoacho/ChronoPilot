import { NextResponse } from "next/server";
import { getGoogleAccessToken, type GoogleCalendarConnection } from "@/lib/integrations/google-calendar";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

type GoogleCalendar = {
  id: string;
  selected?: boolean;
  primary?: boolean;
};

type GoogleEvent = {
  id: string;
  etag?: string;
  summary?: string;
  status?: string;
  location?: string;
  recurringEventId?: string;
  originalStartTime?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

/** Google treats `primary` and the primary calendar's email ID as aliases. */
export function canonicalizeCalendarIds(calendarIds: string[], primaryCalendarId?: string) {
  return [...new Set(calendarIds
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => id === "primary" && primaryCalendarId ? primaryCalendarId : id))];
}

export async function POST() {
  try {
    const user = await requireUser();
    if (user.demo) throw new Error("Google Calendarへの接続が必要です");

    const db = await createSupabaseServer();
    const { data: connection, error } = await db!.from("calendar_connections")
      .select("*")
      .eq("user_id", user.id)
      .eq("provider", "google")
      .single();
    if (error || !connection) throw new Error("Google Calendarが未接続です");

    const accessToken = await getGoogleAccessToken(connection as GoogleCalendarConnection);
    const calendarResponse = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
      headers: { authorization: `Bearer ${accessToken}` }
    });
    if (!calendarResponse.ok) throw new Error("カレンダー一覧を取得できませんでした");

    const calendars = await calendarResponse.json() as { items?: GoogleCalendar[] };
    const calendarItems = calendars.items ?? [];
    const primaryCalendarId = calendarItems.find((calendar) => calendar.primary)?.id;
    const requestedIds: string[] = connection.selected_calendar_ids?.length
      ? connection.selected_calendar_ids
      : calendarItems.filter((calendar) => calendar.selected).map((calendar) => calendar.id);
    const selected = canonicalizeCalendarIds(
      requestedIds.length ? requestedIds : [primaryCalendarId ?? "primary"],
      primaryCalendarId
    );

    let count = 0;
    let primarySynced = false;
    for (const calendarId of selected) {
      const params = new URLSearchParams({
        singleEvents: "true",
        showDeleted: "true",
        timeMin: new Date(Date.now() - 7 * 86400000).toISOString(),
        timeMax: new Date(Date.now() + 90 * 86400000).toISOString(),
        maxResults: "2500"
      });
      const eventsResponse = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
        { headers: { authorization: `Bearer ${accessToken}` } }
      );
      if (!eventsResponse.ok) continue;
      if (primaryCalendarId && calendarId === primaryCalendarId) primarySynced = true;

      const events = await eventsResponse.json() as { items?: GoogleEvent[] };
      const recurringMasterIds = new Set<string>();
      for (const event of events.items ?? []) {
        if (event.recurringEventId) recurringMasterIds.add(event.recurringEventId);
        const start = event.start?.dateTime ?? event.start?.date;
        const end = event.end?.dateTime ?? event.end?.date;
        if (event.status === "cancelled" && (!start || !end)) {
          await db!.from("external_calendar_events")
            .update({ status: "cancelled", deleted_at: new Date().toISOString() })
            .eq("user_id", user.id)
            .eq("external_calendar_id", calendarId)
            .eq("external_event_id", event.id);
          continue;
        }
        if (!start || !end) continue;

        const raw = {
          recurringEventId: event.recurringEventId,
          originalStartTime: event.originalStartTime,
          ...event.extendedProperties?.private
        };
        const { error: upsertError } = await db!.from("external_calendar_events").upsert({
          user_id: user.id,
          connection_id: connection.id,
          external_calendar_id: calendarId,
          external_event_id: event.id,
          etag: event.etag,
          title: event.summary ?? "(無題)",
          starts_at: new Date(start).toISOString(),
          ends_at: new Date(end).toISOString(),
          location: event.location,
          status: event.status,
          raw,
          deleted_at: event.status === "cancelled" ? new Date().toISOString() : null
        }, { onConflict: "user_id,external_calendar_id,external_event_id" });
        if (!upsertError) count++;
      }
      if (recurringMasterIds.size) {
        await db!.from("external_calendar_events")
          .delete()
          .eq("user_id", user.id)
          .eq("connection_id", connection.id)
          .eq("external_calendar_id", calendarId)
          .in("external_event_id", [...recurringMasterIds]);
      }
    }

    // Remove rows previously saved through the `primary` alias only after the
    // canonical primary calendar has synced successfully.
    if (primarySynced && primaryCalendarId && primaryCalendarId !== "primary") {
      await db!.from("external_calendar_events")
        .delete()
        .eq("user_id", user.id)
        .eq("connection_id", connection.id)
        .eq("external_calendar_id", "primary");
    }

    await db!.from("calendar_connections").update({
      last_synced_at: new Date().toISOString(),
      selected_calendar_ids: selected
    }).eq("id", connection.id).eq("user_id", user.id);

    return NextResponse.json({ synced: count, calendars: selected.length });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "同期できませんでした"
    }, { status: 400 });
  }
}
