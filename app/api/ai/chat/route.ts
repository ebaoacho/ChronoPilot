import { NextResponse } from "next/server";
import { OpenAiPlanningProvider } from "@/lib/ai/provider";
import { buildFallbackCoachAnswer } from "@/lib/domain/life-coach";
import { lifeCoachInputSchema, lifeCoachResultSchema } from "@/lib/domain/schemas";
import { requireUser } from "@/lib/supabase/server";
import { selectCoachBlocks } from "@/lib/domain/coach-context";

export async function POST(request: Request) {
  try {
    await requireUser();
    const raw = await request.json() as Record<string, unknown>;
    const now = typeof raw.now === "string" ? raw.now : new Date().toISOString();
    if (Array.isArray(raw.blocks)) raw.blocks = selectCoachBlocks(raw.blocks.filter((block): block is { startsAt: string; endsAt: string } & Record<string, unknown> => Boolean(block)&&typeof block==="object"&&typeof (block as {startsAt?:unknown}).startsAt==="string"&&typeof (block as {endsAt?:unknown}).endsAt==="string"), now, 100);
    if (Array.isArray(raw.tasks)) raw.tasks = raw.tasks.slice(0,100);
    const input = lifeCoachInputSchema.parse(raw);
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
  } catch {
    return NextResponse.json({ error: "相談内容を処理できませんでした。画面を更新して、もう一度お試しください。" }, { status: 400 });
  }
}
