import { describe, expect, it } from "vitest";
import { buildFallbackCoachAnswer } from "@/lib/domain/life-coach";
import { googleDurationToMinutes } from "@/lib/integrations/google-routes";
import type { LifeCoachInput } from "@/lib/domain/life-coach";

function input(message: string, nextInMinutes = 60): LifeCoachInput {
  const now = new Date("2026-07-19T03:00:00.000Z");
  return {
    messages: [{ role: "user", content: message }], now: now.toISOString(), timezone: "Asia/Tokyo", freeMinutes: 90, tasks: [],
    blocks: [{ title: "オンライン面談", kind: "event", startsAt: new Date(now.getTime() + nextInMinutes * 60000).toISOString(), endsAt: new Date(now.getTime() + (nextInMinutes + 60) * 60000).toISOString(), fixed: true }]
  };
}

describe("life coach deterministic advice", () => {
  it("allows an activity only when a buffer remains", () => {
    const result = buildFallbackCoachAnswer(input("今から30分ゲームしていい？", 60));
    expect(result.verdict).toBe("yes_with_limit");
    expect(result.impacts[0]?.after).toContain("30分");
  });

  it("does not fit an activity that would collide", () => {
    const result = buildFallbackCoachAnswer(input("今から30分ゲームしていい？", 25));
    expect(result.verdict).toBe("not_now");
  });

  it("never invents a travel duration", () => {
    const result = buildFallbackCoachAnswer(input("今から大学へ行く。何分かかる？"));
    expect(result.verdict).toBe("need_more_info");
    expect(result.estimatedMinutes).toBeUndefined();
  });

  it("uses an externally calculated route", () => {
    const value = input("今から大学へ行く。何分かかる？", 70);
    value.route = { durationMinutes: 35, distanceMeters: 12000, source: "google_routes", mode: "TRANSIT", destination: "大学" };
    const result = buildFallbackCoachAnswer(value);
    expect(result.estimatedMinutes).toBe(35);
    expect(result.verdict).toBe("yes");
  });

  it("handles smoking as a scheduling question without endorsing it", () => {
    const result = buildFallbackCoachAnswer(input("タバコ吸いたい。今吸ったら間に合わない？", 15));
    expect(result.intent).toBe("wellbeing");
    expect(result.reply).toContain("予定面");
  });

  it("formats calendar times in the user's timezone", () => {
    const value = input("明日のことを相談したい");
    value.now = "2026-07-19T14:40:00.000Z";
    value.blocks = [{ title: "就寝", kind: "sleep", startsAt: "2026-07-19T14:58:00.000Z", endsAt: "2026-07-19T21:58:00.000Z", fixed: true }];
    const result = buildFallbackCoachAnswer(value);
    expect(result.reply).toContain("23:58");
    expect(result.reply).not.toContain("14:58");
  });

  it("gives a concrete bath window before tomorrow's sleep", () => {
    const value = input("ゲームしていてお風呂に入れませんでした。明日は何時に入るべき？");
    value.now = "2026-07-19T14:40:00.000Z";
    value.blocks = [{ title: "睡眠", kind: "sleep", startsAt: "2026-07-20T15:00:00.000Z", endsAt: "2026-07-20T22:00:00.000Z", fixed: true }];
    const result = buildFallbackCoachAnswer(value);
    expect(result.reply).toContain("23:00〜23:30");
    expect(result.verdict).toBe("yes_with_limit");
  });

  it("uses conversation history and tomorrow's departure for a calendar proposal", () => {
    const value = input("ゲームでお風呂に入れなかった。明日の朝に入りたい");
    value.messages.push({ role: "assistant", content: "明日の予定を確認します。" });
    value.messages.push({ role: "user", content: "家を出る前に入りたいです" });
    value.now = "2026-07-19T14:40:00.000Z";
    value.blocks = [{ title: "大学への移動", kind: "travel", startsAt: "2026-07-20T00:00:00.000Z", endsAt: "2026-07-20T00:50:00.000Z", fixed: true }];
    const result = buildFallbackCoachAnswer(value);
    expect(result.reply).toContain("大学への移動");
    expect(result.calendarProposal?.title).toBe("入浴");
    expect(result.calendarProposal?.endsAt).toBe("2026-07-19T23:45:00.000Z");
  });
});

describe("Google Routes duration", () => {
  it("rounds seconds up to minutes", () => expect(googleDurationToMinutes("121s")).toBe(3));
  it("rejects unknown formats", () => expect(() => googleDurationToMinutes("3 minutes")).toThrow());
});
