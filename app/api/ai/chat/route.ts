import { NextResponse } from "next/server";
import { OpenAiPlanningProvider } from "@/lib/ai/provider";
import { buildFallbackCoachAnswer } from "@/lib/domain/life-coach";
import { lifeCoachInputSchema, lifeCoachResultSchema } from "@/lib/domain/schemas";
import { requireUser } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    await requireUser();
    const input = lifeCoachInputSchema.parse(await request.json());
    const computed = buildFallbackCoachAnswer(input);
    const latest = [...input.messages].reverse().find((message) => message.role === "user")?.content ?? "";
    const requiresRealRoute = /(外出|行かな|行きたい|行く|向かう|まで.*(?:何分|時間)|移動|到着|出発)/.test(latest) && !input.route;

    if (!process.env.OPENAI_API_KEY || requiresRealRoute) {
      return NextResponse.json({ ...computed, aiMode: "fallback" });
    }

    try {
      const result = lifeCoachResultSchema.parse(await new OpenAiPlanningProvider().chatLifeCoach({
        ...input,
        messages: [...input.messages, {
          role: "assistant" as const,
          content: `決定論的な判定（この事実を変更しない）: ${JSON.stringify(computed)}`
        }]
      }));
      return NextResponse.json({
        ...result,
        verdict: computed.verdict,
        estimatedMinutes: computed.estimatedMinutes,
        impacts: computed.impacts,
        assumptions: Array.from(new Set([...computed.assumptions, ...result.assumptions])),
        aiMode: "openai"
      });
    } catch {
      return NextResponse.json({ ...computed, aiMode: "fallback" });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "相談内容を確認できませんでした" }, { status: 400 });
  }
}
