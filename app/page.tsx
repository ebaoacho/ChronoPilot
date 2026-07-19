import { Dashboard } from "@/components/dashboard";
import { Onboarding, type OnboardingInitialValues } from "@/components/onboarding";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export default async function Home() {
  const user = await requireUser();
  let onboarding = false;
  let initial: OnboardingInitialValues | undefined;

  if (!user.demo) {
    const db = await createSupabaseServer();
    const [{ data: profile, error: profileError }, { data: settings }, { data: game }, { data: growth }] = await Promise.all([
      db!.from("profiles").select("onboarding_completed").eq("user_id", user.id).maybeSingle(),
      db!.from("user_settings").select("target_sleep_minutes,morning_prep_minutes,default_travel_minutes").eq("user_id", user.id).maybeSingle(),
      db!.from("game_preferences").select("data").eq("user_id", user.id).limit(1).maybeSingle(),
      db!.from("growth_goals").select("data").eq("user_id", user.id).eq("name", "目指すエンジニア像").limit(1).maybeSingle()
    ]);
    onboarding = Boolean(profileError) || !profile?.onboarding_completed;
    const gameData = (game?.data ?? {}) as { weekdayMinutes?: number; holidayMinutes?: number };
    const growthData = (growth?.data ?? {}) as { vision?: string };
    initial = {
      targetSleepMinutes: settings?.target_sleep_minutes ?? 420,
      morningPrepMinutes: settings?.morning_prep_minutes ?? 52,
      defaultTravelMinutes: settings?.default_travel_minutes ?? 30,
      weekdayGameMinutes: gameData.weekdayMinutes ?? 90,
      holidayGameMinutes: gameData.holidayMinutes ?? 150,
      engineerVision: growthData.vision ?? "大規模なAIサービスを設計し、継続的に価値を届けられるエンジニア"
    };
  }

  return <><Dashboard demo={user.demo} email={user.email}/><Onboarding show={onboarding} initial={initial}/></>;
}
