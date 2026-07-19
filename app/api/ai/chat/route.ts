import { NextResponse } from "next/server";
import { OpenAiPlanningProvider } from "@/lib/ai/provider";
import { buildFallbackCoachAnswer } from "@/lib/domain/life-coach";
import { lifeCoachInputSchema, lifeCoachResultSchema } from "@/lib/domain/schemas";
import { requireUser } from "@/lib/supabase/server";
import { selectCoachBlocks } from "@/lib/domain/coach-context";

function classifyAiIssue(error: unknown) {
  const status = typeof error === "object" && error && "status" in error ? Number(error.status) : undefined;
  if (status === 401) return "authentication" as const;
  if (status === 403) return "permission" as const;
  if (status === 404) return "model" as const;
  if (status === 429) return "quota_or_rate_limit" as const;
  if (status && status >= 500) return "provider_unavailable" as const;
  return "invalid_response" as const;
}

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

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ...computed, aiMode: "fallback", aiIssue: "authentication" });
    }
    if (requiresRealRoute) {
      return NextResponse.json({ ...computed, aiMode: "fallback" });
    }

    try {
      const result = lifeCoachResultSchema.parse(await new OpenAiPlanningProvider().chatLifeCoach({
        ...input,
        deterministicContext: computed
      }));
      const preserveComputedDecision = computed.verdict !== "need_more_info";
      return NextResponse.json({
        ...result,
        verdict: preserveComputedDecision ? computed.verdict : result.verdict,
        estimatedMinutes: preserveComputedDecision ? computed.estimatedMinutes : result.estimatedMinutes,
        impacts: preserveComputedDecision ? computed.impacts : result.impacts,
        assumptions: Array.from(new Set([...computed.assumptions, ...result.assumptions])),
        aiMode: "openai"
      });
    } catch (error) {
      const aiIssue = classifyAiIssue(error);
      console.error("AI coach fallback", {
        issue: aiIssue,
        status: typeof error === "object" && error && "status" in error ? error.status : undefined,
        name: error instanceof Error ? error.name : "UnknownError"
      });
      return NextResponse.json({ ...computed, aiMode: "fallback", aiIssue });
    }
  } catch {
    return NextResponse.json({ error: "相談内容を処理できませんでした。画面を更新して、もう一度お試しください。" }, { status: 400 });
  }
}
