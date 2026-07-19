import { NextResponse } from "next/server";
import { routeEstimateRequestSchema } from "@/lib/domain/schemas";
import { estimateGoogleRoute } from "@/lib/integrations/google-routes";
import { requireUser } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    await requireUser();
    const input = routeEstimateRequestSchema.parse(await request.json());
    const route = await estimateGoogleRoute(input);
    return NextResponse.json(route);
  } catch (error) {
    const message = error instanceof Error ? error.message : "経路を取得できませんでした";
    const needsConfiguration = message === "GOOGLE_MAPS_API_KEY_NOT_CONFIGURED";
    return NextResponse.json({
      error: needsConfiguration ? "経路検索はまだ設定されていません。所要時間を手入力できます。" : message,
      requiresConfiguration: needsConfiguration
    }, { status: needsConfiguration ? 503 : 400 });
  }
}
