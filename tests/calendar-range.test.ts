import { describe, expect, it } from "vitest";
import { getCalendarRange, shiftCalendarDate } from "@/lib/domain/calendar-range";

describe("calendar range", () => {
  const anchor = new Date(2026, 6, 19, 15, 30);

  it("shows one selected day and can move to tomorrow", () => {
    const tomorrow = shiftCalendarDate(anchor, "day", 1);
    const range = getCalendarRange(tomorrow, "day");
    expect(range.start).toEqual(new Date(2026, 6, 20));
    expect(range.end).toEqual(new Date(2026, 6, 21));
  });

  it("uses Monday through Sunday for a week", () => {
    const range = getCalendarRange(anchor, "week");
    expect(range.start).toEqual(new Date(2026, 6, 13));
    expect(range.end).toEqual(new Date(2026, 6, 20));
  });

  it("shows the full selected month", () => {
    const nextMonth = shiftCalendarDate(anchor, "month", 1);
    const range = getCalendarRange(nextMonth, "month");
    expect(range.start).toEqual(new Date(2026, 7, 1));
    expect(range.end).toEqual(new Date(2026, 8, 1));
  });
});
