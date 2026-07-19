export type ExternalCalendarEventIdentity = {
  id: string;
  title?: string;
  external_event_id: string;
  external_calendar_id: string;
  starts_at: string;
  ends_at: string;
  raw?: Record<string, unknown> | null;
};

/**
 * Removes duplicate database rows created by Google calendar aliases.
 * Distinct Google events remain visible even when their title and time overlap.
 */
export function dedupeExternalCalendarEvents<T extends ExternalCalendarEventIdentity>(events: T[]) {
  const unique = new Map<string, T>();
  for (const event of events) {
    const key = `${event.external_event_id}\u0000${event.starts_at}\u0000${event.ends_at}`;
    const existing = unique.get(key);
    if (!existing || (existing.external_calendar_id === "primary" && event.external_calendar_id !== "primary")) {
      unique.set(key, event);
    }
  }
  const recurringMasterIds = new Set([...unique.values()].flatMap((event) =>
    typeof event.raw?.recurringEventId === "string" ? [event.raw.recurringEventId] : []
  ));
  const withoutMasters = [...unique.values()]
    .filter((event) => !recurringMasterIds.has(event.external_event_id));
  const semanticUnique = new Map<string, T>();
  for (const event of withoutMasters) {
    const isChronoPilotGenerated = Boolean(event.raw && [
      "chronopilotBlockId", "chronopilotProposalId", "chronopilotSeriesId", "proposalId", "seriesId"
    ].some((key) => typeof event.raw?.[key] === "string"));
    const key = isChronoPilotGenerated
      ? `generated\u0000${event.external_calendar_id}\u0000${event.title ?? ""}\u0000${event.starts_at}\u0000${event.ends_at}`
      : `event\u0000${event.id}`;
    if (!semanticUnique.has(key)) semanticUnique.set(key, event);
  }
  return [...semanticUnique.values()].sort((left, right) => left.starts_at.localeCompare(right.starts_at));
}
