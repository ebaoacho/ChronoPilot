import { addMinutes, differenceInMinutes, isBefore, max, subMinutes } from "date-fns";
import type { DeparturePlanInput, DisposableTimeInput, DisposableTimeResult, PlanBlock, TaskInput, WakePlanInput } from "./types";

export function calculateDeparture(input: DeparturePlanInput) {
  const arrivalAt = subMinutes(input.eventStartsAt, input.arrivalBufferMinutes);
  const departAt = subMinutes(arrivalAt, input.travelMinutes);
  return { arrivalAt, departAt, preparationStartsAt: subMinutes(departAt, input.preparationMinutes ?? 0) };
}

export function calculateWakePlan(input: WakePlanInput) {
  const { departAt } = calculateDeparture({ eventStartsAt: input.firstEventAt, travelMinutes: input.travelMinutes, arrivalBufferMinutes: input.arrivalBufferMinutes });
  const wakeAt = subMinutes(departAt, input.departurePrepMinutes + input.morningRoutineMinutes + input.activationMinutes);
  return { wakeAt, departAt, recommendedBedtime: subMinutes(wakeAt, input.targetSleepMinutes) };
}

export function calculateDisposableTime(input: DisposableTimeInput): DisposableTimeResult {
  const values = Object.values(input);
  if (values.some((value) => typeof value === "number" && value < 0)) throw new Error("時間は0以上で指定してください");
  const requiredMinutes = input.sleepMinutes + input.fixedMinutes + input.travelMinutes + input.lifeMinutes + input.requiredTaskMinutes + input.bufferMinutes;
  const available = Math.max(0, input.remainingMinutes - requiredMinutes);
  const growth = Math.min(input.growthMinutes, available);
  const uncertain = Math.min(input.uncertainMinutes ?? 0, Math.max(0, available - growth));
  const freeMinutes = Math.max(0, available - growth - uncertain);
  const safeGameMinutes = Math.max(0, Math.min(input.desiredGameMinutes ?? freeMinutes, freeMinutes - (input.bedtimeBufferMinutes ?? 0)));
  return { totalRemainingMinutes: input.remainingMinutes, requiredMinutes, recommendedGrowthMinutes: growth, freeMinutes, safeGameMinutes, uncertainMinutes: uncertain, estimated: (input.uncertainMinutes ?? 0) > 0 };
}

export function splitTask(task: TaskInput, targetMinutes = 40): TaskInput[] {
  if (task.estimateMinutes <= 50) return [task];
  const chunks = Math.ceil(task.estimateMinutes / Math.min(50, Math.max(25, targetMinutes)));
  const base = Math.floor(task.estimateMinutes / chunks);
  return Array.from({ length: chunks }, (_, index) => ({ ...task, id: `${task.id}-${index + 1}`, title: `${task.title} (${index + 1}/${chunks})`, estimateMinutes: base + (index < task.estimateMinutes % chunks ? 1 : 0) }));
}

export function blocksOverlap(a: Pick<PlanBlock, "startsAt" | "endsAt">, b: Pick<PlanBlock, "startsAt" | "endsAt">) {
  return new Date(a.startsAt) < new Date(b.endsAt) && new Date(b.startsAt) < new Date(a.endsAt);
}

export function createFallbackPlan(day: Date, tasks: TaskInput[], fixedBlocks: PlanBlock[], startAt = new Date()): PlanBlock[] {
  const ordered = [...tasks].sort((a, b) => {
    const due = (a.dueAt ? new Date(a.dueAt).getTime() : Infinity) - (b.dueAt ? new Date(b.dueAt).getTime() : Infinity);
    return due || b.priority - a.priority;
  }).flatMap((task) => splitTask(task));
  const blocks = [...fixedBlocks].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  let cursor = max([startAt, new Date(day.getFullYear(), day.getMonth(), day.getDate(), 7)]);
  for (const task of ordered) {
    let end = addMinutes(cursor, task.estimateMinutes);
    for (const fixed of blocks) {
      if (blocksOverlap({ startsAt: cursor.toISOString(), endsAt: end.toISOString() }, fixed)) {
        cursor = new Date(fixed.endsAt);
        end = addMinutes(cursor, task.estimateMinutes);
      }
    }
    blocks.push({ id: task.id, title: task.title, kind: task.required ? "task" : "growth", startsAt: cursor.toISOString(), endsAt: end.toISOString(), status: "planned" });
    cursor = addMinutes(end, task.estimateMinutes >= 40 ? 10 : 5);
  }
  return blocks.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export function rescheduleAfterDelay(blocks: PlanBlock[], from: Date, delayMinutes: number) {
  return blocks.map((block) => block.fixed || isBefore(new Date(block.startsAt), from) ? block : ({ ...block, startsAt: addMinutes(new Date(block.startsAt), delayMinutes).toISOString(), endsAt: addMinutes(new Date(block.endsAt), delayMinutes).toISOString() }));
}

export function getCurrentAndNext(blocks: PlanBlock[], now: Date) {
  const current = blocks.find((b) => new Date(b.startsAt) <= now && now < new Date(b.endsAt));
  const next = blocks.find((b) => new Date(b.startsAt) > now);
  return { current, next, remainingMinutes: current ? Math.max(0, differenceInMinutes(new Date(current.endsAt), now)) : 0 };
}

export function assertOwnership(userId: string, recordUserId: string) {
  if (!userId || userId !== recordUserId) throw new Error("このデータを操作する権限がありません");
  return true;
}
