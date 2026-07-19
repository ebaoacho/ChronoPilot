import { describe, expect, it } from "vitest";
import { createSleepSchedulePlan, isSleepScheduleRequest } from "@/lib/domain/sleep-schedule-planner";

const base = {
  text: "毎日の就寝時刻も設定してください",
  now: new Date("2026-07-19T08:00:00.000Z"),
  horizonDays: 7,
  timezoneOffsetMinutes: -540,
  timeZone: "Asia/Tokyo",
  proposalId: "f90f6fa5-3ef8-4eed-9c2d-3db0203bc513",
  targetSleepMinutes: 420
};

describe("sleep schedule planning", () => {
  it("recognizes a daily bedtime request", () => {
    expect(isSleepScheduleRequest("毎日の就寝時刻も設定してください")).toBe(true);
  });

  it("derives bedtime from a saved wake schedule", () => {
    const plan = createSleepSchedulePlan({ ...base, wakeAt: "2026-07-19T22:00:00.000Z" });
    expect(plan.summary).toContain("00:00就寝・07:00起床");
    expect(plan.series.map((item) => item.title)).toEqual(["就寝準備", "睡眠"]);
    expect(plan.blocks).toHaveLength(14);
  });

  it("uses 7:00 as a transparent fallback when no wake plan exists", () => {
    const plan = createSleepSchedulePlan(base);
    expect(plan.summary).toContain("00:00就寝・07:00起床");
    expect(plan.assumptions[0]).toContain("7:00起床");
  });

  it("honors an explicit bedtime", () => {
    const plan = createSleepSchedulePlan({ ...base, text: "毎日23時30分に寝たいので就寝時間を設定して" });
    expect(plan.summary).toContain("23:30就寝・06:30起床");
  });
});
