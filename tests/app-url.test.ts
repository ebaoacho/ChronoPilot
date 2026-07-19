import { describe, expect, it } from "vitest";
import { resolveAppOrigin } from "@/lib/app-url";

describe("OAuth redirect origin", () => {
  it("keeps localhost during local development", () => {
    expect(resolveAppOrigin("http://localhost:3000", "https://chronopilot.vercel.app")).toBe("http://localhost:3000");
  });

  it("uses the canonical production URL on a deployed host", () => {
    expect(resolveAppOrigin("https://chronopilot-preview.vercel.app", "https://chronopilot.vercel.app")).toBe("https://chronopilot.vercel.app");
  });

  it("ignores an accidental localhost setting in production", () => {
    expect(resolveAppOrigin("https://chronopilot.vercel.app", "http://localhost:3000")).toBe("https://chronopilot.vercel.app");
  });
});
