export type BlockKind = "sleep" | "routine" | "event" | "travel" | "task" | "meal" | "break" | "growth" | "game" | "free";

export interface PlanBlock {
  id: string;
  title: string;
  kind: BlockKind;
  startsAt: string;
  endsAt: string;
  status: "planned" | "active" | "done" | "skipped";
  fixed?: boolean;
}

export interface TaskInput {
  id: string;
  title: string;
  estimateMinutes: number;
  priority: 1 | 2 | 3 | 4;
  dueAt?: string;
  required?: boolean;
}

export interface DisposableTimeInput {
  remainingMinutes: number;
  sleepMinutes: number;
  fixedMinutes: number;
  travelMinutes: number;
  lifeMinutes: number;
  requiredTaskMinutes: number;
  growthMinutes: number;
  bufferMinutes: number;
  uncertainMinutes?: number;
  desiredGameMinutes?: number;
  bedtimeBufferMinutes?: number;
}

export interface DisposableTimeResult {
  totalRemainingMinutes: number;
  requiredMinutes: number;
  recommendedGrowthMinutes: number;
  freeMinutes: number;
  safeGameMinutes: number;
  uncertainMinutes: number;
  estimated: boolean;
}

export interface WakePlanInput {
  firstEventAt: Date;
  arrivalBufferMinutes: number;
  travelMinutes: number;
  departurePrepMinutes: number;
  morningRoutineMinutes: number;
  activationMinutes: number;
  targetSleepMinutes: number;
}

export interface DeparturePlanInput {
  eventStartsAt: Date;
  travelMinutes: number;
  arrivalBufferMinutes: number;
  preparationMinutes?: number;
}
