import { NextResponse } from "next/server";
import { calendarWritePlanSchema } from "@/lib/domain/schemas";
import { getGoogleAccessToken, getGoogleEvent, googleEventId, insertGooglePlanBlock, type GoogleCalendarConnection } from "@/lib/integrations/google-calendar";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (user.demo) throw new Error("Google Calendar接続が必要です");
    const input = calendarWritePlanSchema.parse(await request.json());
    if (input.blocks.some((block) => block.proposalId !== input.proposalId)) throw new Error("提案IDが一致しません");
    const db = await createSupabaseServer();
    const { data, error } = await db!.from("calendar_connections")
      .select("id,encrypted_refresh_token,selected_calendar_ids,write_mode")
      .eq("user_id", user.id).eq("provider", "google").maybeSingle();
    if (error || !data) throw new Error("Google Calendarが未接続です");
    const connection = data as GoogleCalendarConnection;
    if (connection.write_mode === "readonly") return NextResponse.json({ error: "Calendar設定が読み取り専用です。設定で書き込みを許可してください" }, { status: 403 });

    const accessToken = await getGoogleAccessToken(connection);
    const calendarId = "primary";
    const ids = new Map(input.blocks.map((block) => [block.id, googleEventId(user.id, input.proposalId, block.id)]));
    const existing = new Map<string, Awaited<ReturnType<typeof getGoogleEvent>>>();
    for (const block of input.blocks) existing.set(block.id, await getGoogleEvent(accessToken, calendarId, ids.get(block.id)!));

    const registered: Array<{ id: string; title: string; htmlLink?: string; alreadyExisted: boolean }> = [];
    for (const block of input.blocks) {
      const prior = existing.get(block.id);
      const event = prior ?? await insertGooglePlanBlock({
        accessToken, calendarId, eventId: ids.get(block.id)!, title: block.title,
        startsAt: block.startsAt, endsAt: block.endsAt, reason: block.reason,
        location: block.location,
        proposalId: input.proposalId, blockId: block.id, derivedKind: block.derivedKind
      });
      const { error: upsertError } = await db!.from("external_calendar_events").upsert({
        user_id: user.id, connection_id: connection.id, external_calendar_id: calendarId,
        external_event_id: event.id, etag: event.etag, title: event.summary ?? block.title,
        starts_at: event.start?.dateTime ?? block.startsAt, ends_at: event.end?.dateTime ?? block.endsAt,
        location: block.location, status: event.status ?? "confirmed",
        raw: { chronopilotProposalId: input.proposalId, chronopilotBlockId: block.id, htmlLink: event.htmlLink, ...(block.derivedKind ? { chronopilotDerivedKind: block.derivedKind } : {}) }
      }, { onConflict: "user_id,external_calendar_id,external_event_id" });
      if (upsertError) throw new Error("Googleには登録しましたが、ChronoPilotへの同期記録に失敗しました。再実行しても二重登録されません");
      const metadata = { proposalId: input.proposalId, blockId: block.id, source: "ai_suggestion" };
      const { data: storedBlock, error: blockReadError } = await db!.from("plan_blocks").select("id")
        .eq("user_id", user.id).contains("metadata", { proposalId: input.proposalId, blockId: block.id }).limit(1).maybeSingle();
      if (blockReadError) throw new Error("Googleには登録しましたが、ChronoPilot計画の確認に失敗しました");
      if (!storedBlock) {
        const { error: blockInsertError } = await db!.from("plan_blocks").insert({
          id: block.id, user_id: user.id, title: block.title, kind: block.kind ?? "task",
          starts_at: block.startsAt, ends_at: block.endsAt, status: "planned", fixed: true,
          metadata: { ...metadata, location: block.location }
        });
        if (blockInsertError) throw new Error("Googleには登録しましたが、ChronoPilot計画への保存に失敗しました");
      }
      registered.push({ id: event.id, title: event.summary ?? block.title, htmlLink: event.htmlLink, alreadyExisted: Boolean(prior) });
    }
    return NextResponse.json({ registered, calendarId, proposalId: input.proposalId, overlapPolicy: "allow" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Google Calendarへ登録できませんでした" }, { status: 400 });
  }
}
