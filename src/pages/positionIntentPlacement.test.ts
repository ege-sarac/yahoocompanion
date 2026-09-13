import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const draftSource = readFileSync(resolve("src/pages/DraftPage.tsx"), "utf8");
const recommendationsSource = readFileSync(resolve("src/pages/RecommendationsPage.tsx"), "utf8");
const controlsSource = readFileSync(resolve("src/components/PositionIntentControls.tsx"), "utf8");
const styles = readFileSync(resolve("src/styles.css"), "utf8");

describe("shared live-draft Position Intent placement", () => {
  it("renders the same shared component on Draft and Recommendations", () => {
    expect(draftSource).toContain('import { PositionIntentControls }');
    expect(recommendationsSource).toContain('import { PositionIntentControls }');
    expect(draftSource).toContain("<PositionIntentControls compact");
    expect(recommendationsSource).toContain("<PositionIntentControls urgency=");
  });

  it("places compact controls before Live Top 5", () => {
    expect(draftSource.indexOf("<PositionIntentControls compact")).toBeLessThan(draftSource.indexOf("Live Top 5"));
  });

  it("keeps controls accessible and exposes the feasibility escape action", () => {
    expect(controlsSource).toContain("aria-pressed");
    expect(controlsSource).toContain("Show roster-feasible options");
    expect(controlsSource).toContain("roster need");
  });

  it("has distinct critical emphasis and a mobile no-overflow layout", () => {
    expect(styles).toContain(".urgency-chip.high");
    expect(styles).toContain(".urgency-chip.critical");
    expect(styles).toContain("@media (max-width: 760px)");
    expect(styles).toContain("grid-template-columns: 1fr");
  });
});
