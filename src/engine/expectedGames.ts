import { DRAFT_VALUE_CONFIG } from "../config/draftValueConfig";
import type { CareerStageProjection, ExpectedGamesProjection, MajorInjuryComebackProjection, Player, PlayerRoleHistoryRecord, Projection } from "../types";

export function projectMajorInjuryComeback(player: Player, projection: Projection, referenceSeason?: string, roleRecord?: PlayerRoleHistoryRecord): MajorInjuryComebackProjection | undefined {
  const actualSeasons = [...player.historicalStats].sort((a, b) => b.season.localeCompare(a.season));
  const seasons = referenceSeason && actualSeasons[0] && actualSeasons[0].season < referenceSeason ? [{ ...actualSeasons[0], season: referenceSeason, gamesPlayed: 0 }, ...actualSeasons] : actualSeasons;
  const latest = seasons[0], prior = seasons[1];
  const hasKnownRecoverySignal = player.injuryStatus === "Injured" || player.injuryStatus === "Out" || player.injuryStatus === "Returning soon" || Boolean(player.injuryDescription?.trim());
  const eligible = Boolean(latest && prior && hasKnownRecoverySignal && latest.gamesPlayed <= DRAFT_VALUE_CONFIG.comeback.largeMissedPortionGamesMaximum && prior.gamesPlayed >= DRAFT_VALUE_CONFIG.comeback.previousHealthyGamesMinimum);
  if (!eligible || hasMeaningfulReturnedSample(player, roleRecord)) return undefined;
  const ageRisk = (player.age ?? 0) >= DRAFT_VALUE_CONFIG.career.lateCareerAge ? DRAFT_VALUE_CONFIG.comeback.lateCareerRisk : 0;
  const statusRisk = player.injuryStatus === "Injured" || player.injuryStatus === "Out" ? DRAFT_VALUE_CONFIG.comeback.injuredStatusRisk : DRAFT_VALUE_CONFIG.comeback.returningStatusRisk;
  const comebackRisk = clamp(DRAFT_VALUE_CONFIG.comeback.baseRisk + ageRisk + statusRisk, 0, .9);
  const expectedGames = clamp(prior!.gamesPlayed * DRAFT_VALUE_CONFIG.comeback.gamesMultiplier - comebackRisk * 8, DRAFT_VALUE_CONFIG.expectedGames.minimumGames, 64);
  const expectedMinutes = clamp(projection.projectedMinutes * DRAFT_VALUE_CONFIG.comeback.minutesMultiplier, 4, 36);
  return {
    isMajorInjuryComeback: true, comebackRisk,
    expectedGamesLow: clamp(expectedGames - DRAFT_VALUE_CONFIG.comeback.gamesRange, 0, 82), expectedGames, expectedGamesHigh: clamp(expectedGames + DRAFT_VALUE_CONFIG.comeback.gamesRange * .65, 0, 82),
    expectedMinutesLow: clamp(expectedMinutes - DRAFT_VALUE_CONFIG.comeback.minutesRange, 0, 48), expectedMinutes, expectedMinutesHigh: clamp(expectedMinutes + DRAFT_VALUE_CONFIG.comeback.minutesRange * .6, 0, 48),
    confidenceAdjustment: -DRAFT_VALUE_CONFIG.comeback.confidencePenalty,
    reasons: ["Major-injury comeback routing uses a conservative range instead of full healthy-season carry-forward."],
  };
}

export function projectExpectedGames(player: Player, projection: Projection, career: CareerStageProjection, referenceSeason?: string, roleRecord?: PlayerRoleHistoryRecord): ExpectedGamesProjection {
  const config = DRAFT_VALUE_CONFIG.expectedGames;
  const actualSeasons = [...player.historicalStats].sort((a, b) => b.season.localeCompare(a.season));
  const seasons = (referenceSeason && actualSeasons[0] && actualSeasons[0].season < referenceSeason ? [{ ...actualSeasons[0], season: referenceSeason, gamesPlayed: 0 }, ...actualSeasons] : actualSeasons).slice(0, config.seasonWeights.length);
  const sampleGames = seasons.reduce((sum, season) => sum + season.gamesPlayed, 0);
  const observedWeight = Math.min(1, sampleGames / config.priorStrengthGames);
  const weighted = seasons.length ? seasons.reduce((sum, season, index) => sum + normalizeGames(season.gamesPlayed, season.season) * config.seasonWeights[index], 0) / seasons.reduce((sum, _season, index) => sum + config.seasonWeights[index], 0) : config.leagueBaseline;
  const lowCount = seasons.filter((season) => normalizeGames(season.gamesPlayed, season.season) < config.lowSeasonThreshold).length;
  const severeCount = seasons.filter((season) => normalizeGames(season.gamesPlayed, season.season) < config.severeLowSeasonThreshold).length;
  let expected = weighted * observedWeight + config.leagueBaseline * (1 - observedWeight);
  expected -= Math.max(0, lowCount - 1) * config.repeatedLowPenalty + Math.max(0, severeCount - 1) * config.repeatedSeverePenalty;
  expected -= career.durabilityAdjustment;
  const status = player.injuryStatus ?? "Unknown";
  expected -= config.currentStatusMissedGames[status];
  const historicallyFragile = lowCount >= 2 || expected < config.leagueBaseline - 10;
  if (status === "Unknown" && historicallyFragile) expected -= config.unknownFragilePenalty;
  const comeback = projectMajorInjuryComeback(player, projection, referenceSeason, roleRecord);
  if (comeback) expected = comeback.expectedGames;
  expected = clamp(expected, config.minimumGames, config.maximumGames);
  const sampleWeakness = 1 - Math.min(1, sampleGames / (config.priorStrengthGames * 2));
  let range = config.rangeBase + sampleWeakness * config.weakSampleExtraRange + (status === "Unknown" ? config.currentUnknownRangeExtra : 0) + career.durabilityAdjustment * .45;
  if (player.injuryStatus === "Injured" || player.injuryStatus === "Out") range += player.expectedReturnDate ? 3 : 7;
  const low = comeback?.expectedGamesLow ?? clamp(expected - range, 0, 82);
  const high = comeback?.expectedGamesHigh ?? clamp(expected + range * .7, 0, 82);
  const confidence = clamp01(.28 + observedWeight * .45 + (player.injuryStatus && player.injuryStatus !== "Unknown" ? .12 : 0) - range / 100 + (comeback?.confidenceAdjustment ?? 0));
  const reasons: string[] = [];
  if (lowCount >= 2) reasons.push("Repeated low-games seasons reduce the availability baseline.");
  if (status === "Unknown") reasons.push(historicallyFragile ? "Current health is unverified and fragile history widens the range." : "Current health not verified; stable history keeps the adjustment modest.");
  if (status === "Injured" || status === "Out") reasons.push(player.expectedReturnDate ? "Current injury timeline reduces expected games." : "Current injury has no verified return date, widening the range.");
  if (comeback) reasons.push(...comeback.reasons);
  return { expectedGamesLow: round(low), expectedGames: round(expected), expectedGamesHigh: round(high), availabilityConfidence: confidence, availabilityRiskLabel: expected < 59 || range > 18 ? "HIGH RISK" : expected < 69 || range > 13 ? "MODERATE" : "STABLE", currentHealthVerified: Boolean(player.injuryStatus && player.injuryStatus !== "Unknown"), majorInjuryComeback: comeback, reasons };
}

function hasMeaningfulReturnedSample(player: Player, roleRecord?: PlayerRoleHistoryRecord): boolean {
  if (player.injuryStatus === "Out" || player.injuryStatus === "Injured") return false;
  const games = roleRecord?.latestSeasonGames ?? [];
  const meaningful = games.filter((game) => game.minutes >= DRAFT_VALUE_CONFIG.comeback.returnedSampleMinimumMinutes);
  return meaningful.length >= DRAFT_VALUE_CONFIG.comeback.returnedSampleMinimumGames;
}

function normalizeGames(games: number, season?: string): number { const seasonLength = season ? DRAFT_VALUE_CONFIG.historicalSeasonLengths[season] ?? 82 : 82; return clamp(games / seasonLength * 82, 0, 82); }
function round(value: number): number { return Math.round(value * 10) / 10; }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function clamp01(value: number): number { return clamp(value, 0, 1); }
