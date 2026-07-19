import { describe, expect, it } from "vitest";
import { dedupeExternalCalendarEvents } from "@/lib/domain/calendar-events";

const base = {
  starts_at: "2026-07-19T14:28:00.000Z",
  ends_at: "2026-07-19T14:58:00.000Z"
};

describe("dedupeExternalCalendarEvents", () => {
  it("collapses primary and email aliases for the same Google event", () => {
    const result = dedupeExternalCalendarEvents([
      { ...base, id: "alias", external_event_id: "google-event", external_calendar_id: "primary" },
      { ...base, id: "canonical", external_event_id: "google-event", external_calendar_id: "me@example.com" }
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("canonical");
  });

  it("retains intentionally overlapping distinct Google events", () => {
    const result = dedupeExternalCalendarEvents([
      { ...base, id: "one", external_event_id: "google-one", external_calendar_id: "me@example.com" },
      { ...base, id: "two", external_event_id: "google-two", external_calendar_id: "me@example.com" }
    ]);
    expect(result).toHaveLength(2);
  });
});
