import { describe, expect, it } from "vitest";
import { selectCoachBlocks } from "@/lib/domain/coach-context";

describe("life coach context selection", () => {
  it("limits hundreds of recurring blocks to the nearest relevant context", () => {
    const now = "2026-07-20T00:00:00.000Z";
    const blocks = Array.from({ length: 240 }, (_, index) => ({
      id: String(index), startsAt: new Date(new Date(now).getTime() + index * 60 * 60 * 1000).toISOString(),
      endsAt: new Date(new Date(now).getTime() + (index + 1) * 60 * 60 * 1000).toISOString()
    }));
    const selected = selectCoachBlocks(blocks, now, 80);
    expect(selected).toHaveLength(80);
    expect(selected[0].id).toBe("0");
    expect(selected[79].id).toBe("79");
  });

  it("keeps an active block ahead of later future blocks", () => {
    const selected = selectCoachBlocks([
      { id: "future", startsAt: "2026-07-20T01:00:00.000Z", endsAt: "2026-07-20T02:00:00.000Z" },
      { id: "active", startsAt: "2026-07-19T23:30:00.000Z", endsAt: "2026-07-20T00:30:00.000Z" }
    ], "2026-07-20T00:00:00.000Z", 1);
    expect(selected[0].id).toBe("active");
  });
});
