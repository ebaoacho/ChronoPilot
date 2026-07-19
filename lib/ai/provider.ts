import OpenAI from "openai";
import { z } from "zod";
import { dailyPlanResultSchema, goalDecompositionSchema, lifeCoachResultSchema, morningRoutineSuggestionSchema, naturalAddResultSchema } from "@/lib/domain/schemas";
import type { LifeCoachInput, LifeCoachResult } from "@/lib/domain/life-coach";
import type { GoalDecomposition } from "@/lib/domain/goal-planner";

export type DailyPlanResult = z.infer<typeof dailyPlanResultSchema>;
export type NaturalAddResult = z.infer<typeof naturalAddResultSchema>;
export type MorningRoutineSuggestion = z.infer<typeof morningRoutineSuggestionSchema>;
export interface AiPlanningProvider {
  generateDailyPlan(input: unknown): Promise<DailyPlanResult>;
  reschedule(input: unknown): Promise<DailyPlanResult>;
  decomposeTask(input: { text: string; now: string; timezone: string }): Promise<NaturalAddResult>;
  generateWakePlan(input: unknown): Promise<unknown>;
  generateDeparturePlan(input: unknown): Promise<unknown>;
  calculateDisposableTime(input: unknown): Promise<unknown>;
  negotiateGameTime(input: unknown): Promise<unknown>;
  generateGrowthPlan(input: unknown): Promise<unknown>;
  generateLifeReview(input: unknown): Promise<unknown>;
  chatLifeCoach(input: LifeCoachInput): Promise<LifeCoachResult>;
  decomposeGoal(input: { text: string; now: string; deadlineAt?: string; timezone: string }): Promise<GoalDecomposition>;
  suggestMorningRoutine(input: { text: string; morningPrepMinutes: number; targetSleepMinutes: number; timezone: string }): Promise<MorningRoutineSuggestion>;
}

async function structured<T>(schema: z.ZodType<T>, system: string, input: unknown): Promise<T> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL || undefined });
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini", temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: `${system}\nReturn JSON only. Never change sleep or fixed events.` }, { role: "user", content: JSON.stringify(input) }]
      });
      return schema.parse(JSON.parse(response.choices[0]?.message.content || "{}"));
    } catch (error) { lastError = error; }
  }
  throw lastError;
}

export class OpenAiPlanningProvider implements AiPlanningProvider {
  generateDailyPlan(input: unknown) { return structured(dailyPlanResultSchema, "Prioritize and arrange the supplied already-calculated time slots. ISO timestamps only.", input); }
  reschedule(input: unknown) { return structured(dailyPlanResultSchema, "Generate a humane revised plan and preserve sleep. Explain changed blocks.", input); }
  decomposeTask(input: { text: string; now: string; timezone: string }) { return structured(naturalAddResultSchema, "Parse Japanese or English life planning text into an event and preparation tasks. Do not invent missing facts; put uncertainty in notes.", input); }
  generateWakePlan(input: unknown) { return Promise.resolve(input); }
  generateDeparturePlan(input: unknown) { return Promise.resolve(input); }
  calculateDisposableTime(input: unknown) { return Promise.resolve(input); }
  negotiateGameTime(input: unknown) { return Promise.resolve(input); }
  generateGrowthPlan(input: unknown) { return Promise.resolve(input); }
  generateLifeReview(input: unknown) { return Promise.resolve(input); }
  chatLifeCoach(input: LifeCoachInput) {
    return structured(lifeCoachResultSchema, `You are ChronoPilot's calm Japanese life coach: another version of the user who is excellent at time management.
Answer in natural Japanese, empathetically and without guilt or scolding. Respect rest and games. Preserve sleep.
Use only the supplied timestamps, computed free minutes, route result, tasks, and blocks. Never invent travel time, calendar events, or arithmetic.
For smoking, acknowledge the feeling without encouraging tobacco; separate scheduling impact from health judgment.
Give a clear verdict and practical options. Mention uncertainty in assumptions.`, input);
  }
  decomposeGoal(input: { text: string; now: string; deadlineAt?: string; timezone: string }) {
    return structured(goalDecompositionSchema, `Break a general life goal or upcoming event into concrete preparation work sessions.
Do not choose session timestamps or calculate free time. The application schedules sessions deterministically.
Use the explicit deadline when supplied. If the text contains an unambiguous date, return it as deadlineAt; otherwise omit it.
Prefer focused sessions of 25-50 minutes. Repeated practice may use multiple sessions. Answer in Japanese.
Do not invent organization names, appointments, requirements, or facts not present in the request.`, input);
  }
  suggestMorningRoutine(input: { text: string; morningPrepMinutes: number; targetSleepMinutes: number; timezone: string }) {
    return structured(morningRoutineSuggestionSchema, `Suggest a calm, practical Japanese morning routine for one person.
Return only routine step names, durations, and short reasons. Do not choose timestamps; the application calculates them.
Keep the combined duration close to morningPrepMinutes. Include hydration, light exposure or gentle movement, basic preparation, and a short daily-priority check when appropriate.
Do not make medical claims or invent user preferences. Avoid guilt, productivity pressure, and excessive steps.`, input);
  }
}
