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
});

describe("Google Routes duration", () => {
  it("rounds seconds up to minutes", () => expect(googleDurationToMinutes("121s")).toBe(3));
  it("rejects unknown formats", () => expect(() => googleDurationToMinutes("3 minutes")).toThrow());
});
