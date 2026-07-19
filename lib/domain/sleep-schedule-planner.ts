import { addDays } from "date-fns";
import type { RecurringPlan, RecurringSeries } from "@/lib/domain/recurring-planner";

const MINUTE = 60_000;
const DAY = 86_400_000;

export function isSleepScheduleRequest(text: string) {
  return /(?:就寝時刻|就寝時間|寝る時間|睡眠時間)/.test(text) && /(?:毎日|設定|決め|組み込|予定)/.test(text);
}

function localTimestamp(date: Date, hour: number, minute: number, timezoneOffsetMinutes: number) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute) + timezoneOffsetMinutes * MINUTE;
}

function explicitBedtime(text: string) {
  const match = text.match(/(?:(\d{1,2})時(?:([0-5]\d)分)?(?:に)?(?:寝|就寝)|(?:就寝|寝る)(?:は|を)?\s*(\d{1,2})時(?:([0-5]\d)分)?)/);
  if (!match) return;
  const hour = Number(match[1] ?? match[3]);
  const minute = Number(match[2] ?? match[4] ?? 0);
  return hour <= 23 ? { hour, minute } : undefined;
}

export function createSleepSchedulePlan(input: {
  text: string;
  now: Date;
  horizonDays: number;
  timezoneOffsetMinutes: number;
  timeZone: string;
  proposalId: string;
  targetSleepMinutes: number;
  wakeAt?: string;
}): RecurringPlan {
  const assumptions: string[] = [];
  const explicit = explicitBedtime(input.text);
  let sleepStart: number;
  let wake: number;
  if (explicit) {
    let date = new Date(input.now.getFullYear(), input.now.getMonth(), input.now.getDate());
    sleepStart = localTimestamp(date, explicit.hour, explicit.minute, input.timezoneOffsetMinutes);
    if (sleepStart <= input.now.getTime()) { date = addDays(date, 1); sleepStart = localTimestamp(date, explicit.hour, explicit.minute, input.timezoneOffsetMinutes); }
    wake = sleepStart + input.targetSleepMinutes * MINUTE;
  } else {
    if (input.wakeAt) wake = new Date(input.wakeAt).getTime();
    else {
      let date = new Date(input.now.getFullYear(), input.now.getMonth(), input.now.getDate());
      wake = localTimestamp(date, 7, 0, input.timezoneOffsetMinutes);
      if (wake <= input.now.getTime()) { date = addDays(date, 1); wake = localTimestamp(date, 7, 0, input.timezoneOffsetMinutes); }
      assumptions.push("起床予定がまだないため、7:00起床を基準にしています。");
    }
    sleepStart = wake - input.targetSleepMinutes * MINUTE;
  }
  assumptions.push(`設定された目標睡眠時間${Math.floor(input.targetSleepMinutes / 60)}時間${input.targetSleepMinutes % 60 ? `${input.targetSleepMinutes % 60}分` : ""}を確保しています。`);
  const recurrence = `RRULE:FREQ=DAILY;COUNT=${input.horizonDays}`;
  const weekdays = [0, 1, 2, 3, 4, 5, 6];
  const series: RecurringSeries[] = [
    { id: crypto.randomUUID(), title: "就寝準備", kind: "sleep", startsAt: new Date(sleepStart - 30 * MINUTE).toISOString(), endsAt: new Date(sleepStart).toISOString(), reason: "就寝前の切り替え時間を30分確保", recurrence, timeZone: input.timeZone, weekdays },
    { id: crypto.randomUUID(), title: "睡眠", kind: "sleep", startsAt: new Date(sleepStart).toISOString(), endsAt: new Date(wake).toISOString(), reason: "目標睡眠時間を削らずに確保", recurrence, timeZone: input.timeZone, weekdays }
  ];
  const blocks = Array.from({ length: input.horizonDays }, (_, day) => series.map((item) => ({
    id: crypto.randomUUID(), proposalId: input.proposalId, title: item.title,
    startsAt: new Date(new Date(item.startsAt).getTime() + day * DAY).toISOString(),
    endsAt: new Date(new Date(item.endsAt).getTime() + day * DAY).toISOString(),
    reason: item.reason, kind: item.kind, source: "ai_suggestion" as const
  }))).flat().sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const localSleep = new Date(sleepStart - input.timezoneOffsetMinutes * MINUTE);
  const localWake = new Date(wake - input.timezoneOffsetMinutes * MINUTE);
  const sleepLabel = `${String(localSleep.getUTCHours()).padStart(2, "0")}:${String(localSleep.getUTCMinutes()).padStart(2, "0")}`;
  const wakeLabel = `${String(localWake.getUTCHours()).padStart(2, "0")}:${String(localWake.getUTCMinutes()).padStart(2, "0")}`;
  return {
    title: "毎日の睡眠スケジュール",
    summary: `${sleepLabel}就寝・${wakeLabel}起床を基準に、睡眠を${input.horizonDays}日分確保します。`,
    series, blocks, assumptions, recurrenceLabel: "毎日"
  };
}
