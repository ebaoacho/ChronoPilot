import { describe, expect, it } from "vitest";
import { onboardingSettingsSchema } from "@/lib/domain/schemas";

describe("onboarding settings", () => {
  it("accepts and preserves per-user preference values", () => {
    const settings = onboardingSettingsSchema.parse({
      targetSleepMinutes: 450,
      morningPrepMinutes: 60,
      defaultTravelMinutes: 45,
      weekdayGameMinutes: 120,
      holidayGameMinutes: 180,
      engineerVision: "信頼できるサービスを運用できるエンジニア"
    });
    expect(settings.weekdayGameMinutes).toBe(120);
    expect(settings.holidayGameMinutes).toBe(180);
  });

  it("rejects invalid preference ranges", () => {
    expect(() => onboardingSettingsSchema.parse({
      targetSleepMinutes: 60,
      morningPrepMinutes: 0,
      defaultTravelMinutes: -1,
      weekdayGameMinutes: 999,
      holidayGameMinutes: 999,
      engineerVision: ""
    })).toThrow();
  });
});
