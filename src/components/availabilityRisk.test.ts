import { describe, expect, it } from "vitest";

import { getAvailabilityRiskClass } from "./availabilityRisk";

describe("availability risk presentation", () => {
  it.each([
    ["STABLE", "availability-risk-positive"],
    ["MODERATE", "availability-risk-warning"],
    ["HIGH RISK", "availability-risk-danger"],
    ["UNKNOWN", "availability-risk-neutral"],
  ])("maps %s to its semantic class", (label, expected) => {
    expect(getAvailabilityRiskClass(label)).toBe(expected);
  });
});
