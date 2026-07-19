import { NextResponse } from "next/server";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!user.demo) {
      const db = await createSupabaseServer();
      const { error } = await db!.from("plan_blocks").delete().eq("id", id).eq("user_id", user.id);
      if (error) throw error;
    }
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "予定を削除できませんでした" }, { status: 400 });
  }
}
