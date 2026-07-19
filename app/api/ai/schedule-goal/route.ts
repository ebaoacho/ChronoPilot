import { NextResponse } from "next/server";
import { OpenAiPlanningProvider } from "@/lib/ai/provider";
import { createFallbackGoalDecomposition, scheduleGoalWork, type BusyInterval } from "@/lib/domain/goal-planner";
import { goalDecompositionSchema, goalPlanningRequestSchema } from "@/lib/domain/schemas";
import { getGoogleAccessToken, listGoogleBusy, type GoogleCalendarConnection } from "@/lib/integrations/google-calendar";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = goalPlanningRequestSchema.parse(await request.json());
    const now = new Date();
    const horizonEnd = new Date(now.getTime() + input.horizonDays * 86400000);
    const db = await createSupabaseServer();
    let connection: GoogleCalendarConnection | null = null;
    const busy: BusyInterval[] = [];
    const warnings: string[] = [];

    if (!user.demo && db) {
      const [{ data: connectionData }, { data: planBlocks, error: planError }] = await Promise.all([
        db.from("calendar_connections").select("id,encrypted_refresh_token,selected_calendar_ids,write_mode").eq("user_id", user.id).eq("provider", "google").maybeSingle(),
        db.from("plan_blocks").select("title,starts_at,ends_at").eq("user_id", user.id).lt("starts_at", horizonEnd.toISOString()).gt("ends_at", now.toISOString())
      ]);
      if (planError) warnings.push("ChronoPilot内の既存計画をすべて取得できませんでした。");
      busy.push(...(planBlocks ?? []).map((block) => ({ title: block.title, startsAt: block.starts_at, endsAt: block.ends_at })));
      connection = connectionData as GoogleCalendarConnection | null;
      if (connection) {
        try {
          const accessToken = await getGoogleAccessToken(connection);
          busy.push(...await listGoogleBusy({ accessToken, calendarIds: connection.selected_calendar_ids ?? ["primary"], start: now.toISOString(), end: horizonEnd.toISOString() }));
        } catch (error) {
          warnings.push(error instanceof Error ? error.message : "最新のGoogle予定を取得できませんでした。");
          const { data: cachedEvents } = await db.from("external_calendar_events").select("title,starts_at,ends_at").eq("user_id", user.id).is("deleted_at", null).lt("starts_at", horizonEnd.toISOString()).gt("ends_at", now.toISOString());
          busy.push(...(cachedEvents ?? []).map((event) => ({ title: event.title, startsAt: event.starts_at, endsAt: event.ends_at })));
        }
      }
    }

    let decomposition = createFallbackGoalDecomposition(input.text, input.deadlineAt);
    let aiMode: "openai" | "fallback" = "fallback";
    if (process.env.OPENAI_API_KEY) {
      try {
        decomposition = goalDecompositionSchema.parse(await new OpenAiPlanningProvider().decomposeGoal({ text: input.text, now: now.toISOString(), deadlineAt: input.deadlineAt, timezone: input.timezone }));
        aiMode = "openai";
      } catch { warnings.push("AIの分解結果を検証できなかったため、安全な汎用プランを使いました。"); }
    }

    let deadlineAt = input.deadlineAt ?? decomposition.deadlineAt ?? horizonEnd.toISOString();
    const deadlineTime = new Date(deadlineAt).getTime();
    if (!Number.isFinite(deadlineTime) || deadlineTime <= now.getTime()) throw new Error("締切は現在より後に設定してください");
    if (!input.deadlineAt && deadlineTime > horizonEnd.getTime()) deadlineAt = horizonEnd.toISOString();
    const proposalId = crypto.randomUUID();
    const plan = scheduleGoalWork({
      proposalId, now: now.toISOString(), deadlineAt, timezoneOffsetMinutes: input.timezoneOffsetMinutes,
      workdayStartHour: input.workdayStartHour, workdayEndHour: input.workdayEndHour,
      decomposition, busy
    });
    if (plan.unscheduled.length) warnings.push(`${plan.unscheduled.length}件は締切までの空き時間に配置できませんでした。`);

    return NextResponse.json({
      proposalId, goalTitle: decomposition.goalTitle, summary: decomposition.summary, assumptions: decomposition.assumptions,
      deadlineAt, blocks: plan.scheduled, unscheduled: plan.unscheduled, warnings, aiMode,
      calendarConnected: Boolean(connection), writeMode: connection?.write_mode ?? "confirm"
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "予定を提案できませんでした" }, { status: 400 });
  }
}
