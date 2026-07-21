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

  it("creates clean titles, an arrival break, and a Monday meeting exception", () => {
    const text = "毎日10時から大学で作業がしたい\n移動50分\n15分前に着きたい\n資料準備30分\n到着後すぐにタバコが吸いたい\n特に月曜日は10時からMTGなのでそれに間に合うようにタバコを吸って資料準備もして余裕を持っていきたい";
    const plan = createRecurringPlan({ text, now: new Date("2026-07-19T08:00:00.000Z"), horizonDays: 14, timezoneOffsetMinutes: -540, timeZone: "Asia/Tokyo", proposalId: "f90f6fa5-3ef8-4eed-9c2d-3db0203bc513" });
    expect(plan.title).toBe("大学で集中作業");
    expect(plan.summary).toContain("月曜日は「月曜MTG」に置き換えます");
    expect(plan.series.map((item) => item.title)).toEqual(["作業・MTG資料の準備", "大学へ移動", "到着後の休憩（喫煙）", "大学で集中作業", "月曜MTG"]);
    expect(plan.series.find((item) => item.title === "大学で集中作業")?.weekdays).not.toContain(1);
    expect(plan.series.find((item) => item.title === "月曜MTG")?.weekdays).toEqual([1]);
    const monday = plan.blocks.filter((block) => block.startsAt.startsWith("2026-07-20"));
    expect(monday.map((block) => block.title)).toContain("月曜MTG");
    expect(monday.map((block) => block.title)).not.toContain("大学で集中作業");
    const smoking = monday.find((block) => block.title === "到着後の休憩（喫煙）");
    expect(smoking?.startsAt).toBe("2026-07-20T00:45:00.000Z");
    expect(smoking?.endsAt).toBe("2026-07-20T00:55:00.000Z");
  });

  it("treats a bare 'N時まで' end-time phrase as an end bound, not a start time", () => {
    const text = "大学での作業は毎日19時までは必須にしたいです。ただ、会議が入っている場合などは、学校で受けたいため、その場合は19時以降に帰宅することになります。大学での集中時間と帰宅の時間をカレンダーに追記してください";
    expect(isRecurringScheduleText(text)).toBe(true);
    const plan = createRecurringPlan({ text, now: new Date("2026-07-19T08:00:00.000Z"), horizonDays: 7, timezoneOffsetMinutes: -540, timeZone: "Asia/Tokyo", proposalId: "f90f6fa5-3ef8-4eed-9c2d-3db0203bc513" });
    const work = plan.series.find((item) => item.title === "大学で集中作業");
    expect(work?.startsAt).toBe("2026-07-20T00:00:00.000Z");
    expect(work?.endsAt).toBe("2026-07-20T10:00:00.000Z");
    const homecoming = plan.series.find((item) => item.title === "帰宅");
    expect(homecoming?.startsAt).toBe("2026-07-20T10:00:00.000Z");
    expect(plan.assumptions.some((note) => note.includes("09:00開始と仮定"))).toBe(true);
    expect(plan.assumptions.some((note) => note.includes("自動では調整されません"))).toBe(true);
  });
});
