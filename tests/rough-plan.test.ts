import { describe, expect, it } from "vitest";
import { buildRoughPlanResponse, computeDailyDerivedBlocks, matchExistingEvent, placeFlexibleItems, type ExistingEventCandidate } from "@/lib/domain/rough-plan";
import type { RoughPlanResult } from "@/lib/ai/provider";

const proposalId = "f90f6fa5-3ef8-4eed-9c2d-3db0203bc513";

describe("matchExistingEvent", () => {
  const candidates: ExistingEventCandidate[] = [
    { id: "a", title: "田中さんとMTG", startsAt: "2026-07-27T04:00:00.000Z", endsAt: "2026-07-27T05:00:00.000Z" },
    { id: "b", title: "定例MTG", startsAt: "2026-07-21T04:00:00.000Z", endsAt: "2026-07-21T05:00:00.000Z" }
  ];

  it("confidently matches an exact or near-exact title", () => {
    const result = matchExistingEvent({ titleHint: "田中さんとMTG" }, candidates);
    expect(result.confidence).toBe("matched");
    expect(result.event?.id).toBe("a");
  });

  it("uses the date hint to disambiguate two similarly named events", () => {
    const sameTitle: ExistingEventCandidate[] = [
      { id: "a", title: "飲み会", startsAt: "2026-07-24T12:00:00.000Z", endsAt: "2026-07-24T14:00:00.000Z" },
      { id: "b", title: "飲み会", startsAt: "2026-07-31T12:00:00.000Z", endsAt: "2026-07-31T14:00:00.000Z" }
    ];
    const result = matchExistingEvent({ titleHint: "飲み会", dateHint: "2026-07-31T00:00:00.000Z" }, sameTitle);
    expect(result.confidence).toBe("matched");
    expect(result.event?.id).toBe("b");
  });

  it("reports not_found when nothing resembles the hint", () => {
    expect(matchExistingEvent({ titleHint: "存在しない予定タイトル" }, candidates).confidence).toBe("not_found");
    expect(matchExistingEvent({}, candidates).confidence).toBe("not_found");
  });
});

describe("placeFlexibleItems", () => {
  const now = new Date("2026-07-20T01:00:00.000Z"); // 10:00 JST
  const base = { proposalId, now, timezoneOffsetMinutes: -540, workdayStartHour: 9, workdayEndHour: 22, horizonDays: 14, busy: [] as never[] };

  it("places a single item at the next free slot from now", () => {
    const result = placeFlexibleItems({ ...base, items: [{ id: "1", title: "資料作成", reason: "締切に備えて", estimateMinutes: 60 }] });
    expect(result.scheduled).toHaveLength(1);
    expect(result.scheduled[0].startsAt).toBe("2026-07-20T01:00:00.000Z");
    expect(result.scheduled[0].endsAt).toBe("2026-07-20T02:00:00.000Z");
  });

  it("caps new placement per day and rolls the rest to the next day", () => {
    const result = placeFlexibleItems({
      ...base,
      items: [
        { id: "1", title: "作業A", reason: "空き時間に配置", estimateMinutes: 150 },
        { id: "2", title: "作業B", reason: "空き時間に配置", estimateMinutes: 150 }
      ]
    });
    expect(result.scheduled).toHaveLength(2);
    expect(result.scheduled[0].startsAt.slice(0, 10)).toBe("2026-07-20");
    expect(result.scheduled[1].startsAt).toBe("2026-07-21T00:00:00.000Z");
  });

  it("honors a preferred time-of-day window", () => {
    const result = placeFlexibleItems({ ...base, items: [{ id: "1", title: "夜の運動", reason: "夜の希望に合わせて", estimateMinutes: 60, preferredTimeOfDay: "evening" }] });
    expect(result.scheduled[0].startsAt).toBe("2026-07-20T08:00:00.000Z");
  });

  it("reports an item as unscheduled when it cannot fit before its deadline", () => {
    const result = placeFlexibleItems({
      ...base,
      items: [{ id: "1", title: "急ぎのタスク", reason: "", estimateMinutes: 60, deadlineAt: "2026-07-20T01:20:00.000Z" }]
    });
    expect(result.scheduled).toHaveLength(0);
    expect(result.unscheduled).toEqual([{ title: "急ぎのタスク", minutes: 60 }]);
  });
});

describe("computeDailyDerivedBlocks", () => {
  it("derives a homecoming time per day from that day's actual last calendar event", () => {
    const result = computeDailyDerivedBlocks({
      proposalId, now: new Date("2026-07-20T01:00:00.000Z"), horizonDays: 3, timezoneOffsetMinutes: -540, defaultTravelMinutes: 30,
      items: [{ title: "帰宅", reason: "毎日の帰宅時間を提案" }], existingDerived: [],
      busy: [
        { title: "仕事", startsAt: "2026-07-20T08:00:00.000Z", endsAt: "2026-07-20T09:00:00.000Z" },
        { title: "会議", startsAt: "2026-07-21T09:00:00.000Z", endsAt: "2026-07-21T10:00:00.000Z" }
      ]
    });
    expect(result.scheduled).toHaveLength(2);
    expect(result.scheduled[0].startsAt).toBe("2026-07-20T09:40:00.000Z");
    expect(result.scheduled[0].reason).toContain("仕事");
    expect(result.scheduled[1].startsAt).toBe("2026-07-21T10:40:00.000Z");
    expect(result.notes).toEqual(["「帰宅」は1日分、既存の予定が見つからず提案できませんでした。"]);
  });

  it("ignores personal/routine noise like sleep when picking that day's last obligation", () => {
    const result = computeDailyDerivedBlocks({
      proposalId, now: new Date("2026-07-20T01:00:00.000Z"), horizonDays: 2, timezoneOffsetMinutes: -540, defaultTravelMinutes: 30,
      items: [{ title: "帰宅", reason: "毎日の帰宅時間を提案" }], existingDerived: [],
      busy: [
        { title: "睡眠", startsAt: "2026-07-19T14:00:00.000Z", endsAt: "2026-07-19T22:28:00.000Z" },
        { title: "ゼミ", startsAt: "2026-07-20T08:00:00.000Z", endsAt: "2026-07-20T09:00:00.000Z" },
        { title: "睡眠", startsAt: "2026-07-20T14:00:00.000Z", endsAt: "2026-07-20T22:28:00.000Z" }
      ]
    });
    expect(result.scheduled).toHaveLength(1);
    expect(result.scheduled[0].startsAt.slice(0, 10)).toBe("2026-07-20");
    expect(result.scheduled[0].startsAt).toBe("2026-07-20T09:40:00.000Z");
    expect(result.scheduled[0].reason).toContain("ゼミ");
    expect(result.notes[0]).toContain("1日分");
  });

  it("never proposes a homecoming time that has already passed today", () => {
    const result = computeDailyDerivedBlocks({
      proposalId, now: new Date("2026-07-20T12:00:00.000Z"), horizonDays: 1, timezoneOffsetMinutes: -540, defaultTravelMinutes: 30,
      items: [{ title: "帰宅", reason: "毎日の帰宅時間を提案" }], existingDerived: [],
      busy: [{ title: "仕事", startsAt: "2026-07-20T08:00:00.000Z", endsAt: "2026-07-20T09:00:00.000Z" }]
    });
    expect(result.scheduled).toHaveLength(0);
  });

  it("updates a previously auto-generated homecoming event instead of creating a duplicate", () => {
    const result = computeDailyDerivedBlocks({
      proposalId, now: new Date("2026-07-20T01:00:00.000Z"), horizonDays: 1, timezoneOffsetMinutes: -540, defaultTravelMinutes: 30,
      items: [{ title: "帰宅", reason: "毎日の帰宅時間を提案" }],
      busy: [{ title: "仕事", startsAt: "2026-07-20T08:00:00.000Z", endsAt: "2026-07-20T09:00:00.000Z" }],
      existingDerived: [{ id: "evt-old", title: "毎日の帰宅時間の提案", startsAt: "2026-07-20T04:00:00.000Z", endsAt: "2026-07-20T04:05:00.000Z" }]
    });
    expect(result.scheduled).toHaveLength(0);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0].event?.id).toBe("evt-old");
    expect(result.updates[0].newStartsAt).toBe("2026-07-20T09:40:00.000Z");
    expect(result.updates[0].confidence).toBe("matched");
  });

  it("leaves an existing homecoming event alone when the newly derived time barely changes", () => {
    const result = computeDailyDerivedBlocks({
      proposalId, now: new Date("2026-07-20T01:00:00.000Z"), horizonDays: 1, timezoneOffsetMinutes: -540, defaultTravelMinutes: 30,
      items: [{ title: "帰宅", reason: "毎日の帰宅時間を提案" }],
      busy: [{ title: "仕事", startsAt: "2026-07-20T08:00:00.000Z", endsAt: "2026-07-20T09:00:00.000Z" }],
      existingDerived: [{ id: "evt-old", title: "帰宅", startsAt: "2026-07-20T09:41:00.000Z", endsAt: "2026-07-20T09:46:00.000Z" }]
    });
    expect(result.scheduled).toHaveLength(0);
    expect(result.updates).toHaveLength(0);
  });
});

describe("buildRoughPlanResponse", () => {
  it("combines fixed creates, placed flexible creates, matched updates, and unmatched deletes", () => {
    const plan: RoughPlanResult = {
      summary: "3件の予定と1件のキャンセルを解釈しました",
      items: [
        { action: "create_fixed", title: "歯医者", reason: "指定日時のため", startsAt: "2026-07-22T05:00:00.000Z", endsAt: "2026-07-22T05:30:00.000Z" },
        { action: "create_flexible", title: "資料作成", reason: "空き時間に配置", estimateMinutes: 60 },
        { action: "update", title: "MTG", reason: "時間変更", targetTitleHint: "田中さんとMTG", newStartsAt: "2026-07-27T07:00:00.000Z", newEndsAt: "2026-07-27T08:00:00.000Z" },
        { action: "delete", title: "飲み会", reason: "キャンセル希望", targetTitleHint: "存在しない飲み会" }
      ]
    };
    const existingEvents: ExistingEventCandidate[] = [{ id: "evt-1", title: "田中さんとMTG", startsAt: "2026-07-27T04:00:00.000Z", endsAt: "2026-07-27T05:00:00.000Z" }];
    const result = buildRoughPlanResponse({
      proposalId, plan, now: new Date("2026-07-20T01:00:00.000Z"), timezoneOffsetMinutes: -540,
      workdayStartHour: 9, workdayEndHour: 22, horizonDays: 14, busy: [], existingEvents, existingDerived: [], defaultTravelMinutes: 30
    });
    expect(result.creates.map((c) => c.title)).toEqual(["資料作成", "歯医者"]);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0].confidence).toBe("matched");
    expect(result.updates[0].event?.id).toBe("evt-1");
    expect(result.deletes).toHaveLength(1);
    expect(result.deletes[0].confidence).toBe("not_found");
  });
});
