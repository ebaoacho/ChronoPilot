import { describe, expect, it } from "vitest";
import { createMorningRoutinePlan, fallbackMorningRoutine, isMorningRoutineRequest } from "@/lib/domain/morning-routine-planner";

const base = {
  now: new Date("2026-07-19T08:00:00.000Z"),
  horizonDays: 7,
  timezoneOffsetMinutes: -540,
  timeZone: "Asia/Tokyo",
  proposalId: "f90f6fa5-3ef8-4eed-9c2d-3db0203bc513",
  morningPrepMinutes: 52,
  targetSleepMinutes: 420,
  suggestion: fallbackMorningRoutine
};

describe("morning routine planning", () => {
  it("recognizes a request for recommended wake and morning routines", () => {
    expect(isMorningRoutineRequest("起床やモーニングルーティンも私におすすめのものを考えて予定に組み込んでください")).toBe(true);
  });

  it("creates a sleep-preserving daily routine instead of generic preparation tasks", () => {
    const plan = createMorningRoutinePlan({ ...base, requestText: "おすすめのモーニングルーティンを予定に組み込んで" });
    expect(plan.title).toBe("おすすめモーニングルーティン");
    expect(plan.summary).toContain("07:00起床");
    expect(plan.series[0].title).toBe("就寝準備");
    expect(plan.series.some((item) => item.title === "起床して水を飲む")).toBe(true);
    expect(plan.blocks).toHaveLength(49);
  });

  it("honors an explicitly requested wake time", () => {
    const plan = createMorningRoutinePlan({ ...base, requestText: "毎朝6時30分に起きるルーティンを考えて" });
    expect(plan.summary).toContain("06:30起床");
  });

  it("moves wake time earlier when the next morning has an early event", () => {
    const plan = createMorningRoutinePlan({ ...base, requestText: "朝ルーティンをおすすめして", firstEventAt: "2026-07-19T23:00:00.000Z" });
    expect(plan.summary).toContain("06:38起床");
  });
});
