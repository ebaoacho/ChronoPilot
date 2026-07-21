import { addDays, format } from "date-fns";
import type { ScheduledSuggestion } from "@/lib/domain/goal-planner";

const MINUTE = 60_000;
const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

export type RecurringSeries = {
  id: string;
  title: string;
  kind: "event" | "travel" | "task" | "routine" | "sleep";
  startsAt: string;
  endsAt: string;
  reason: string;
  location?: string;
  recurrence: string;
  timeZone: string;
  weekdays: number[];
};

export type RecurringPlan = {
  title: string;
  summary: string;
  series: RecurringSeries[];
  blocks: ScheduledSuggestion[];
  assumptions: string[];
  recurrenceLabel: string;
};

const DEFAULT_ASSUMED_START_HOUR = 9;

function clockFromMatch(match: RegExpMatchArray | null) {
  if (!match) return;
  let hour = Number(match[2]);
  if (match[1] === "午後" && hour < 12) hour += 12;
  if (match[1] === "午前" && hour === 12) hour = 0;
  const minute = Number(match[3] ?? 0);
  if (hour > 23 || minute > 59) return;
  return { hour, minute };
}

// Requires an explicit "から"/"より" anchor so a bare "N時" mention (e.g. inside
// a "…時までは必須" end-time phrase) is never mistaken for a start time.
function startTimeMatch(text: string) {
  return clockFromMatch(text.match(/(午前|午後)?\s*(\d{1,2})時(?:\s*(\d{1,2})分)?\s*(?:から|より)/));
}

function endTimeMatch(text: string) {
  return clockFromMatch(text.match(/(午前|午後)?\s*(\d{1,2})時(?:\s*(\d{1,2})分)?\s*まで/));
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
  return /毎日|平日|毎週/.test(text) && (Boolean(startTimeMatch(text)) || Boolean(endTimeMatch(text)));
}

function recurrenceFor(weekdays: number[], count: number) {
  return weekdays.length === 7
    ? `RRULE:FREQ=DAILY;COUNT=${count}`
    : `RRULE:FREQ=WEEKLY;BYDAY=${weekdays.map((day) => DAY_CODES[day]).join(",")};COUNT=${count}`;
}

function cleanScheduleTitle(firstLine: string, location?: string) {
  if (/作業/.test(firstLine)) return `${location ?? "大学"}で集中作業`;
  if (/勉強|学習/.test(firstLine)) return `${location ? `${location}で` : ""}学習`;
  return firstLine
    .replace(/^(?:毎日|平日|毎週[^\d]{0,15})の?/, "")
    .replace(/(午前|午後)?\s*\d{1,2}時(?:\s*\d{1,2}分)?から?/, "")
    .replace(/がしたい$/, "をする")
    .replace(/したい$/, "する")
    .replace(/に打ち込みたい$/, "に集中する")
    .trim() || "定期予定";
}

export function createRecurringPlan(input: {
  text: string;
  now: Date;
  horizonDays: number;
  timezoneOffsetMinutes: number;
  timeZone: string;
  proposalId: string;
}): RecurringPlan {
  const startClock = startTimeMatch(input.text);
  const endClock = endTimeMatch(input.text);
  const weekdays = weekdaysFromText(input.text);
  if ((!startClock && !endClock) || !weekdays?.length) throw new Error("繰り返す曜日と開始時刻（または終了時刻）を確認してください");
  const clock = startClock ?? { hour: DEFAULT_ASSUMED_START_HOUR, minute: 0 };

  const firstLine = input.text.split(/\r?\n|。/)[0].trim();
  const location = firstLine.match(/(?:から)?([^\s、。]{1,40})で(?:作業|勉強|仕事|打ち合わせ)/)?.[1]
    ?.replace(/^.*?時(?:から)?/, "");
  const title = cleanScheduleTitle(firstLine, location);
  const travelMinutes = Number(input.text.match(/移動\s*(\d{1,3})分/)?.[1] ?? 0);
  const arrivalBufferMinutes = Number(input.text.match(/(\d{1,3})分前(?:に)?(?:着|到着)/)?.[1] ?? 0);
  const preparation = input.text.match(/([^\n。]{1,40}?)(\d{1,3})分/gu);
  const prepMatch = preparation?.map((value) => value.match(/([^\n。\d]{1,40}?)(\d{1,3})分/)).find((match) => match && !/移動|到着|前/.test(match[1]));
  const prepMinutes = Number(prepMatch?.[2] ?? 0);
  const prepTitle = prepMatch?.[1]?.trim() || "準備";
  const explicitDuration = input.text.match(/(?:作業|勉強|予定)(?:は|を)?\s*(\d{1,3})分|(?:作業|勉強|予定)(?:は|を)?\s*(\d{1,2})時間/u);
  const rangeMinutes = endClock ? (() => {
    const startTotal = clock.hour * 60 + clock.minute;
    const endTotal = endClock.hour * 60 + endClock.minute;
    const diff = endTotal - startTotal;
    return diff > 0 ? diff : undefined;
  })() : undefined;
  const durationMinutes = rangeMinutes ?? (explicitDuration?.[1] ? Number(explicitDuration[1]) : explicitDuration?.[2] ? Number(explicitDuration[2]) * 60 : 120);
  const assumptions = rangeMinutes || explicitDuration ? [] : ["終了時刻が未指定のため、1回の予定を120分として提案しています。登録前に確認してください。"];
  if (!startClock) assumptions.push(`開始時刻の指定がないため、${String(clock.hour).padStart(2, "0")}:00開始と仮定しています。実際の開始時刻に合わせて登録前に調整してください。`);
  const wantsHomecoming = /帰宅/.test(input.text) && Boolean(endClock);
  const wantsSmokingBreak = /タバコ|煙草|喫煙/.test(input.text);
  const smokingMinutes = Number(input.text.match(/(?:タバコ|煙草|喫煙)[^\d\n]{0,12}(\d{1,2})分/)?.[1] ?? (wantsSmokingBreak ? 10 : 0));
  if (wantsSmokingBreak && !/(?:タバコ|煙草|喫煙)[^\d\n]{0,12}\d{1,2}分/.test(input.text)) assumptions.push("到着後の喫煙・休憩時間は、指定がないため10分として提案しています。");
  const mondayMeeting = /(?:特に)?月曜(?:日)?[^\n。]{0,40}(?:MTG|ミーティング|会議)/i.test(input.text) && weekdays.includes(1);
  if (mondayMeeting) assumptions.push("月曜MTGの終了時刻が未指定のため、60分として提案しています。");

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
  const eventStart = localTimestamp(startDate, clock.hour, clock.minute, input.timezoneOffsetMinutes);
  const effectiveArrivalBuffer = Math.max(arrivalBufferMinutes, smokingMinutes + (wantsSmokingBreak ? 5 : 0));
  const travelEnd = eventStart - effectiveArrivalBuffer * MINUTE;
  const travelStart = travelEnd - travelMinutes * MINUTE;
  const series: RecurringSeries[] = [];
  const addSeries = (item: Omit<RecurringSeries, "id"|"recurrence"|"timeZone"|"weekdays">, days: number[]) => {
    const matchingDates = occurrenceDates.filter((date) => days.includes(date.getDay()));
    if (!matchingDates.length) return;
    const baseShift = localTimestamp(matchingDates[0], clock.hour, clock.minute, input.timezoneOffsetMinutes) - eventStart;
    series.push({ ...item, id: crypto.randomUUID(), startsAt: new Date(new Date(item.startsAt).getTime() + baseShift).toISOString(), endsAt: new Date(new Date(item.endsAt).getTime() + baseShift).toISOString(), recurrence: recurrenceFor(days, matchingDates.length), timeZone: input.timeZone, weekdays: days });
  };
  if (prepMinutes > 0) {
    const prepEnd = (travelMinutes > 0 ? travelStart : travelEnd) - 5 * MINUTE;
    addSeries({ title: prepTitle === "資料準備" ? "作業・MTG資料の準備" : prepTitle, kind: "task", startsAt: new Date(prepEnd - prepMinutes * MINUTE).toISOString(), endsAt: new Date(prepEnd).toISOString(), reason: `入力された準備時間 ${prepMinutes}分` }, weekdays);
  }
  if (travelMinutes > 0) addSeries({ title: `${location ?? "目的地"}へ移動`, kind: "travel", startsAt: new Date(travelStart).toISOString(), endsAt: new Date(travelEnd).toISOString(), reason: `${travelMinutes}分の移動と${effectiveArrivalBuffer}分の到着後余裕から逆算`, location }, weekdays);
  if (wantsSmokingBreak) addSeries({ title: "到着後の休憩（喫煙）", kind: "task", startsAt: new Date(travelEnd).toISOString(), endsAt: new Date(travelEnd + smokingMinutes * MINUTE).toISOString(), reason: "到着後に希望された休憩時間。健康を評価せず、時間枠として中立的に配置" }, weekdays);
  const regularDays = mondayMeeting ? weekdays.filter((day) => day !== 1) : weekdays;
  addSeries({ title, kind: "event", startsAt: new Date(eventStart).toISOString(), endsAt: new Date(eventStart + durationMinutes * MINUTE).toISOString(), reason: "指定された繰り返し予定", location }, regularDays);
  if (mondayMeeting) addSeries({ title: "月曜MTG", kind: "event", startsAt: new Date(eventStart).toISOString(), endsAt: new Date(eventStart + 60 * MINUTE).toISOString(), reason: "月曜日10時の固定MTGを優先", location }, [1]);
  if (wantsHomecoming) {
    const homecomingAt = eventStart + durationMinutes * MINUTE;
    addSeries({ title: "帰宅", kind: "event", startsAt: new Date(homecomingAt).toISOString(), endsAt: new Date(homecomingAt + 5 * MINUTE).toISOString(), reason: `${title}の終了時刻を目安にした帰宅予定` }, weekdays);
    assumptions.push("会議などで滞在が延びる日の帰宅時刻は自動では調整されません。該当日はこの帰宅予定を手動で移動してください。");
  }

  const blocks = occurrenceDates.flatMap((date) => {
    const base = localTimestamp(date, clock.hour, clock.minute, input.timezoneOffsetMinutes);
    return series.filter((item) => item.weekdays.includes(date.getDay())).map((item) => {
      const firstDate = occurrenceDates.find((candidate) => item.weekdays.includes(candidate.getDay()))!;
      const firstBase = localTimestamp(firstDate, clock.hour, clock.minute, input.timezoneOffsetMinutes);
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
  const exception = mondayMeeting ? "月曜日は「月曜MTG」に置き換えます。" : "";
  const startLabel = `${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`;
  const endLabel = endClock ? `${String(endClock.hour).padStart(2, "0")}:${String(endClock.minute).padStart(2, "0")}まで` : `${durationMinutes}分間`;
  return { title, summary: `${recurrenceLabel} ${startLabel}から${endLabel}、${count}回の定期予定として提案します。${exception}`, series, blocks, assumptions, recurrenceLabel };
}

export function recurringSeriesDescription(series: RecurringSeries) {
  return `${format(new Date(series.startsAt), "H:mm")}–${format(new Date(series.endsAt), "H:mm")}`;
}
