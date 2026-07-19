import { createHash } from "node:crypto";
import { decryptToken } from "@/lib/security/crypto";

export type GoogleCalendarConnection = {
  id: string;
  encrypted_refresh_token: string;
  selected_calendar_ids?: string[] | null;
  write_mode?: "confirm" | "today" | "all" | "readonly" | null;
};

export async function getGoogleAccessToken(connection: GoogleCalendarConnection) {
  if (!connection.encrypted_refresh_token) throw new Error("Google Calendarの更新トークンがありません。再接続してください");
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) throw new Error("Google Calendar設定がありません");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: decryptToken(connection.encrypted_refresh_token),
      grant_type: "refresh_token"
    })
  });
  if (!response.ok) throw new Error("Google認証を更新できませんでした。Calendarを再接続してください");
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new Error("Google access tokenを取得できませんでした");
  return body.access_token;
}

export async function listGoogleBusy(input: { accessToken: string; calendarIds: string[]; start: string; end: string }) {
  const intervals: Array<{ startsAt: string; endsAt: string; title: string; externalId?: string; proposalId?: string }> = [];
  for (const calendarId of input.calendarIds.length ? input.calendarIds : ["primary"]) {
    const params = new URLSearchParams({ singleEvents: "true", showDeleted: "false", timeMin: input.start, timeMax: input.end, maxResults: "2500", orderBy: "startTime" });
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`, { headers: { authorization: `Bearer ${input.accessToken}` } });
    if (!response.ok) throw new Error("最新のGoogle予定を確認できませんでした");
    const body = await response.json() as { items?: Array<{ id?: string; summary?: string; status?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; extendedProperties?: { private?: { chronopilotProposalId?: string } } }> };
    for (const event of body.items ?? []) {
      if (event.status === "cancelled") continue;
      const start = event.start?.dateTime ?? event.start?.date;
      const end = event.end?.dateTime ?? event.end?.date;
      if (!start || !end) continue;
      intervals.push({ startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), title: event.summary ?? "(無題)", externalId: event.id, proposalId: event.extendedProperties?.private?.chronopilotProposalId });
    }
  }
  return intervals;
}

export function googleEventId(userId: string, proposalId: string, blockId: string) {
  return createHash("sha256").update(`${userId}:${proposalId}:${blockId}`).digest("hex").slice(0, 40);
}

export async function getGoogleEvent(accessToken: string, calendarId: string, eventId: string) {
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) throw new Error("Google Calendarの重複確認に失敗しました");
  return response.json() as Promise<GoogleInsertedEvent>;
}

export async function insertGooglePlanBlock(input: {
  accessToken: string;
  calendarId: string;
  eventId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  proposalId: string;
  blockId: string;
}) {
  const endpoint = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events?sendUpdates=none`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${input.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      id: input.eventId,
      summary: input.title,
      description: `ChronoPilot AI提案\n${input.reason}`,
      start: { dateTime: input.startsAt },
      end: { dateTime: input.endsAt },
      extendedProperties: { private: { chronopilotProposalId: input.proposalId, chronopilotBlockId: input.blockId } }
    })
  });
  if (response.status === 409) {
    const existing = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events/${input.eventId}`, { headers: { authorization: `Bearer ${input.accessToken}` } });
    if (existing.ok) return existing.json() as Promise<GoogleInsertedEvent>;
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google Calendarへ登録できませんでした (${response.status}): ${body.slice(0, 160)}`);
  }
  return response.json() as Promise<GoogleInsertedEvent>;
}

export type GoogleInsertedEvent = { id: string; etag?: string; status?: string; htmlLink?: string; summary?: string; start?: { dateTime?: string }; end?: { dateTime?: string } };
