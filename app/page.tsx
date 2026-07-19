import { Dashboard } from "@/components/dashboard";
import { requireUser } from "@/lib/supabase/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { Onboarding } from "@/components/onboarding";

export default async function Home() {
  const user = await requireUser();
  let onboarding=false;
  if(!user.demo){const db=await createSupabaseServer();const {data}=await db!.from("profiles").select("onboarding_completed").eq("user_id",user.id).single();onboarding=!data?.onboarding_completed;}
  return <><Dashboard demo={user.demo} email={user.email} /><Onboarding show={onboarding}/></>;
}
