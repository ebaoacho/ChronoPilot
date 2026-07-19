import { NextResponse } from "next/server";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";
import { onboardingSettingsSchema } from "@/lib/domain/schemas";

export async function GET() {
  try {
    const user = await requireUser();
    if (user.demo) return NextResponse.json({ completed: false });
    const db = await createSupabaseServer();
    const [{ data: profile, error: profileError }, { data: settings, error: settingsError }, { data: game, error: gameError }] = await Promise.all([
      db!.from("profiles").select("onboarding_completed").eq("user_id", user.id).maybeSingle(),
      db!.from("user_settings").select("target_sleep_minutes,morning_prep_minutes,default_travel_minutes").eq("user_id", user.id).maybeSingle(),
      db!.from("game_preferences").select("data").eq("user_id", user.id).limit(1).maybeSingle()
    ]);
    if (profileError || settingsError || gameError) throw profileError ?? settingsError ?? gameError;
    const gameData = (game?.data ?? {}) as { weekdayMinutes?: number; holidayMinutes?: number };
    return NextResponse.json({
      completed: Boolean(profile?.onboarding_completed),
      targetSleepMinutes: settings?.target_sleep_minutes ?? 420,
      morningPrepMinutes: settings?.morning_prep_minutes ?? 52,
      defaultTravelMinutes: settings?.default_travel_minutes ?? 30,
      weekdayGameMinutes: gameData.weekdayMinutes ?? 90,
      holidayGameMinutes: gameData.holidayMinutes ?? 150
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "設定を取得できませんでした" }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = onboardingSettingsSchema.parse(await request.json());
    if (user.demo) return NextResponse.json({ saved: true });
    const db = await createSupabaseServer();

    const { error: settingsError } = await db!.from("user_settings").upsert({
      user_id: user.id,
      target_sleep_minutes: input.targetSleepMinutes,
      morning_prep_minutes: input.morningPrepMinutes,
      default_travel_minutes: input.defaultTravelMinutes
    }, { onConflict: "user_id" });
    if (settingsError) throw settingsError;

    const { data: gamePreference, error: gameReadError } = await db!.from("game_preferences")
      .select("id").eq("user_id", user.id).limit(1).maybeSingle();
    if (gameReadError) throw gameReadError;
    const gameValues = {
      name: "ゲーム設定",
      data: {
        weekdayMinutes: input.weekdayGameMinutes,
        holidayMinutes: input.holidayGameMinutes,
        minimumMinutes: 30,
        maxContinuousMinutes: 120,
        bedtimeBufferMinutes: 60,
        treatAsRest: true
      }
    };
    const gameQuery = gamePreference
      ? db!.from("game_preferences").update(gameValues).eq("id", gamePreference.id).eq("user_id", user.id)
      : db!.from("game_preferences").insert({ user_id: user.id, ...gameValues });
    const { error: gameError } = await gameQuery;
    if (gameError) throw gameError;

    const { data: growthGoal, error: growthReadError } = await db!.from("growth_goals")
      .select("id").eq("user_id", user.id).eq("name", "目指すエンジニア像").limit(1).maybeSingle();
    if (growthReadError) throw growthReadError;
    const growthValues = { name: "目指すエンジニア像", data: { vision: input.engineerVision, horizon: "long_term" } };
    const growthQuery = growthGoal
      ? db!.from("growth_goals").update(growthValues).eq("id", growthGoal.id).eq("user_id", user.id)
      : db!.from("growth_goals").insert({ user_id: user.id, ...growthValues });
    const { error: growthError } = await growthQuery;
    if (growthError) throw growthError;

    const { data: profile, error: profileError } = await db!.from("profiles").upsert({
      id: user.id,
      user_id: user.id,
      onboarding_completed: true
    }, { onConflict: "user_id" }).select("onboarding_completed").single();
    if (profileError) throw profileError;
    if (!profile.onboarding_completed) throw new Error("初期設定の完了状態を保存できませんでした");

    return NextResponse.json({ saved: true, completed: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "設定を保存できませんでした" }, { status: 400 });
  }
}
