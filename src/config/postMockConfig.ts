export const POST_MOCK_CONFIG = {
  positionIntent: {
    maximumPreferAdjustment: 9,
    criticalNeedAdjustment: 3,
    valueEscapeGap: 8,
  },
  feasibility: {
    modestSlack: 5,
    criticalSlack: 0,
    highUrgency: 0.7,
    moderateUrgency: 0.4,
  },
  teamContext: {
    secureVeteranCap: 0.04,
    uncertainVeteranCap: 0.06,
    newcomerCap: 0.08,
    maximumMinutesAdjustment: 0.06,
    competitionSensitivity: 0.075,
    vacuumSensitivity: 0.06,
    injurySupplyFactors: { Healthy: 1, "Day-to-day": 0.94, "Returning soon": 0.88, Out: 0.72, Injured: 0.68, Unknown: 0.96 },
    resourceShock: { usageSensitivity: .07, creationSensitivity: .06, reboundSensitivity: .055, materialThreshold: .14 },
  },
  diagnostics: { replayRuns: 20, seed: 20260910 },
} as const;
