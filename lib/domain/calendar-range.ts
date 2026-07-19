import { addDays, addMonths, addWeeks, startOfDay, startOfMonth, startOfWeek } from "date-fns";

export type CalendarRangeView = "day" | "week" | "month";

export function getCalendarRange(anchor: Date, view: CalendarRangeView) {
  if (view === "day") {
    const start = startOfDay(anchor);
    return { start, end: addDays(start, 1) };
  }
  if (view === "week") {
    const start = startOfWeek(anchor, { weekStartsOn: 1 });
    return { start, end: addDays(start, 7) };
  }
  const start = startOfMonth(anchor);
  return { start, end: addMonths(start, 1) };
}

export function shiftCalendarDate(anchor: Date, view: CalendarRangeView, amount: number) {
  if (view === "day") return addDays(anchor, amount);
  if (view === "week") return addWeeks(anchor, amount);
  return addMonths(anchor, amount);
}
