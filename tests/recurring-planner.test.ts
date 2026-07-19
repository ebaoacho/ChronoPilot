import { describe, expect, it } from "vitest";
import { createRecurringPlan, isRecurringScheduleText } from "@/lib/domain/recurring-planner";

describe("recurring natural-language planning", () => {
  it("recognizes a daily schedule and calculates preparation, travel, and arrival buffer", () => {
    const text = "毎日の10時から大学で作業に打ち込みたい\n移動50分\n15分前に着きたい\n資料準備30分";
    expect(isRecurringScheduleText(text)).toBe(true);
    const plan = createRecurringPlan({ text, now: new Date("2026-07-19T08:00:00.000Z"), horizonDays: 7, timezoneOffsetMinutes: -540, timeZone: "Asia/Tokyo", proposalId: "f90f6fa5-3ef8-4eed-9c2d-3db0203bc513" });
    expect(plan.recurrenceLabel).toBe("毎日");
    expect(plan.series).toHaveLength(3);
    expect(plan.series.map((item) => item.kind)).toEqual(["task", "travel", "event"]);
    expect(plan.series[1].startsAt).toBe("2026-07-19T23:55:00.000Z");
    expect(plan.series[1].endsAt).toBe("2026-07-20T00:45:00.000Z");
    expect(plan.series[2].startsAt).toBe("2026-07-20T01:00:00.000Z");
    expect(plan.series[2].timeZone).toBe("Asia/Tokyo");
    expect(plan.assumptions[0]).toContain("120分");
  });

  it("supports weekday-only recurrence", () => {
    const plan = createRecurringPlan({ text: "平日の午前9時から英語を勉強したい", now: new Date("2026-07-19T00:00:00.000Z"), horizonDays: 7, timezoneOffsetMinutes: -540, timeZone: "Asia/Tokyo", proposalId: "f90f6fa5-3ef8-4eed-9c2d-3db0203bc513" });
    expect(plan.recurrenceLabel).toBe("平日");
    expect(plan.series[0].recurrence).toContain("BYDAY=MO,TU,WE,TH,FR");
    expect(plan.blocks).toHaveLength(5);
  });
});
