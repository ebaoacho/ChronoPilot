import { describe, expect, it } from "vitest";
import { scheduleGoalWork, type GoalDecomposition } from "@/lib/domain/goal-planner";
import { GOOGLE_CALENDAR_SCOPES, googleEventId } from "@/lib/integrations/google-calendar";

const proposalId = "f90f6fa5-3ef8-4eed-9c2d-3db0203bc513";
const base: GoalDecomposition = {
  goalTitle: "面接準備",
  summary: "準備を分散します",
  workUnits: [{ title: "企業研究", sessions: 1, minutesPerSession: 50, priority: 4, reason: "理解を深めるため" }],
  assumptions: []
};

describe("goal schedule placement", () => {
  it("places work after a busy event with buffers", () => {
    const result = scheduleGoalWork({
      proposalId,
      now: "2026-07-19T23:00:00.000Z",
      deadlineAt: "2026-07-21T03:00:00.000Z",
      timezoneOffsetMinutes: -540,
      workdayStartHour: 9,
      workdayEndHour: 22,
      decomposition: base,
      busy: [{ title: "固定予定", startsAt: "2026-07-20T00:00:00.000Z", endsAt: "2026-07-20T01:00:00.000Z" }]
    });
    expect(result.scheduled).toHaveLength(1);
    expect(result.scheduled[0].startsAt).toBe("2026-07-20T01:15:00.000Z");
  });

  it("distributes repeated practice across different local days", () => {
    const result = scheduleGoalWork({
      proposalId,
      now: "2026-07-19T23:00:00.000Z",
      deadlineAt: "2026-07-23T03:00:00.000Z",
      timezoneOffsetMinutes: -540,
      workdayStartHour: 9,
      workdayEndHour: 22,
      decomposition: { ...base, workUnits: [{ ...base.workUnits[0], sessions: 2 }] },
      busy: []
    });
    expect(result.scheduled).toHaveLength(2);
    expect(result.scheduled[0].startsAt.slice(0, 10)).not.toBe(result.scheduled[1].startsAt.slice(0, 10));
  });

  it("reports work that cannot fit before the deadline", () => {
    const result = scheduleGoalWork({
      proposalId,
      now: "2026-07-20T11:50:00.000Z",
      deadlineAt: "2026-07-20T12:00:00.000Z",
      timezoneOffsetMinutes: -540,
      workdayStartHour: 9,
      workdayEndHour: 22,
      decomposition: base,
      busy: []
    });
    expect(result.scheduled).toHaveLength(0);
    expect(result.unscheduled).toEqual([{ title: "企業研究", minutes: 50 }]);
  });
});

describe("Google Calendar idempotency", () => {
  it("creates stable valid event IDs", () => {
    const first = googleEventId("user", proposalId, "block");
    expect(googleEventId("user", proposalId, "block")).toBe(first);
    expect(first).toMatch(/^[a-f0-9]{40}$/);
  });
  it("requests only event and read-only calendar-list access", () => {
    expect(GOOGLE_CALENDAR_SCOPES).toEqual([
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
    ]);
    expect(GOOGLE_CALENDAR_SCOPES).not.toContain("https://www.googleapis.com/auth/calendar" as never);
  });
});
