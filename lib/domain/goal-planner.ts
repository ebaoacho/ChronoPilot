import type { z } from "zod";
import { goalDecompositionSchema, scheduledSuggestionSchema } from "@/lib/domain/schemas";

export type GoalDecomposition = z.infer<typeof goalDecompositionSchema>;
export type ScheduledSuggestion = z.infer<typeof scheduledSuggestionSchema>;
export type BusyInterval = { startsAt: string; endsAt: string; title?: string };

const DAY = 86_400_000;
const MINUTE = 60_000;

function overlaps(start: number, end: number, busy: BusyInterval) {
  return start < new Date(busy.endsAt).getTime() && new Date(busy.startsAt).getTime() < end;
}

function localDayIndex(timestamp: number, timezoneOffsetMinutes: number) {
  return Math.floor((timestamp - timezoneOffsetMinutes * MINUTE) / DAY);
}

function localHourTimestamp(day: number, hour: number, timezoneOffsetMinutes: number) {
  return day * DAY + hour * 60 * MINUTE + timezoneOffsetMinutes * MINUTE;
}

function roundUp(timestamp: number, minutes: number) {
  const size = minutes * MINUTE;
  return Math.ceil(timestamp / size) * size;
}

export function createFallbackGoalDecomposition(text: string, deadlineAt?: string): GoalDecomposition {
  const title = text.split(/\r?\n|。/)[0]?.trim().slice(0, 120) || "目標を進める";
  return {
    goalTitle: title,
    summary: "AI未設定のため、汎用的な準備ステップへ分解しました。内容は登録前に確認できます。",
    deadlineAt,
    workUnits: [
      { title: `${title}：情報を整理する`, sessions: 1, minutesPerSession: 40, priority: 4, reason: "必要事項と不明点を先に明確にするため" },
      { title: `${title}：準備を進める`, sessions: 2, minutesPerSession: 50, priority: 4, reason: "一度に詰め込まず、複数日に分けて進めるため" },
      { title: `${title}：最終確認`, sessions: 1, minutesPerSession: 30, priority: 4, reason: "締切前に抜け漏れを確認するため" }
    ],
    assumptions: ["具体的な作業量が不明なため、合計170分と仮定しました。"]
  };
}

export function scheduleGoalWork(input: {
  proposalId: string;
  now: string;
  deadlineAt: string;
  timezoneOffsetMinutes: number;
  workdayStartHour: number;
  workdayEndHour: number;
  decomposition: GoalDecomposition;
  busy: BusyInterval[];
}) {
  const now = new Date(input.now).getTime();
  const deadline = new Date(input.deadlineAt).getTime();
  if (!Number.isFinite(now) || !Number.isFinite(deadline) || deadline <= now) throw new Error("締切は現在より後にしてください");
  const occupied: BusyInterval[] = [...input.busy];
  const scheduled: ScheduledSuggestion[] = [];
  const unscheduled: Array<{ title: string; minutes: number }> = [];
  const lastDayByTitle = new Map<string, number>();
  const units = [...input.decomposition.workUnits].sort((a, b) => b.priority - a.priority);

  for (const unit of units) {
    for (let session = 0; session < unit.sessions; session++) {
      const duration = unit.minutesPerSession * MINUTE;
      const previousDay = lastDayByTitle.get(unit.title);
      let day = localDayIndex(now, input.timezoneOffsetMinutes);
      if (previousDay !== undefined) day = previousDay + 1;
      let found: { start: number; end: number; day: number } | undefined;

      while (localHourTimestamp(day, input.workdayStartHour, input.timezoneOffsetMinutes) < deadline && !found) {
        const dayStart = localHourTimestamp(day, input.workdayStartHour, input.timezoneOffsetMinutes);
        const dayEnd = Math.min(localHourTimestamp(day, input.workdayEndHour, input.timezoneOffsetMinutes), deadline);
        let cursor = roundUp(Math.max(now, dayStart), 15);
        while (cursor + duration <= dayEnd) {
          const end = cursor + duration;
          const conflicts = occupied.some((block) => overlaps(cursor - 5 * MINUTE, end + 10 * MINUTE, block));
          if (!conflicts) { found = { start: cursor, end, day }; break; }
          cursor += 15 * MINUTE;
        }
        day += 1;
      }

      if (!found) {
        unscheduled.push({ title: unit.title, minutes: unit.minutesPerSession });
        continue;
      }
      const suffix = unit.sessions > 1 ? ` (${session + 1}/${unit.sessions})` : "";
      const block = scheduledSuggestionSchema.parse({
        id: crypto.randomUUID(), proposalId: input.proposalId, title: `${unit.title}${suffix}`,
        startsAt: new Date(found.start).toISOString(), endsAt: new Date(found.end).toISOString(),
        reason: unit.reason, source: "ai_suggestion"
      });
      scheduled.push(block);
      occupied.push({ startsAt: block.startsAt, endsAt: block.endsAt, title: block.title });
      lastDayByTitle.set(unit.title, found.day);
    }
  }

  return { scheduled: scheduled.sort((a, b) => a.startsAt.localeCompare(b.startsAt)), unscheduled };
}
