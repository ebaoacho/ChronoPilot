import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteGoogleEvent, getGoogleAccessToken, type GoogleCalendarConnection } from "@/lib/integrations/google-calendar";
import { resolveGoogleDeleteTarget } from "@/lib/domain/calendar-delete";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

const inputSchema = z.object({ scope: z.enum(["single", "series"]).default("single") });

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    if (user.demo) return NextResponse.json({ deletedPlanBlockIds: [] });
    const { id } = await params;
    const input = inputSchema.parse(await request.json().catch(() => ({})));
    const db = await createSupabaseServer();
    const { data: event, error } = await db!.from("external_calendar_events")
      .select("id,connection_id,external_calendar_id,external_event_id,title,starts_at,raw")
      .eq("id", id).eq("user_id", user.id).is("deleted_at", null).single();
    if (error || !event) throw new Error("削除対象の予定が見つかりません");
    const { data: connection, error: connectionError } = await db!.from("calendar_connections")
      .select("id,encrypted_refresh_token,selected_calendar_ids,write_mode")
      .eq("id", event.connection_id).eq("user_id", user.id).single();
    if (connectionError || !connection) throw new Error("Google Calendar接続が見つかりません");
    const raw = (event.raw ?? {}) as Record<string, unknown>;
    const target = resolveGoogleDeleteTarget(event.external_event_id, raw, input.scope);
    const recurringEventId = target.recurringEventId;
    const accessToken = await getGoogleAccessToken(connection as GoogleCalendarConnection);
    await deleteGoogleEvent(accessToken, event.external_calendar_id, target.eventId);
    const deletedAt = new Date().toISOString();
    await db!.from("external_calendar_events").update({ deleted_at: deletedAt, status: "cancelled" }).eq("id", event.id).eq("user_id", user.id);
    if (input.scope === "series" && recurringEventId) {
      await Promise.all([
        db!.from("external_calendar_events").update({ deleted_at: deletedAt, status: "cancelled" }).eq("user_id", user.id).eq("external_calendar_id", event.external_calendar_id).eq("external_event_id", recurringEventId),
        db!.from("external_calendar_events").update({ deleted_at: deletedAt, status: "cancelled" }).eq("user_id", user.id).eq("external_calendar_id", event.external_calendar_id).contains("raw", { recurringEventId })
      ]);
    }
    const proposalId = typeof raw.proposalId === "string" ? raw.proposalId : typeof raw.chronopilotProposalId === "string" ? raw.chronopilotProposalId : undefined;
    let deletedPlanBlockIds: string[] = [];
    if (proposalId) {
      let query = db!.from("plan_blocks").select("id").eq("user_id", user.id).eq("title", event.title).contains("metadata", { proposalId });
      if (input.scope === "single") query = query.eq("starts_at", event.starts_at);
      const { data: linked } = await query;
      deletedPlanBlockIds = (linked ?? []).map((block) => block.id);
      if (deletedPlanBlockIds.length) await db!.from("plan_blocks").delete().eq("user_id", user.id).in("id", deletedPlanBlockIds);
    }
    return NextResponse.json({ deletedPlanBlockIds, scope: input.scope });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "予定を削除できませんでした" }, { status: 400 });
  }
}
