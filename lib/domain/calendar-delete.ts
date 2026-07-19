export function resolveGoogleDeleteTarget(externalEventId: string, raw: Record<string, unknown>, scope: "single" | "series") {
  const recurringEventId = typeof raw.recurringEventId === "string"
    ? raw.recurringEventId
    : typeof raw.recurrence === "string" ? externalEventId : undefined;
  return {
    eventId: scope === "series" && recurringEventId ? recurringEventId : externalEventId,
    recurringEventId,
    isRecurring: Boolean(recurringEventId)
  };
}
