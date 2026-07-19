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
