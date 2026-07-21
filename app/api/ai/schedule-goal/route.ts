import { NextResponse } from "next/server";
import { OpenAiPlanningProvider } from "@/lib/ai/provider";
import { createFallbackGoalDecomposition, scheduleGoalWork, type BusyInterval } from "@/lib/domain/goal-planner";
import { createRecurringPlan, isRecurringScheduleText } from "@/lib/domain/recurring-planner";
import { createFlexibleEventPlan, isFlexibleEventRequest } from "@/lib/domain/flexible-event-planner";
import { createMorningRoutinePlan, fallbackMorningRoutine, isMorningRoutineRequest } from "@/lib/domain/morning-routine-planner";
import { createSleepSchedulePlan, isSleepScheduleRequest } from "@/lib/domain/sleep-schedule-planner";
import { buildRoughPlanResponse, type ExistingEventCandidate } from "@/lib/domain/rough-plan";
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
    let targetSleepMinutes = 420;
    let morningPrepMinutes = 52;
    let defaultTravelMinutes = 30;
    let weekdayGameMinutes = 90;
    let holidayGameMinutes = 150;
    let engineerVision = "大規模なAIサービスを設計し、継続的に価値を届けられるエンジニア";

    if (!user.demo && db) {
      const [{ data: connectionData }, { data: planBlocks, error: planError }, { data: settings }, { data: game }, { data: growth }] = await Promise.all([
        db.from("calendar_connections").select("id,encrypted_refresh_token,selected_calendar_ids,write_mode").eq("user_id", user.id).eq("provider", "google").maybeSingle(),
        db.from("plan_blocks").select("title,starts_at,ends_at").eq("user_id", user.id).lt("starts_at", horizonEnd.toISOString()).gt("ends_at", now.toISOString()),
        db.from("user_settings").select("target_sleep_minutes,morning_prep_minutes,default_travel_minutes").eq("user_id", user.id).maybeSingle(),
        db.from("game_preferences").select("data").eq("user_id", user.id).limit(1).maybeSingle(),
        db.from("growth_goals").select("data").eq("user_id", user.id).eq("name", "目指すエンジニア像").limit(1).maybeSingle()
      ]);
      targetSleepMinutes = settings?.target_sleep_minutes ?? 420;
      morningPrepMinutes = settings?.morning_prep_minutes ?? 52;
      defaultTravelMinutes = settings?.default_travel_minutes ?? 30;
      const gameData = (game?.data ?? {}) as { weekdayMinutes?: number; holidayMinutes?: number };
      const growthData = (growth?.data ?? {}) as { vision?: string };
      weekdayGameMinutes = gameData.weekdayMinutes ?? 90;
      holidayGameMinutes = gameData.holidayMinutes ?? 150;
      engineerVision = growthData.vision ?? engineerVision;
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

    // Prefer real AI understanding when a key is configured: it can extract every
    // distinct item from a rough, multi-item brain dump (creates, updates, deletes)
    // instead of the narrow single-pattern detectors below. Those detectors, and
    // the fallback goal decomposition further down, remain exactly as-is and are
    // used whenever AI is unavailable or its structured output fails validation.
    if (process.env.OPENAI_API_KEY) {
      try {
        const plan = await new OpenAiPlanningProvider().decomposeRoughPlan({
          text: input.text, now: now.toISOString(), timezone: input.timezone,
          settings: { targetSleepMinutes, morningPrepMinutes, defaultTravelMinutes, weekdayGameMinutes, holidayGameMinutes, engineerVision }
        });
        let existingEvents: ExistingEventCandidate[] = [];
        if (!user.demo && db && plan.items.some((item) => item.action === "update" || item.action === "delete")) {
          const { data: rows } = await db.from("external_calendar_events").select("id,title,starts_at,ends_at")
            .eq("user_id", user.id).is("deleted_at", null).lt("starts_at", horizonEnd.toISOString()).gt("ends_at", now.toISOString());
          existingEvents = (rows ?? []).map((row) => ({ id: row.id, title: row.title, startsAt: row.starts_at, endsAt: row.ends_at }));
        }
        const proposalId = crypto.randomUUID();
        const result = buildRoughPlanResponse({
          proposalId, plan, now, timezoneOffsetMinutes: input.timezoneOffsetMinutes,
          workdayStartHour: input.workdayStartHour, workdayEndHour: input.workdayEndHour, horizonDays: input.horizonDays,
          busy, existingEvents, defaultTravelMinutes
        });
        if (result.unscheduled.length) warnings.push(`${result.unscheduled.length}件は無理のない空き時間に配置できませんでした。締切や希望時間帯を調整して再度お試しください。`);
        warnings.push(...result.notes);
        return NextResponse.json({
          proposalId, proposalType: "rough_plan", goalTitle: "AIが複数の項目を解釈しました", summary: result.summary,
          deadlineAt: horizonEnd.toISOString(), blocks: result.creates, updates: result.updates, deletes: result.deletes,
          unscheduled: result.unscheduled, warnings, assumptions: [], aiMode: "openai",
          calendarConnected: Boolean(connection), writeMode: connection?.write_mode ?? "confirm"
        });
      } catch (error) {
        warnings.push(error instanceof Error ? `AIの解釈を検証できなかったため、ルールベースの方式で処理しました（${error.message}）。` : "AIの解釈を検証できなかったため、ルールベースの方式で処理しました。");
      }
    }

    if (isMorningRoutineRequest(input.text)) {
      let suggestion = fallbackMorningRoutine;
      let aiMode: "openai" | "hybrid" = "hybrid";
      if (process.env.OPENAI_API_KEY) {
        try {
          suggestion = await new OpenAiPlanningProvider().suggestMorningRoutine({ text: input.text, morningPrepMinutes, targetSleepMinutes, timezone: input.timezone });
          aiMode = "openai";
        } catch { warnings.push("AIのルーティン提案を検証できなかったため、睡眠を守る標準的な朝ルーティンを使いました。"); }
      }
      const earlyEvent = busy.map((item) => item.startsAt).filter((value) => {
        const date = new Date(value);
        const local = new Date(date.getTime() - input.timezoneOffsetMinutes * 60000);
        return date > now && date.getTime() < now.getTime() + 36 * 60 * 60 * 1000 && local.getUTCHours() < 12;
      }).sort()[0];
      const proposalId = crypto.randomUUID();
      const routine = createMorningRoutinePlan({ now, horizonDays: input.horizonDays, timezoneOffsetMinutes: input.timezoneOffsetMinutes, timeZone: input.timezone, proposalId, morningPrepMinutes, targetSleepMinutes, firstEventAt: earlyEvent, suggestion, requestText: input.text });
      return NextResponse.json({ proposalId, proposalType: "recurring", proposalKind: "morning_routine", goalTitle: routine.title, summary: routine.summary, deadlineAt: horizonEnd.toISOString(), blocks: routine.blocks, series: routine.series, recurrenceLabel: routine.recurrenceLabel, unscheduled: [], warnings, assumptions: routine.assumptions, aiMode, calendarConnected: Boolean(connection), writeMode: connection?.write_mode ?? "confirm" });
    }

    if (isSleepScheduleRequest(input.text)) {
      const wakeBlock = busy.filter((item) => /起床/.test(item.title ?? "") && new Date(item.startsAt) > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
      const earlyEvent = busy.filter((item) => {
        const date = new Date(item.startsAt); const local = new Date(date.getTime() - input.timezoneOffsetMinutes * 60000);
        return !/(?:睡眠|就寝準備)/.test(item.title ?? "") && date > now && date.getTime() < now.getTime() + 36 * 60 * 60 * 1000 && local.getUTCHours() < 12;
      }).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
      const inferredWakeAt = wakeBlock?.startsAt ?? (earlyEvent ? new Date(new Date(earlyEvent.startsAt).getTime() - (morningPrepMinutes + 30) * 60000).toISOString() : undefined);
      const proposalId = crypto.randomUUID();
      const sleep = createSleepSchedulePlan({ text: input.text, now, horizonDays: input.horizonDays, timezoneOffsetMinutes: input.timezoneOffsetMinutes, timeZone: input.timezone, proposalId, targetSleepMinutes, wakeAt: inferredWakeAt });
      return NextResponse.json({ proposalId, proposalType: "recurring", proposalKind: "sleep_schedule", goalTitle: sleep.title, summary: sleep.summary, deadlineAt: horizonEnd.toISOString(), blocks: sleep.blocks, series: sleep.series, recurrenceLabel: sleep.recurrenceLabel, unscheduled: [], warnings, assumptions: sleep.assumptions, aiMode: "hybrid", calendarConnected: Boolean(connection), writeMode: connection?.write_mode ?? "confirm" });
    }

    if (isRecurringScheduleText(input.text)) {
      const proposalId = crypto.randomUUID();
      const recurring = createRecurringPlan({ text: input.text, now, horizonDays: input.horizonDays, timezoneOffsetMinutes: input.timezoneOffsetMinutes, timeZone: input.timezone, proposalId, busy });
      const conflicts = recurring.blocks.filter((block) => busy.some((item) => new Date(block.startsAt) < new Date(item.endsAt) && new Date(item.startsAt) < new Date(block.endsAt)));
      if (conflicts.length) warnings.push(`${conflicts.length}件が既存予定と重なっています。設定に従い、すべて同じ時間帯へ重ねて登録できます。`);
      return NextResponse.json({
        proposalId, proposalType: "recurring", goalTitle: recurring.title, summary: recurring.summary,
        deadlineAt: horizonEnd.toISOString(), blocks: recurring.blocks, standaloneBlocks: recurring.standaloneBlocks ?? [], series: recurring.series,
        recurrenceLabel: recurring.recurrenceLabel, unscheduled: [], warnings,
        assumptions: recurring.assumptions, aiMode: "hybrid",
        calendarConnected: Boolean(connection), writeMode: connection?.write_mode ?? "confirm"
      });
    }

    if (isFlexibleEventRequest(input.text)) {
      const proposalId = crypto.randomUUID();
      const plan = createFlexibleEventPlan({
        proposalId, text: input.text, now, timezoneOffsetMinutes: input.timezoneOffsetMinutes,
        preferredStartHour: Math.max(input.workdayStartHour, 9), preferredEndHour: Math.min(input.workdayEndHour, 19), busy
      });
      if (plan.unscheduled.length) warnings.push("指定された候補日に空き時間が見つかりませんでした。日付や時間帯を変えて再度お試しください。");
      return NextResponse.json({
        proposalId, proposalType: "goal", proposalKind: "flexible_event", goalTitle: plan.title, summary: plan.summary,
        deadlineAt: horizonEnd.toISOString(), blocks: plan.scheduled, unscheduled: plan.unscheduled, warnings,
        assumptions: plan.assumptions, aiMode: "hybrid", calendarConnected: Boolean(connection), writeMode: connection?.write_mode ?? "confirm"
      });
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
      proposalId, proposalType: "goal", goalTitle: decomposition.goalTitle, summary: decomposition.summary, assumptions: decomposition.assumptions,
      deadlineAt, blocks: plan.scheduled, unscheduled: plan.unscheduled, warnings, aiMode,
      calendarConnected: Boolean(connection), writeMode: connection?.write_mode ?? "confirm"
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "予定を提案できませんでした" }, { status: 400 });
  }
}
