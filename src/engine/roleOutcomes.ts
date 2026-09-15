import { DRAFT_VALUE_CONFIG } from "../config/draftValueConfig";
import type { NewPlayerProjectionInput, Player, ProjectionMetrics, RoleContextSummary, RoleOutcomeScenario, RoleScenarioSummary, SeasonValueProjection } from "../types";

interface RoleOutcomeInput {
  player: Player;
  metrics: ProjectionMetrics;
  newPlayerInput?: NewPlayerProjectionInput;
  roleContextSummary?: RoleContextSummary;
  seasonValue: SeasonValueProjection;
  draftProgress: number;
  minutesOutsideRoleRange?: boolean;
}

/** A compact role-outcome distribution: role evidence changes plausible minutes, not player talent. */
export function buildRoleScenarioSummary(input: RoleOutcomeInput): RoleScenarioSummary {
  const { metrics, newPlayerInput, roleContextSummary, seasonValue, draftProgress } = input;
  const config = DRAFT_VALUE_CONFIG.roleScenarios;
  const projection = metrics.projection;
  const security = metrics.roleAssessment?.currentRoleSecurity ?? .5;
  const sustainability = roleContextSummary?.roleSustainability ?? (security >= config.stableRoleSecurity ? .82 : .58);
  const roleGain = Math.max(0, roleContextSummary?.lateSeasonMinutesChange ?? 0);
  const absenceDependency = clamp01(roleContextSummary?.absenceDependencyScore ?? 0);
  const credibleNewStarter = metrics.projectionSource === "Rookie/new-player model"
    && newPlayerInput?.roleExpectation === "Likely starter"
    && (metrics.newPlayerDetails?.draftCapitalContribution ?? 0) >= .55;
  const stableRole = security >= config.stableRoleSecurity && sustainability >= config.sustainableRoleThreshold && roleGain < 1;
  const baseMinutes = clamp(projection.projectedMinutes - roleGain * ((1 - sustainability) * config.temporaryGainBaseRetention + absenceDependency * config.absenceDependencyBaseMinutesWeight), 0, 42);
  const lowMinutes = clamp(Math.min(projection.projectedMinutesLow ?? baseMinutes - 3, baseMinutes - Math.max(1.5, roleGain * (1 - sustainability))), 0, baseMinutes);
  const highMinutes = clamp(Math.max(projection.projectedMinutesHigh ?? baseMinutes + 3, baseMinutes + Math.max(1.5, roleGain * sustainability)), baseMinutes, 42);
  const probabilities = scenarioProbabilities(security, sustainability, stableRole, credibleNewStarter, roleGain > 1, absenceDependency);
  const baseRate = safeRate(projection.projectedFantasyPointsPerGame, projection.projectedMinutes);
  const lowRate = safeRate(projection.projectedFantasyPointsPerGameLow ?? projection.projectedFantasyPointsPerGame, projection.projectedMinutesLow ?? projection.projectedMinutes);
  const highRate = safeRate(projection.projectedFantasyPointsPerGameHigh ?? projection.projectedFantasyPointsPerGame, projection.projectedMinutesHigh ?? projection.projectedMinutes);
  const games = metrics.expectedGamesProjection?.expectedGames ?? projection.projectedGames;
  const scenarios: RoleOutcomeScenario[] = [
    scenario("LOW", probabilities.low, lowMinutes, lowRate, games, seasonValue.replacementFantasyPointsPerGame),
    scenario("BASE", probabilities.base, baseMinutes, baseRate, games, seasonValue.replacementFantasyPointsPerGame),
    scenario("HIGH", probabilities.high, highMinutes, highRate, games, seasonValue.replacementFantasyPointsPerGame),
  ];
  const meanSeasonVorp = scenarios.reduce((sum, item) => sum + item.probability * item.seasonVorp, 0);
  const downsideRetention = lerp(config.downsideRetentionEarly, config.downsideRetentionLate, draftProgress);
  const baseScenario = scenarios[1], lowScenario = scenarios[0], highScenario = scenarios[2];
  const credibleUpsideSurplus = highScenario.probability * Math.max(0, highScenario.seasonVorp - baseScenario.seasonVorp);
  const credibleDownsideGap = lowScenario.probability * Math.max(0, baseScenario.seasonVorp - lowScenario.seasonVorp);
  const downsideAdjustedMean = scenarios.reduce((sum, item) => sum + item.probability * (item.seasonVorp >= 0 ? item.seasonVorp : item.seasonVorp * downsideRetention), 0);
  const evidence = clamp01(.45 * security + .35 * sustainability + .2 * metrics.modelConfidence);
  const spreadPremium = Math.max(0, credibleUpsideSurplus - credibleDownsideGap * downsideRetention) * evidence;
  const optionAdjustedSeasonVorp = downsideAdjustedMean + spreadPremium;
  const optionPremium = Math.max(0, optionAdjustedSeasonVorp - meanSeasonVorp);
  const optionScoreCap = progressValue(config.optionScoreCapEarly, config.optionScoreCapMiddle, config.optionScoreCapLate, draftProgress);
  const optionScoreAdjustment = Math.min(optionScoreCap, optionPremium / config.optionVorpScale * optionScoreCap * evidence);
  const upsideLabel = credibleUpsideSurplus >= config.upsideLabelHighSurplus && evidence >= .5 ? "HIGH" : credibleUpsideSurplus >= config.upsideLabelMediumSurplus && evidence >= .4 ? "MEDIUM" : "LOW";
  const reasons: string[] = [];
  if (credibleNewStarter) reasons.push("Credible starter pathway protects the newcomer role range.");
  if (roleGain > 1 && sustainability < .55) reasons.push("Late-season role gain is discounted because its offseason context is less secure.");
  if (upsideLabel !== "LOW") reasons.push("Credible late-round upside comes from a larger plausible role, not an inflated rate.");
  if (input.minutesOutsideRoleRange) reasons.push("Minutes reconciliation required an outside-role-range adjustment.");
  return { roleSustainability: sustainability, scenarios, meanSeasonVorp, optionAdjustedSeasonVorp, optionPremium, optionScoreAdjustment, credibleUpsideSurplus, credibleDownsideGap, upsideLabel, minutesOutsideRoleRange: Boolean(input.minutesOutsideRoleRange), reasons };
}

function scenario(label: RoleOutcomeScenario["label"], probability: number, minutes: number, rate: number, expectedGames: number, replacement: number): RoleOutcomeScenario {
  const projectedFantasyPointsPerGame = minutes * rate;
  return { label, probability, healthyGameMPG: minutes, projectedFantasyPointsPerMinute: rate, projectedFantasyPointsPerGame, expectedGames, seasonVorp: (projectedFantasyPointsPerGame - replacement) * expectedGames };
}

function scenarioProbabilities(security: number, sustainability: number, stable: boolean, credibleNewStarter: boolean, meaningfulGain: boolean, absenceDependency: number): { low: number; base: number; high: number } {
  if (stable) return { low: .16, base: .68, high: .16 };
  const low = clamp(.18 + (1 - security) * .22 + (meaningfulGain ? (1 - sustainability) * .1 : 0), .16, .44);
  const high = clamp(.05 + sustainability * .14 + (credibleNewStarter ? .14 : 0) + (meaningfulGain ? sustainability * .1 : 0) - absenceDependency * DRAFT_VALUE_CONFIG.roleScenarios.absenceDependencyHighScenarioWeight, .05, DRAFT_VALUE_CONFIG.roleScenarios.maximumHighProbability);
  const varianceScale = Math.min(1, (1 - DRAFT_VALUE_CONFIG.roleScenarios.minimumBaseProbability) / Math.max(.001, low + high));
  const adjustedLow = low * varianceScale, adjustedHigh = high * varianceScale;
  return { low: adjustedLow, base: 1 - adjustedLow - adjustedHigh, high: adjustedHigh };
}

function safeRate(points: number, minutes: number): number { return minutes > 0 ? points / minutes : 0; }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function clamp01(value: number): number { return clamp(value, 0, 1); }
function lerp(from: number, to: number, progress: number): number { return from + (to - from) * clamp01(progress); }
function progressValue(early: number, middle: number, late: number, progress: number): number { return progress <= .5 ? lerp(early, middle, progress * 2) : lerp(middle, late, (progress - .5) * 2); }
