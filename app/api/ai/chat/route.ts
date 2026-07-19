import { NextResponse } from "next/server";
import { OpenAiPlanningProvider } from "@/lib/ai/provider";
import { dedupeExternalCalendarEvents } from "@/lib/domain/calendar-events";
import { buildFallbackCoachAnswer } from "@/lib/domain/life-coach";
import { coachBlockSchema, lifeCoachInputSchema, lifeCoachResultSchema } from "@/lib/domain/schemas";
import { getGoogleAccessToken, listGoogleBusy, type GoogleCalendarConnection } from "@/lib/integrations/google-calendar";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";
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

function safeCalendarProposal(
  proposal: ReturnType<typeof lifeCoachResultSchema.parse>["calendarProposal"],
  input: ReturnType<typeof lifeCoachInputSchema.parse>
) {
  if (!proposal) return undefined;
  const start = new Date(proposal.startsAt).getTime();
  const end = new Date(proposal.endsAt).getTime();
  const now = new Date(input.now).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < now || end <= start || end - start > 4 * 60 * 60 * 1000) return undefined;
  const collides = input.blocks.some((block) => block.fixed !== false
    && start < new Date(block.endsAt).getTime()
    && end > new Date(block.startsAt).getTime());
  return collides ? undefined : proposal;
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const raw = await request.json() as Record<string, unknown>;
    const now = typeof raw.now === "string" ? raw.now : new Date().toISOString();
    const clientBlocks = Array.isArray(raw.blocks) ? raw.blocks.filter((block): block is { startsAt: string; endsAt: string } & Record<string, unknown> => Boolean(block)&&typeof block==="object"&&typeof (block as {startsAt?:unknown}).startsAt==="string"&&typeof (block as {endsAt?:unknown}).endsAt==="string") : [];
    let calendarConnected = false;
    let writeMode: "confirm" | "today" | "all" | "readonly" = "confirm";
    let serverBlocks: Array<{ title: string; kind: "sleep" | "routine" | "event" | "travel" | "task" | "meal" | "break" | "growth" | "game" | "free"; startsAt: string; endsAt: string; fixed?: boolean }> = [];
    if (!user.demo) {
      try {
        const db = await createSupabaseServer();
        const horizonStart = new Date(new Date(now).getTime() - 60 * 60 * 1000).toISOString();
        const horizonEnd = new Date(new Date(now).getTime() + 7 * 86400000).toISOString();
        const [{ data: events, error: eventsError }, { data: planBlocks, error: planBlocksError }, { data: connection, error: connectionError }] = await Promise.all([
        db!.from("external_calendar_events")
          .select("id,external_event_id,external_calendar_id,title,starts_at,ends_at,raw")
          .eq("user_id", user.id).is("deleted_at", null)
          .lt("starts_at", horizonEnd).gt("ends_at", horizonStart),
        db!.from("plan_blocks")
          .select("title,kind,starts_at,ends_at,fixed")
          .eq("user_id", user.id)
          .lt("starts_at", horizonEnd).gt("ends_at", horizonStart),
        db!.from("calendar_connections")
          .select("id,encrypted_refresh_token,selected_calendar_ids,write_mode")
          .eq("user_id", user.id).eq("provider", "google").maybeSingle()
        ]);
        if (eventsError || planBlocksError || connectionError) {
          console.error("AI coach calendar query fallback", {
            events: eventsError?.code,
            planBlocks: planBlocksError?.code,
            connection: connectionError?.code
          });
        }
        calendarConnected = Boolean(connection);
        writeMode = (connection?.write_mode as typeof writeMode | undefined) ?? "confirm";
        let googleBlocks = dedupeExternalCalendarEvents(events ?? []).map((event) => ({
          title: event.title, kind: "event" as const, startsAt: event.starts_at, endsAt: event.ends_at, fixed: true
        }));
        if (connection) {
          try {
            const accessToken = await getGoogleAccessToken(connection as GoogleCalendarConnection);
            const liveEvents = await listGoogleBusy({
              accessToken,
              calendarIds: Array.isArray(connection.selected_calendar_ids) && connection.selected_calendar_ids.length ? connection.selected_calendar_ids : ["primary"],
              start: horizonStart,
              end: horizonEnd
            });
            const liveUnique = new Map(liveEvents.map((event) => [`${event.title}\u0000${event.startsAt}\u0000${event.endsAt}`, event]));
            googleBlocks = [...liveUnique.values()].map((event) => ({
              title: event.title, kind: "event" as const, startsAt: event.startsAt, endsAt: event.endsAt, fixed: true
            }));
          } catch (error) {
            console.error("AI coach live calendar fallback", { name: error instanceof Error ? error.name : "UnknownError" });
          }
        }
        const internalBlocks = (planBlocks ?? []).flatMap((block) => {
          const parsed = coachBlockSchema.safeParse({
            title: block.title, kind: block.kind, startsAt: block.starts_at, endsAt: block.ends_at, fixed: block.fixed !== false
          });
          return parsed.success ? [parsed.data] : [];
        });
        serverBlocks = [...googleBlocks, ...internalBlocks];
      } catch (error) {
        console.error("AI coach calendar context fallback", { name: error instanceof Error ? error.name : "UnknownError" });
      }
    }
    const mergedBlocks = new Map<string, (typeof serverBlocks)[number] | typeof clientBlocks[number]>();
    for (const block of [...serverBlocks, ...clientBlocks]) {
      const title = typeof block.title === "string" ? block.title : "予定";
      mergedBlocks.set(`${title}\u0000${block.startsAt}\u0000${block.endsAt}`, { ...block, title });
    }
    raw.blocks = selectCoachBlocks([...mergedBlocks.values()], now, 100).flatMap((block) => {
      const parsed = coachBlockSchema.safeParse(block);
      return parsed.success ? [parsed.data] : [];
    });
    if (Array.isArray(raw.tasks)) raw.tasks = raw.tasks.slice(0,100);
    const input = lifeCoachInputSchema.parse(raw);
    const calendarContextCount = serverBlocks.length;
    const computed = buildFallbackCoachAnswer(input);
    const latest = [...input.messages].reverse().find((message) => message.role === "user")?.content ?? "";
    const requiresRealRoute = /(外出|行かな|行きたい|行く|向かう|まで.*(?:何分|時間)|移動|到着|出発)/.test(latest) && !input.route;

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ...computed, aiMode: "fallback", aiIssue: "authentication", calendarConnected, writeMode, calendarContextCount });
    }
    if (requiresRealRoute) {
      return NextResponse.json({ ...computed, aiMode: "fallback", calendarConnected, writeMode, calendarContextCount });
    }

    try {
      const result = lifeCoachResultSchema.parse(await new OpenAiPlanningProvider().chatLifeCoach({
        ...input,
        deterministicContext: computed
      }));
      const preserveComputedDecision = computed.verdict !== "need_more_info";
      const computedProposal = safeCalendarProposal(computed.calendarProposal, input);
      const aiProposal = safeCalendarProposal(result.calendarProposal, input);
      const requestedProposal = computed.calendarProposal ?? result.calendarProposal;
      const calendarProposal = computedProposal ?? aiProposal;
      return NextResponse.json({
        ...result,
        verdict: preserveComputedDecision ? computed.verdict : result.verdict,
        estimatedMinutes: preserveComputedDecision ? computed.estimatedMinutes : result.estimatedMinutes,
        impacts: preserveComputedDecision ? computed.impacts : result.impacts,
        assumptions: Array.from(new Set([
          ...computed.assumptions,
          ...result.assumptions,
          ...(requestedProposal && !calendarProposal ? ["提案時刻が既存予定と重なるため、カレンダー登録候補から外しました。"] : [])
        ])),
        calendarProposal,
        aiMode: "openai",
        calendarConnected,
        writeMode,
        calendarContextCount
      });
    } catch (error) {
      const aiIssue = classifyAiIssue(error);
      console.error("AI coach fallback", {
        issue: aiIssue,
        status: typeof error === "object" && error && "status" in error ? error.status : undefined,
        name: error instanceof Error ? error.name : "UnknownError"
      });
      return NextResponse.json({ ...computed, aiMode: "fallback", aiIssue, calendarConnected, writeMode, calendarContextCount });
    }
  } catch (error) {
    console.error("AI coach request rejected", { name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "相談内容を処理できませんでした。画面を更新して、もう一度お試しください。" }, { status: 400 });
  }
}
