import { describe, expect, it } from "vitest";
import { createFlexibleEventPlan, isFlexibleEventRequest } from "@/lib/domain/flexible-event-planner";

const proposalId = "f90f6fa5-3ef8-4eed-9c2d-3db0203bc513";

describe("flexible single-event detection", () => {
  it("recognizes a request that picks whichever of a few relative days works", () => {
    expect(isFlexibleEventRequest("今村に相談を明日か明後日にしたいので、どちらか都合のいい方に入れてください")).toBe(true);
    expect(isFlexibleEventRequest("明日空いてる時間に歯医者の予約を入れたい")).toBe(true);
  });

  it("does not misfire on a plain goal-decomposition request", () => {
    expect(isFlexibleEventRequest("7月30日に面接が決まった。企業研究、想定質問の整理、模擬面接を準備したい")).toBe(false);
  });
});

describe("flexible single-event scheduling", () => {
  it("places a single event on the first candidate day with a free daytime slot", () => {
    const plan = createFlexibleEventPlan({
      proposalId,
      text: "今村に相談を明日か明後日にしたいので、どちらか都合のいい方に入れてください",
      now: new Date("2026-07-20T11:56:00.000Z"),
      timezoneOffsetMinutes: -540,
      busy: []
    });
    expect(plan.title).toBe("今村に相談");
    expect(plan.scheduled).toHaveLength(1);
    expect(plan.scheduled[0].startsAt).toBe("2026-07-21T01:00:00.000Z");
    expect(plan.scheduled[0].endsAt).toBe("2026-07-21T01:30:00.000Z");
    expect(plan.unscheduled).toHaveLength(0);
  });

  it("skips to the next candidate day when the first day has no free daytime slot", () => {
    const plan = createFlexibleEventPlan({
      proposalId,
      text: "今村に相談を明日か明後日にしたいので、どちらか都合のいい方に入れてください",
      now: new Date("2026-07-20T11:56:00.000Z"),
      timezoneOffsetMinutes: -540,
      busy: [{ title: "終日出張", startsAt: "2026-07-21T00:00:00.000Z", endsAt: "2026-07-21T09:00:00.000Z" }]
    });
    expect(plan.scheduled).toHaveLength(1);
    expect(plan.scheduled[0].startsAt.slice(0, 10)).toBe("2026-07-22");
  });

  it("reports unscheduled when every candidate day is fully busy", () => {
    const plan = createFlexibleEventPlan({
      proposalId,
      text: "今村に相談を明日か明後日にしたいので、どちらか都合のいい方に入れてください",
      now: new Date("2026-07-20T11:56:00.000Z"),
      timezoneOffsetMinutes: -540,
      busy: [
        { title: "終日出張", startsAt: "2026-07-21T00:00:00.000Z", endsAt: "2026-07-21T09:00:00.000Z" },
        { title: "終日研修", startsAt: "2026-07-22T00:00:00.000Z", endsAt: "2026-07-22T09:00:00.000Z" }
      ]
    });
    expect(plan.scheduled).toHaveLength(0);
    expect(plan.unscheduled).toEqual([{ title: "今村に相談", minutes: 30 }]);
  });
});
