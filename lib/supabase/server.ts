import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { hasSupabaseConfig } from "./config";

export async function createSupabaseServer() {
  if (!hasSupabaseConfig) return null;
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => { try { items.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch { /* RSC refreshes in proxy */ } }
    }
  });
}

export async function requireUser() {
  const supabase = await createSupabaseServer();
  if (!supabase) return { id: "demo-user", email: "demo@local.invalid", demo: true as const };
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("AUTH_REQUIRED");
  const allowed = (process.env.ALLOWED_GOOGLE_EMAILS ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && (!user.email || !allowed.includes(user.email.toLowerCase()))) {
    await supabase.auth.signOut();
    throw new Error("ACCOUNT_NOT_ALLOWED");
  }
  return { id: user.id, email: user.email ?? "", demo: false as const };
}
