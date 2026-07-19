import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
export async function GET(request: Request) {
  const url = new URL(request.url); const code = url.searchParams.get("code"); const origin = url.origin;
  const supabase = await createSupabaseServer();
  if (!code || !supabase) return NextResponse.redirect(`${origin}/login?error=oauth`);
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return NextResponse.redirect(`${origin}/login?error=oauth`);
  const allowed=(process.env.ALLOWED_GOOGLE_EMAILS??"").split(",").map(v=>v.trim().toLowerCase()).filter(Boolean);
  if(allowed.length && (!data.user.email || !allowed.includes(data.user.email.toLowerCase()))){ await supabase.auth.signOut(); return NextResponse.redirect(`${origin}/login?error=not_allowed`); }
  return NextResponse.redirect(`${origin}/`);
}
