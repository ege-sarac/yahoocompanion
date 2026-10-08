/** Presentation-only semantic class for existing Expected Games risk labels. */
export function getAvailabilityRiskClass(label: string | null | undefined): string {
  switch (label) {
    case "STABLE":
      return "availability-risk-positive";
    case "MODERATE":
      return "availability-risk-warning";
    case "HIGH RISK":
      return "availability-risk-danger";
    default:
      return "availability-risk-neutral";
  }
}
