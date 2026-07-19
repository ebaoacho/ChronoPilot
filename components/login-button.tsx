"use client";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { resolveAppOrigin } from "@/lib/app-url";
export function LoginButton() {
  return <button className="button" onClick={async()=>{ const supabase=createSupabaseBrowser(); if(!supabase)return; const origin=resolveAppOrigin(location.origin,process.env.NEXT_PUBLIC_APP_URL); await supabase.auth.signInWithOAuth({provider:"google",options:{redirectTo:`${origin}/auth/callback`,queryParams:{prompt:"select_account"}}}); }}>Googleでログイン</button>;
}
