import { describe, expect, it } from "vitest";
import { classifyAvailabilityRisk } from "./expectedGames";

describe("availability-risk semantics", () => {
  it("uses final expected games for visible availability severity", () => {
    expect(classifyAvailabilityRisk(79)).toBe("STABLE");
    expect(classifyAvailabilityRisk(69)).toBe("MODERATE");
    expect(classifyAvailabilityRisk(58.9)).toBe("HIGH RISK");
  });
});
