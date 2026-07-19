import { addDays } from "date-fns";
import type { MorningRoutineSuggestion } from "@/lib/ai/provider";
import type { RecurringPlan, RecurringSeries } from "@/lib/domain/recurring-planner";

const MINUTE = 60_000;

export function isMorningRoutineRequest(text: string) {
  return /(?:起床|起きる|モーニングルーティン|朝(?:の)?ルーティン|朝習慣)/.test(text) && /(?:おすすめ|考えて|提案|組み込|作って)/.test(text);
}

export const fallbackMorningRoutine: MorningRoutineSuggestion = {
  title: "おすすめモーニングルーティン",
  steps: [
    { title: "起床して水を飲む", minutes: 5, reason: "無理なく身体を起こすきっかけにするため" },
    { title: "朝の光を浴びる", minutes: 5, reason: "窓辺や屋外で穏やかに朝を始めるため" },
    { title: "軽く身体を動かす", minutes: 7, reason: "負担のない範囲で活動へ切り替えるため" },
    { title: "洗顔・着替え", minutes: 15, reason: "外出や作業を始められる状態に整えるため" },
    { title: "朝食", minutes: 15, reason: "朝の生活時間を慌てず確保するため" },
    { title: "今日の優先事項を確認", minutes: 5, reason: "今やることを一つに絞るため" }
  ],
  assumptions: []
};

function localTimestamp(date: Date, hour: number, minute: number, timezoneOffsetMinutes: number) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute) + timezoneOffsetMinutes * MINUTE;
}

function fitSteps(steps: MorningRoutineSuggestion["steps"], targetMinutes: number) {
  const total = steps.reduce((sum, step) => sum + step.minutes, 0);
  if (total === targetMinutes) return steps;
  const scaled = steps.map((step) => ({ ...step, minutes: Math.max(2, Math.round(step.minutes * targetMinutes / total)) }));
  const difference = targetMinutes - scaled.reduce((sum, step) => sum + step.minutes, 0);
  scaled[scaled.length - 1].minutes = Math.max(2, scaled[scaled.length - 1].minutes + difference);
  return scaled;
}

export function createMorningRoutinePlan(input: {
  now: Date;
  horizonDays: number;
  timezoneOffsetMinutes: number;
  timeZone: string;
  proposalId: string;
  morningPrepMinutes: number;
  targetSleepMinutes: number;
  firstEventAt?: string;
  suggestion: MorningRoutineSuggestion;
  requestText: string;
}): RecurringPlan {
  const today = new Date(input.now.getFullYear(), input.now.getMonth(), input.now.getDate());
  let startDate = today;
  let wakeHour = 7;
  let wakeMinute = 0;
  const explicit = input.requestText.match(/(?:起床|起き(?:る|たい)?)(?:は|を)?\s*(\d{1,2})時(?:([0-5]\d)分)?|(?:(\d{1,2})時(?:([0-5]\d)分)?)(?:に)?(?:起床|起き)/);
  if (explicit) { wakeHour = Number(explicit[1] ?? explicit[3]); wakeMinute = Number(explicit[2] ?? explicit[4] ?? 0); }
  if (localTimestamp(startDate, wakeHour, wakeMinute, input.timezoneOffsetMinutes) <= input.now.getTime()) startDate = addDays(startDate, 1);
  if (input.firstEventAt) {
    const event = new Date(input.firstEventAt);
    const eventLocal = new Date(event.getTime() - input.timezoneOffsetMinutes * MINUTE);
    const startKey = `${startDate.getFullYear()}-${startDate.getMonth()}-${startDate.getDate()}`;
    const eventKey = `${eventLocal.getUTCFullYear()}-${eventLocal.getUTCMonth()}-${eventLocal.getUTCDate()}`;
    if (startKey === eventKey && eventLocal.getUTCHours() < 10) {
      const wake = new Date(event.getTime() - (input.morningPrepMinutes + 30) * MINUTE - input.timezoneOffsetMinutes * MINUTE);
      wakeHour = wake.getUTCHours(); wakeMinute = wake.getUTCMinutes();
    }
  }
  const wakeStart = localTimestamp(startDate, wakeHour, wakeMinute, input.timezoneOffsetMinutes);
  const steps = fitSteps(input.suggestion.steps, input.morningPrepMinutes);
  const recurrence = `RRULE:FREQ=DAILY;COUNT=${input.horizonDays}`;
  const weekdays = [0, 1, 2, 3, 4, 5, 6];
  const series: RecurringSeries[] = [];
  let cursor = wakeStart;
  for (const step of steps) {
    series.push({ id: crypto.randomUUID(), title: step.title, kind: "routine", startsAt: new Date(cursor).toISOString(), endsAt: new Date(cursor + step.minutes * MINUTE).toISOString(), reason: step.reason, recurrence, timeZone: input.timeZone, weekdays });
    cursor += step.minutes * MINUTE;
  }
  const bedtime = wakeStart - input.targetSleepMinutes * MINUTE;
  series.unshift({ id: crypto.randomUUID(), title: "就寝準備", kind: "sleep", startsAt: new Date(bedtime - 30 * MINUTE).toISOString(), endsAt: new Date(bedtime).toISOString(), reason: `${Math.floor(input.targetSleepMinutes / 60)}時間${input.targetSleepMinutes % 60 ? `${input.targetSleepMinutes % 60}分` : ""}の睡眠を確保するため`, recurrence, timeZone: input.timeZone, weekdays });
  const blocks = Array.from({ length: input.horizonDays }, (_, day) => series.map((item) => ({
    id: crypto.randomUUID(), proposalId: input.proposalId, title: item.title,
    startsAt: new Date(new Date(item.startsAt).getTime() + day * 86_400_000).toISOString(),
    endsAt: new Date(new Date(item.endsAt).getTime() + day * 86_400_000).toISOString(),
    reason: item.reason, kind: item.kind, source: "ai_suggestion" as const
  }))).flat().sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const wakeLabel = `${String(wakeHour).padStart(2, "0")}:${String(wakeMinute).padStart(2, "0")}`;
  return {
    title: input.suggestion.title || "おすすめモーニングルーティン",
    summary: `${wakeLabel}起床を基準に、睡眠を削らない朝の流れを${input.horizonDays}日分提案します。`,
    series, blocks, recurrenceLabel: "毎日",
    assumptions: [...input.suggestion.assumptions, ...(input.firstEventAt ? ["翌朝の早い予定がある場合は、朝の準備時間と30分の余裕から起床時刻を逆算しています。"] : ["起床時刻の指定がないため、7:00を基準に提案しています。"])]
  };
}
