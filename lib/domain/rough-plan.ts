import { scheduledSuggestionSchema } from "@/lib/domain/schemas";
import type { BusyInterval, ScheduledSuggestion } from "@/lib/domain/goal-planner";
import type { RoughPlanResult } from "@/lib/ai/provider";

const DAY = 86_400_000;
const MINUTE = 60_000;
// App-decided realistic defaults for gap-filling (not user-configurable yet).
const MAX_NEW_MINUTES_PER_DAY = 240;
const BUFFER_MINUTES = 10;
const TIME_OF_DAY_WINDOWS: Record<"morning" | "afternoon" | "evening", { start: number; end: number }> = {
  morning: { start: 6, end: 12 },
  afternoon: { start: 12, end: 17 },
  evening: { start: 17, end: 22 }
};

export type ExistingEventCandidate = { id: string; title: string; startsAt: string; endsAt: string };
export type MatchResult = { event?: ExistingEventCandidate; confidence: "matched" | "ambiguous" | "not_found" };
export type RoughPlanUpdate = { title: string; reason: string; newStartsAt?: string; newEndsAt?: string } & MatchResult;
export type RoughPlanDelete = { title: string; reason: string } & MatchResult;

function normalizeTitle(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function bigrams(value: string) {
  const chars = [...value];
  if (chars.length < 2) return new Set([value]);
  return new Set(Array.from({ length: chars.length - 1 }, (_, index) => chars[index] + chars[index + 1]));
}

function titleSimilarity(a: string, b: string) {
  const left = normalizeTitle(a);
  const right = normalizeTitle(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.85;
  const leftGrams = bigrams(left);
  const rightGrams = bigrams(right);
  const intersection = [...leftGrams].filter((gram) => rightGrams.has(gram)).length;
  const union = new Set([...leftGrams, ...rightGrams]).size;
  return union === 0 ? 0 : intersection / union;
}

function localDateKey(iso: string) {
  return iso.slice(0, 10);
}

function dayDistance(a: string, b: string) {
  return Math.abs(new Date(`${localDateKey(a)}T00:00:00Z`).getTime() - new Date(`${localDateKey(b)}T00:00:00Z`).getTime()) / DAY;
}

// The AI only supplies a fuzzy title/date hint -- it never decides which real
// event this is. Matching against actual calendar data stays deterministic so
// a destructive action can never fire on the AI's guess alone.
export function matchExistingEvent(hint: { titleHint?: string; dateHint?: string }, candidates: ExistingEventCandidate[]): MatchResult {
  if (!hint.titleHint || !candidates.length) return { confidence: "not_found" };
  const scored = candidates
    .map((candidate) => {
      const titleScore = titleSimilarity(hint.titleHint!, candidate.title);
      const distance = hint.dateHint ? dayDistance(hint.dateHint, candidate.startsAt) : 0;
      const datePenalty = hint.dateHint ? Math.min(0.6, distance * 0.2) : 0;
      return { candidate, score: titleScore - datePenalty };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return { confidence: "not_found" };
  const [best, second] = scored;
  if (best.score >= 0.5 && (!second || best.score - second.score >= 0.15)) {
    return { event: best.candidate, confidence: "matched" };
  }
  if (best.score >= 0.3) return { event: best.candidate, confidence: "ambiguous" };
  return { confidence: "not_found" };
}

export type FlexibleItem = {
  id: string;
  title: string;
  reason: string;
  estimateMinutes: number;
  deadlineAt?: string;
  preferredTimeOfDay?: "morning" | "afternoon" | "evening" | "any";
  priority?: number;
};

function overlaps(start: number, end: number, block: BusyInterval) {
  return start < new Date(block.endsAt).getTime() && new Date(block.startsAt).getTime() < end;
}

// Mirrors the overlap-check and forward-scan approach already proven in
// goal-planner.ts / flexible-event-planner.ts, extended to cap how much new
// content lands on any single day so placement stays realistic.
export function placeFlexibleItems(input: {
  proposalId: string;
  items: FlexibleItem[];
  now: Date;
  timezoneOffsetMinutes: number;
  workdayStartHour: number;
  workdayEndHour: number;
  horizonDays: number;
  busy: BusyInterval[];
}): { scheduled: ScheduledSuggestion[]; unscheduled: Array<{ title: string; minutes: number }> } {
  const occupied: BusyInterval[] = [...input.busy];
  const newMinutesByDay = new Map<number, number>();
  const scheduled: ScheduledSuggestion[] = [];
  const unscheduled: Array<{ title: string; minutes: number }> = [];
  const nowMs = input.now.getTime();
  const horizonEnd = nowMs + input.horizonDays * DAY;
  const localDayIndex = (timestamp: number) => Math.floor((timestamp - input.timezoneOffsetMinutes * MINUTE) / DAY);
  const localHourTimestamp = (day: number, hour: number) => day * DAY + hour * 60 * MINUTE + input.timezoneOffsetMinutes * MINUTE;
  const roundUp = (timestamp: number, minutes: number) => Math.ceil(timestamp / (minutes * MINUTE)) * (minutes * MINUTE);

  const ordered = [...input.items].sort((a, b) => {
    const priorityDiff = (b.priority ?? 2) - (a.priority ?? 2);
    if (priorityDiff) return priorityDiff;
    const aDeadline = a.deadlineAt ? new Date(a.deadlineAt).getTime() : Infinity;
    const bDeadline = b.deadlineAt ? new Date(b.deadlineAt).getTime() : Infinity;
    return aDeadline - bDeadline;
  });

  for (const item of ordered) {
    const duration = item.estimateMinutes * MINUTE;
    const deadline = item.deadlineAt ? new Date(item.deadlineAt).getTime() : horizonEnd;
    const window = item.preferredTimeOfDay && item.preferredTimeOfDay !== "any" ? TIME_OF_DAY_WINDOWS[item.preferredTimeOfDay] : undefined;
    const dayStartHour = window ? Math.max(input.workdayStartHour, window.start) : input.workdayStartHour;
    const dayEndHour = window ? Math.min(input.workdayEndHour, window.end) : input.workdayEndHour;
    let day = localDayIndex(nowMs);
    let found: { start: number; end: number; day: number } | undefined;

    while (localHourTimestamp(day, dayStartHour) < Math.min(deadline, horizonEnd) && !found) {
      const dayStart = localHourTimestamp(day, dayStartHour);
      const dayEnd = Math.min(localHourTimestamp(day, dayEndHour), deadline, horizonEnd);
      const usedToday = newMinutesByDay.get(day) ?? 0;
      if (dayEndHour > dayStartHour && usedToday + item.estimateMinutes <= MAX_NEW_MINUTES_PER_DAY) {
        let cursor = roundUp(Math.max(nowMs, dayStart), 15);
        while (cursor + duration <= dayEnd) {
          const end = cursor + duration;
          const conflict = occupied.some((block) => overlaps(cursor - BUFFER_MINUTES * MINUTE, end + BUFFER_MINUTES * MINUTE, block));
          if (!conflict) { found = { start: cursor, end, day }; break; }
          cursor += 15 * MINUTE;
        }
      }
      day += 1;
    }

    if (!found) { unscheduled.push({ title: item.title, minutes: item.estimateMinutes }); continue; }
    const block = scheduledSuggestionSchema.parse({
      id: crypto.randomUUID(), proposalId: input.proposalId, title: item.title,
      startsAt: new Date(found.start).toISOString(), endsAt: new Date(found.end).toISOString(),
      reason: item.reason, kind: "event", source: "ai_suggestion"
    });
    scheduled.push(block);
    occupied.push({ startsAt: block.startsAt, endsAt: block.endsAt, title: block.title });
    newMinutesByDay.set(found.day, (newMinutesByDay.get(found.day) ?? 0) + item.estimateMinutes);
  }

  return { scheduled: scheduled.sort((a, b) => a.startsAt.localeCompare(b.startsAt)), unscheduled };
}

export function buildRoughPlanResponse(input: {
  proposalId: string;
  plan: RoughPlanResult;
  now: Date;
  timezoneOffsetMinutes: number;
  workdayStartHour: number;
  workdayEndHour: number;
  horizonDays: number;
  busy: BusyInterval[];
  existingEvents: ExistingEventCandidate[];
}) {
  const fixedCreates = input.plan.items
    .filter((item) => item.action === "create_fixed" && item.startsAt && item.endsAt && new Date(item.endsAt) > new Date(item.startsAt))
    .map((item) => scheduledSuggestionSchema.parse({
      id: crypto.randomUUID(), proposalId: input.proposalId, title: item.title,
      startsAt: item.startsAt!, endsAt: item.endsAt!, reason: item.reason, kind: "event",
      location: item.location, source: "ai_suggestion" as const
    }));

  const flexibleItems: FlexibleItem[] = input.plan.items
    .filter((item) => item.action === "create_flexible" && item.estimateMinutes)
    .map((item) => ({
      id: crypto.randomUUID(), title: item.title, reason: item.reason, estimateMinutes: item.estimateMinutes!,
      deadlineAt: item.deadlineAt, preferredTimeOfDay: item.preferredTimeOfDay, priority: item.priority
    }));
  const placement = placeFlexibleItems({
    proposalId: input.proposalId, items: flexibleItems, now: input.now, timezoneOffsetMinutes: input.timezoneOffsetMinutes,
    workdayStartHour: input.workdayStartHour, workdayEndHour: input.workdayEndHour, horizonDays: input.horizonDays, busy: input.busy
  });

  const updates: RoughPlanUpdate[] = input.plan.items
    .filter((item) => item.action === "update")
    .map((item) => {
      const match = matchExistingEvent({ titleHint: item.targetTitleHint ?? item.title, dateHint: item.targetDateHint }, input.existingEvents);
      return { title: item.title, reason: item.reason, newStartsAt: item.newStartsAt, newEndsAt: item.newEndsAt, ...match };
    });

  const deletes: RoughPlanDelete[] = input.plan.items
    .filter((item) => item.action === "delete")
    .map((item) => {
      const match = matchExistingEvent({ titleHint: item.targetTitleHint ?? item.title, dateHint: item.targetDateHint }, input.existingEvents);
      return { title: item.title, reason: item.reason, ...match };
    });

  const creates = [...fixedCreates, ...placement.scheduled].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return { creates, updates, deletes, unscheduled: placement.unscheduled, summary: input.plan.summary };
}
