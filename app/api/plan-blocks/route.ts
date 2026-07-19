import { NextResponse } from "next/server";
import { planBlockCreateSchema } from "@/lib/domain/schemas";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (user.demo) throw new Error("Supabase接続が必要です");
    const input = planBlockCreateSchema.parse(await request.json());
    const db = await createSupabaseServer();
    const { data, error } = await db!.from("plan_blocks").insert({
      user_id: user.id,
      title: input.title,
      kind: input.kind,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      status: "planned",
      fixed: true,
      metadata: { source: "natural_add", location: input.location, reason: input.reason }
    }).select("id,title,kind,starts_at,ends_at,status,fixed").single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "予定を保存できませんでした" }, { status: 400 });
  }
}
