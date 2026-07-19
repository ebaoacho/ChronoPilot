import { describe, expect, it } from "vitest";
import { zodResponseFormat } from "openai/helpers/zod";
import { calendarWritePlanSchema, dailyPlanResultSchema, lifeCoachStructuredResultSchema, naturalAddResultSchema } from "@/lib/domain/schemas";

describe("AI response validation", () => {
  it("builds a strict structured-output schema for the life coach", () => {
    const format = zodResponseFormat(lifeCoachStructuredResultSchema, "chronopilot_result");
    expect(format.type).toBe("json_schema");
  });
  it("rejects inverted time blocks", () => {
    expect(() => dailyPlanResultSchema.parse({ summary: "x", blocks: [{ title: "bad", kind: "task", startsAt: "2026-01-01T11:00:00.000Z", endsAt: "2026-01-01T10:00:00.000Z" }], warnings: [] })).toThrow();
  });

  it("defaults safe decomposition fields", () => {
    const result = naturalAddResultSchema.parse({ preparationTasks: [] });
    expect(result.googleCalendarCandidate).toBe(false);
    expect(result.travelMinutes).toBe(0);
  });

  it("accepts a validated AI event with a Google Calendar location", () => {
    const proposalId = "8f53c856-e675-4cd6-a0ab-2d4c49ef967d";
    const result = calendarWritePlanSchema.parse({ proposalId, blocks: [{ id: "4c3598cf-c9be-4e09-8a01-c4d3df3473fd", proposalId, title: "面談", startsAt: "2026-07-20T05:00:00.000Z", endsAt: "2026-07-20T06:00:00.000Z", reason: "自然文から解析", kind: "event", location: "大学", source: "ai_suggestion" }] });
    expect(result.blocks[0].location).toBe("大学");
  });

  it("keeps every explicitly overlapping calendar block", () => {
    const proposalId = "8f53c856-e675-4cd6-a0ab-2d4c49ef967d";
    const common = { proposalId, startsAt: "2026-07-20T05:00:00.000Z", endsAt: "2026-07-20T06:00:00.000Z", reason: "指定時刻を維持", kind: "event" as const, source: "ai_suggestion" as const };
    const result = calendarWritePlanSchema.parse({ proposalId, blocks: [
      { ...common, id: "4c3598cf-c9be-4e09-8a01-c4d3df3473fd", title: "面談" },
      { ...common, id: "5137f5b7-27ed-4fb3-bfe8-164e04731170", title: "授業" }
    ] });
    expect(result.blocks.map((block) => block.title)).toEqual(["面談", "授業"]);
  });
});
