import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

const rangeSchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime()
}).refine((value) => {
  const span = new Date(value.end).getTime() - new Date(value.start).getTime();
  return span > 0 && span <= 93 * 86400000;
}, "表示期間は1日以上93日以内にしてください");

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const now = new Date();
    const defaultStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const input = rangeSchema.parse({
      start: url.searchParams.get("start") ?? defaultStart.toISOString(),
      end: url.searchParams.get("end") ?? new Date(defaultStart.getTime() + 86400000).toISOString()
    });
    if (user.demo) return NextResponse.json({ events: [], planBlocks: [], connected: false, lastSyncedAt: null });
    const db = await createSupabaseServer();
    const [{ data: events, error: eventsError }, { data: planBlocks, error: planBlocksError }, { data: connection }] = await Promise.all([
      db!.from("external_calendar_events")
        .select("id,title,starts_at,ends_at,location,external_calendar_id,status,updated_at")
        .eq("user_id", user.id).is("deleted_at", null)
        .lt("starts_at", input.end).gt("ends_at", input.start)
        .order("starts_at", { ascending: true }),
      db!.from("plan_blocks")
        .select("id,title,kind,starts_at,ends_at,status,fixed,metadata")
        .eq("user_id", user.id)
        .lt("starts_at", input.end).gt("ends_at", input.start)
        .order("starts_at", { ascending: true }),
      db!.from("calendar_connections").select("last_synced_at,write_mode").eq("user_id", user.id).eq("provider", "google").maybeSingle()
    ]);
    if (eventsError) throw eventsError;
    if (planBlocksError) throw planBlocksError;
    return NextResponse.json({ events: events ?? [], planBlocks: planBlocks ?? [], connected: Boolean(connection), lastSyncedAt: connection?.last_synced_at ?? null, writeMode: connection?.write_mode ?? "confirm" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "カレンダーを取得できませんでした" }, { status: 400 });
  }
}
