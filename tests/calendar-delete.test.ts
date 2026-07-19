import { describe, expect, it } from "vitest";
import { resolveGoogleDeleteTarget } from "@/lib/domain/calendar-delete";

describe("calendar deletion scope", () => {
  it("deletes only the selected recurring occurrence", () => {
    expect(resolveGoogleDeleteTarget("series_20260720", { recurringEventId: "series" }, "single").eventId).toBe("series_20260720");
  });

  it("resolves an occurrence to its recurring parent for series deletion", () => {
    const result = resolveGoogleDeleteTarget("series_20260720", { recurringEventId: "series" }, "series");
    expect(result.eventId).toBe("series");
    expect(result.isRecurring).toBe(true);
  });

  it("treats a ChronoPilot-created recurring master as a series", () => {
    expect(resolveGoogleDeleteTarget("master", { recurrence: "RRULE:FREQ=DAILY;COUNT=7" }, "series").eventId).toBe("master");
  });
});
