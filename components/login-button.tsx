"use client";
import { createSupabaseBrowser } from "@/lib/supabase/client";
export function LoginButton() {
  return <button className="button" onClick={async()=>{ const supabase=createSupabaseBrowser(); if(!supabase)return; await supabase.auth.signInWithOAuth({provider:"google",options:{redirectTo:`${location.origin}/auth/callback`,queryParams:{prompt:"select_account"}}}); }}>Googleでログイン</button>;
}
