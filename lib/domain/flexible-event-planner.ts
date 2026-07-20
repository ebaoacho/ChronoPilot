import { addDays } from "date-fns";
import { scheduledSuggestionSchema } from "@/lib/domain/schemas";
import type { BusyInterval, ScheduledSuggestion } from "@/lib/domain/goal-planner";

const MINUTE = 60_000;

const RELATIVE_DAY_OFFSETS: Array<{ pattern: RegExp; offset: number; label: string }> = [
  { pattern: /明々後日|明明後日/, offset: 3, label: "明々後日" },
  { pattern: /明後日/, offset: 2, label: "明後日" },
  { pattern: /今日|本日/, offset: 0, label: "今日" },
  { pattern: /明日/, offset: 1, label: "明日" }
];

export function isFlexibleEventRequest(text: string) {
  const hasRelativeDay = RELATIVE_DAY_OFFSETS.some(({ pattern }) => pattern.test(text));
  const hasChoicePhrase = /(都合のいい|都合が良い|都合の良い|空いてる|空いている|良い方|いい方|どちらか|いずれか)/.test(text);
  return hasRelativeDay && hasChoicePhrase;
}

function candidateDays(text: string) {
  const seen = new Set<number>();
  const days: Array<{ offset: number; label: string }> = [];
  for (const item of RELATIVE_DAY_OFFSETS) {
    if (item.pattern.test(text) && !seen.has(item.offset)) { seen.add(item.offset); days.push(item); }
  }
  return days.sort((a, b) => a.offset - b.offset);
}

function extractTitle(text: string) {
  const match = text.match(/^(.{1,40}?)(に|と)(相談|確認|報告|連絡|共有|打ち合わせ|ミーティング|面談|MTG|アポ)/);
  if (match) return `${match[1]}${match[2]}${match[3]}`.slice(0, 120);
  const firstClause = text.split(/\r?\n|。|、/)[0]?.trim();
  return (firstClause || "予定").slice(0, 120);
}

function extractDurationMinutes(text: string) {
  const match = text.match(/(\d{1,3})\s*分/);
  return match ? Math.max(10, Math.min(240, Number(match[1]))) : 30;
}

function localTimestamp(date: Date, hour: number, minute: number, timezoneOffsetMinutes: number) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute) + timezoneOffsetMinutes * MINUTE;
}

function formatLocalHHMM(timestamp: number, timezoneOffsetMinutes: number) {
  const local = new Date(timestamp - timezoneOffsetMinutes * MINUTE);
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
}

function roundUpToQuarterHour(timestamp: number) {
  const size = 15 * MINUTE;
  return Math.ceil(timestamp / size) * size;
}

export type FlexibleEventPlan = {
  title: string;
  summary: string;
  scheduled: ScheduledSuggestion[];
  unscheduled: Array<{ title: string; minutes: number }>;
  assumptions: string[];
};

export function createFlexibleEventPlan(input: {
  proposalId: string;
  text: string;
  now: Date;
  timezoneOffsetMinutes: number;
  preferredStartHour?: number;
  preferredEndHour?: number;
  busy: BusyInterval[];
}): FlexibleEventPlan {
  const title = extractTitle(input.text);
  const durationMinutes = extractDurationMinutes(input.text);
  const days = candidateDays(input.text);
  const startHour = input.preferredStartHour ?? 10;
  const endHour = input.preferredEndHour ?? 18;
  const today = new Date(input.now.getFullYear(), input.now.getMonth(), input.now.getDate());
  const explicitDuration = /\d{1,3}\s*分/.test(input.text);
  const dayLabel = days.map((day) => day.label).join("・") || "指定日";

  let scheduled: ScheduledSuggestion | undefined;
  let chosenLabel = "";
  for (const day of days) {
    const date = addDays(today, day.offset);
    const dayStart = localTimestamp(date, startHour, 0, input.timezoneOffsetMinutes);
    const dayEnd = localTimestamp(date, endHour, 0, input.timezoneOffsetMinutes);
    let cursor = Math.max(dayStart, roundUpToQuarterHour(input.now.getTime() + 30 * MINUTE));
    while (cursor + durationMinutes * MINUTE <= dayEnd) {
      const end = cursor + durationMinutes * MINUTE;
      const conflict = input.busy.some((block) => cursor - 5 * MINUTE < new Date(block.endsAt).getTime() && new Date(block.startsAt).getTime() < end + 5 * MINUTE);
      if (!conflict) {
        scheduled = scheduledSuggestionSchema.parse({
          id: crypto.randomUUID(), proposalId: input.proposalId, title,
          startsAt: new Date(cursor).toISOString(), endsAt: new Date(end).toISOString(),
          reason: `${day.label}の既存予定と重ならない日中の時間帯（${startHour}:00〜${endHour}:00）から選びました。`,
          kind: "event", source: "ai_suggestion"
        });
        chosenLabel = day.label;
        break;
      }
      cursor += 15 * MINUTE;
    }
    if (scheduled) break;
  }

  const assumptions: string[] = [];
  if (!explicitDuration) assumptions.push(`所要時間の指定がないため、${durationMinutes}分として提案しています。`);
  assumptions.push(`${dayLabel}のうち、都合のいい1日・${startHour}:00〜${endHour}:00の日中で既存予定と重ならない枠を自動で選びました。`);

  if (!scheduled) {
    return {
      title,
      summary: `${dayLabel}の日中（${startHour}:00〜${endHour}:00）に空き時間が見つかりませんでした。`,
      scheduled: [],
      unscheduled: [{ title, minutes: durationMinutes }],
      assumptions
    };
  }
  return {
    title,
    summary: `${chosenLabel} ${formatLocalHHMM(new Date(scheduled.startsAt).getTime(), input.timezoneOffsetMinutes)}〜${formatLocalHHMM(new Date(scheduled.endsAt).getTime(), input.timezoneOffsetMinutes)}に「${title}」を提案します。`,
    scheduled: [scheduled],
    unscheduled: [],
    assumptions
  };
}
