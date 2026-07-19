import { z } from "zod";

export const taskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  estimateMinutes: z.coerce.number().int().min(5).max(1440),
  priority: z.coerce.number().int().min(1).max(4).default(2),
  dueAt: z.string().datetime().optional().or(z.literal("")),
  projectId: z.string().uuid().optional().or(z.literal(""))
});

export const naturalAddResultSchema = z.object({
  event: z.object({ title: z.string(), startsAt: z.string().datetime(), endsAt: z.string().datetime(), location: z.string().optional() }).optional(),
  preparationTasks: z.array(z.object({ title: z.string(), estimateMinutes: z.number().int().positive() })).default([]),
  travelMinutes: z.number().int().nonnegative().default(0),
  arrivalBufferMinutes: z.number().int().nonnegative().default(0),
  googleCalendarCandidate: z.boolean().default(false),
  notes: z.array(z.string()).default([])
});

export const planBlockSchema = z.object({
  title: z.string().min(1), kind: z.enum(["sleep", "routine", "event", "travel", "task", "meal", "break", "growth", "game", "free"]),
  startsAt: z.string().datetime(), endsAt: z.string().datetime(), reason: z.string().optional()
}).refine((v) => new Date(v.endsAt) > new Date(v.startsAt), "終了時刻は開始時刻より後にしてください");

export const dailyPlanResultSchema = z.object({ summary: z.string(), blocks: z.array(planBlockSchema), warnings: z.array(z.string()).default([]) });

export const reflectionSchema = z.object({ mood: z.number().int().min(1).max(5), fatigue: z.number().int().min(1).max(5), focus: z.number().int().min(1).max(5), satisfaction: z.number().int().min(1).max(5), wins: z.string().max(2000).default(""), improveTomorrow: z.string().max(2000).default("") });

export const lifeCoachMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4000)
});

const coachBlockSchema = z.object({
  title: z.string().trim().min(1).max(200),
  kind: z.enum(["sleep", "routine", "event", "travel", "task", "meal", "break", "growth", "game", "free"]),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  fixed: z.boolean().optional()
});

export const routeEstimateSchema = z.object({
  durationMinutes: z.number().int().nonnegative(),
  distanceMeters: z.number().int().nonnegative(),
  source: z.enum(["google_routes", "manual"]),
  mode: z.enum(["DRIVE", "WALK", "BICYCLE", "TRANSIT"]),
  destination: z.string().trim().min(1).max(300)
});

export const lifeCoachInputSchema = z.object({
  messages: z.array(lifeCoachMessageSchema).min(1).max(20),
  now: z.string().datetime(),
  timezone: z.string().trim().min(1).max(80).default("Asia/Tokyo"),
  blocks: z.array(coachBlockSchema).max(100).default([]),
  tasks: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    estimateMinutes: z.number().int().min(1).max(1440),
    priority: z.number().int().min(1).max(4),
    required: z.boolean().optional()
  })).max(100).default([]),
  freeMinutes: z.number().int().nonnegative().max(1440).optional(),
  route: routeEstimateSchema.optional()
});

export const lifeCoachResultSchema = z.object({
  reply: z.string().trim().min(1).max(4000),
  intent: z.enum(["permission", "travel", "replan", "vent", "wellbeing", "general"]),
  verdict: z.enum(["yes", "yes_with_limit", "not_now", "need_more_info"]),
  confidence: z.enum(["high", "medium", "low"]),
  estimatedMinutes: z.number().int().nonnegative().optional(),
  impacts: z.array(z.object({
    label: z.string().trim().min(1).max(200),
    before: z.string().trim().max(100).optional(),
    after: z.string().trim().max(100).optional(),
    severity: z.enum(["info", "warning"])
  })).max(8).default([]),
  options: z.array(z.object({
    label: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(500),
    recommended: z.boolean()
  })).max(6).default([]),
  questions: z.array(z.string().trim().min(1).max(300)).max(4).default([]),
  assumptions: z.array(z.string().trim().min(1).max(300)).max(6).default([])
});

export const routeEstimateRequestSchema = z.object({
  origin: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180)
  }),
  destination: z.string().trim().min(1).max(300),
  mode: z.enum(["DRIVE", "WALK", "BICYCLE", "TRANSIT"]).default("TRANSIT")
});
