import { addDays, format } from "date-fns";
import type { ScheduledSuggestion } from "@/lib/domain/goal-planner";

const MINUTE = 60_000;
const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

export type RecurringSeries = {
  id: string;
  title: string;
  kind: "event" | "travel" | "task";
  startsAt: string;
  endsAt: string;
  reason: string;
  location?: string;
  recurrence: string;
  timeZone: string;
};

export type RecurringPlan = {
  title: string;
  summary: string;
  series: RecurringSeries[];
  blocks: ScheduledSuggestion[];
  assumptions: string[];
  recurrenceLabel: string;
};

function timeMatch(text: string) {
  const match = text.match(/(午前|午後)?\s*(\d{1,2})時(?:\s*(\d{1,2})分)?/);
  if (!match) return;
  let hour = Number(match[2]);
  if (match[1] === "午後" && hour < 12) hour += 12;
  if (match[1] === "午前" && hour === 12) hour = 0;
  const minute = Number(match[3] ?? 0);
  if (hour > 23 || minute > 59) return;
  return { hour, minute };
}

function localTimestamp(date: Date, hour: number, minute: number, timezoneOffsetMinutes: number) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute) + timezoneOffsetMinutes * MINUTE;
}

function weekdaysFromText(text: string): number[] | undefined {
  if (/平日/.test(text)) return [1, 2, 3, 4, 5];
  const weekly = text.match(/毎週\s*([月火水木金土日](?:曜日)?(?:[・、,と／/\s]+[月火水木金土日](?:曜日)?)*)/);
  if (!weekly) return /毎日/.test(text) ? [0, 1, 2, 3, 4, 5, 6] : undefined;
  const map: Record<string, number> = { 日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6 };
  return [...new Set([...weekly[1]].filter((value) => value in map).map((value) => map[value]))];
}

export function isRecurringScheduleText(text: string) {
  return /毎日|平日|毎週/.test(text) && Boolean(timeMatch(text));
}

export function createRecurringPlan(input: {
  text: string;
  now: Date;
  horizonDays: number;
  timezoneOffsetMinutes: number;
  timeZone: string;
  proposalId: string;
}): RecurringPlan {
  const clock = timeMatch(input.text);
  const weekdays = weekdaysFromText(input.text);
  if (!clock || !weekdays?.length) throw new Error("繰り返す曜日と開始時刻を確認してください");

  const firstLine = input.text.split(/\r?\n|。/)[0].trim();
  const location = firstLine.match(/(?:から)?([^\s、。]{1,40})で(?:作業|勉強|仕事|打ち合わせ)/)?.[1]
    ?.replace(/^.*?時(?:から)?/, "");
  const titleBase = firstLine
    .replace(/^(?:毎日|平日|毎週[^\d]{0,15})の?/, "")
    .replace(/(午前|午後)?\s*\d{1,2}時(?:\s*\d{1,2}分)?から?/, "")
    .replace(/たい$/, "")
    .trim();
  const title = titleBase || "定期予定";
  const travelMinutes = Number(input.text.match(/移動\s*(\d{1,3})分/)?.[1] ?? 0);
  const arrivalBufferMinutes = Number(input.text.match(/(\d{1,3})分前(?:に)?(?:着|到着)/)?.[1] ?? 0);
  const preparation = input.text.match(/([^\n。]{1,40}?)(\d{1,3})分/gu);
  const prepMatch = preparation?.map((value) => value.match(/([^\n。\d]{1,40}?)(\d{1,3})分/)).find((match) => match && !/移動|到着|前/.test(match[1]));
  const prepMinutes = Number(prepMatch?.[2] ?? 0);
  const prepTitle = prepMatch?.[1]?.trim() || "準備";
  const explicitDuration = input.text.match(/(?:作業|勉強|予定)(?:は|を)?\s*(\d{1,3})分|(?:作業|勉強|予定)(?:は|を)?\s*(\d{1,2})時間/u);
  const durationMinutes = explicitDuration?.[1] ? Number(explicitDuration[1]) : explicitDuration?.[2] ? Number(explicitDuration[2]) * 60 : 120;
  const assumptions = explicitDuration ? [] : ["終了時刻が未指定のため、1回の予定を120分として提案しています。登録前に確認してください。"];

  let startDate = new Date(input.now.getFullYear(), input.now.getMonth(), input.now.getDate());
  const todayStart = localTimestamp(startDate, clock.hour, clock.minute, input.timezoneOffsetMinutes);
  if (todayStart <= input.now.getTime() || !weekdays.includes(startDate.getDay())) {
    do startDate = addDays(startDate, 1); while (!weekdays.includes(startDate.getDay()));
  }
  const horizonEnd = addDays(new Date(input.now.getFullYear(), input.now.getMonth(), input.now.getDate()), input.horizonDays);
  const occurrenceDates: Date[] = [];
  for (let date = startDate; date < horizonEnd; date = addDays(date, 1)) if (weekdays.includes(date.getDay())) occurrenceDates.push(date);
  if (!occurrenceDates.length) throw new Error("提案期間内に対象日がありません");

  const count = occurrenceDates.length;
  const recurrence = weekdays.length === 7
    ? `RRULE:FREQ=DAILY;COUNT=${count}`
    : `RRULE:FREQ=WEEKLY;BYDAY=${weekdays.map((day) => DAY_CODES[day]).join(",")};COUNT=${count}`;
  const eventStart = localTimestamp(startDate, clock.hour, clock.minute, input.timezoneOffsetMinutes);
  const eventEnd = eventStart + durationMinutes * MINUTE;
  const series: RecurringSeries[] = [{
    id: crypto.randomUUID(), title, kind: "event", startsAt: new Date(eventStart).toISOString(),
    endsAt: new Date(eventEnd).toISOString(), reason: "指定された繰り返し予定", location, recurrence, timeZone: input.timeZone
  }];
  if (travelMinutes > 0) {
    const end = eventStart - arrivalBufferMinutes * MINUTE;
    series.unshift({ id: crypto.randomUUID(), title: `${location ?? title}への移動`, kind: "travel", startsAt: new Date(end - travelMinutes * MINUTE).toISOString(), endsAt: new Date(end).toISOString(), reason: `${travelMinutes}分の移動と${arrivalBufferMinutes}分の到着余裕から逆算`, location, recurrence, timeZone: input.timeZone });
  }
  if (prepMinutes > 0) {
    const next = series[0];
    const end = new Date(next.startsAt).getTime() - 5 * MINUTE;
    series.unshift({ id: crypto.randomUUID(), title: prepTitle, kind: "task", startsAt: new Date(end - prepMinutes * MINUTE).toISOString(), endsAt: new Date(end).toISOString(), reason: `入力された準備時間 ${prepMinutes}分`, recurrence, timeZone: input.timeZone });
  }

  const blocks = occurrenceDates.flatMap((date) => {
    const base = localTimestamp(date, clock.hour, clock.minute, input.timezoneOffsetMinutes);
    const firstBase = eventStart;
    return series.map((item) => {
      const offset = new Date(item.startsAt).getTime() - firstBase;
      const duration = new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime();
      return {
        id: crypto.randomUUID(), proposalId: input.proposalId, title: item.title,
        startsAt: new Date(base + offset).toISOString(), endsAt: new Date(base + offset + duration).toISOString(),
        reason: item.reason, kind: item.kind, location: item.location, source: "ai_suggestion" as const
      };
    });
  }).sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const recurrenceLabel = weekdays.length === 7 ? "毎日" : weekdays.length === 5 && weekdays.every((day, index) => day === index + 1)
    ? "平日" : `毎週 ${weekdays.map((day) => "日月火水木金土"[day]).join("・")}曜日`;
  return { title, summary: `${recurrenceLabel} ${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}から${count}回の定期予定として提案します。`, series, blocks, assumptions, recurrenceLabel };
}

export function recurringSeriesDescription(series: RecurringSeries) {
  return `${format(new Date(series.startsAt), "H:mm")}–${format(new Date(series.endsAt), "H:mm")}`;
}
