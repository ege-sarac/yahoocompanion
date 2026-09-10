import { POST_MOCK_CONFIG } from "../config/postMockConfig";
import { DEFAULT_LEAGUE_CONFIG } from "../config/leagueConfig";
import type { LeagueConfig, Player, PlayerRoleProfile, Projection, ProjectionMetrics, TeamContextSummary, TeamEcosystemResult, TeamRoleDebug } from "../types";
import { calculateFantasyPoints } from "./fantasyPoints";

interface EcosystemCandidate { player: Player; metrics: ProjectionMetrics }
const CHANNELS = ["usageRoleScore", "creationRoleScore", "reboundingRoleScore", "rimProtectionRoleScore", "guardMinutesRoleScore", "forwardMinutesRoleScore", "centerMinutesRoleScore"] as const;

export function buildPlayerRoleProfile(player: Player, metrics: ProjectionMetrics): PlayerRoleProfile {
  const p = metrics.projection;
  const minutes = Math.max(1, p.projectedMinutes);
  const positionWeight = (position: "G" | "F" | "C") => player.yahooPositions.includes(position) ? 1 / Math.max(1, player.yahooPositions.length) : 0;
  return {
    usageRoleScore: clamp((p.projectedPoints / 28) * .65 + (p.projectedPoints / minutes / 1.1) * .35),
    creationRoleScore: clamp((p.projectedAssists / 9) * .7 + positionWeight("G") * .3),
    reboundingRoleScore: clamp(((p.projectedOffensiveRebounds + p.projectedDefensiveRebounds) / 13) * .75 + Math.max(positionWeight("F"), positionWeight("C")) * .25),
    rimProtectionRoleScore: clamp((p.projectedBlocks / 3) * .8 + positionWeight("C") * .2),
    guardMinutesRoleScore: clamp(p.projectedMinutes / 36 * positionWeight("G")),
    forwardMinutesRoleScore: clamp(p.projectedMinutes / 36 * positionWeight("F")),
    centerMinutesRoleScore: clamp(p.projectedMinutes / 36 * positionWeight("C")),
  };
}

export function buildTeamEcosystem(candidates: readonly EcosystemCandidate[], config: LeagueConfig = DEFAULT_LEAGUE_CONFIG): TeamEcosystemResult {
  const grouped = new Map<string, EcosystemCandidate[]>();
  for (const candidate of candidates) if (candidate.player.nbaTeam) grouped.set(candidate.player.nbaTeam, [...(grouped.get(candidate.player.nbaTeam) ?? []), candidate]);
  const profiles = new Map(candidates.map((candidate) => [candidate.player.id, buildPlayerRoleProfile(candidate.player, candidate.metrics)]));
  const teamSupply = new Map<string, { supply: PlayerRoleProfile; shares: Record<string, number> }>();
  for (const [team, members] of grouped) teamSupply.set(team, aggregateSupply(members, profiles));
  const baselines = averageProfiles([...teamSupply.values()].map((entry) => entry.supply));
  const metricsByPlayerId = new Map<string, ProjectionMetrics>();
  const contextsByPlayerId = new Map<string, TeamContextSummary>();
  let capViolations = 0;
  for (const candidate of candidates) {
    if (!candidate.player.nbaTeam) { metricsByPlayerId.set(candidate.player.id, candidate.metrics); continue; }
    const teammates = (grouped.get(candidate.player.nbaTeam) ?? []).filter((member) => member.player.id !== candidate.player.id);
    const surroundings = aggregateSupply(teammates, profiles).supply;
    const context = applyContext(candidate, profiles.get(candidate.player.id)!, surroundings, baselines, config);
    metricsByPlayerId.set(candidate.player.id, context.metrics);
    contextsByPlayerId.set(candidate.player.id, context.summary);
    const cap = contextCap(candidate);
    if (Math.abs(context.summary.adjustmentPercent) > cap + 1e-8) capViolations++;
  }
  const teams: TeamRoleDebug[] = [...grouped].map(([team, members]) => {
    const aggregate = teamSupply.get(team)!;
    return { team, playerCount: members.length, normalizedMinuteShares: aggregate.shares, supply: aggregate.supply,
      vacuums: mapProfile(aggregate.supply, (value, key) => clamp((baselines[key] - value) / Math.max(.1, baselines[key]))),
      congestion: mapProfile(aggregate.supply, (value, key) => clamp((value - baselines[key]) / Math.max(.1, baselines[key]))),
    };
  });
  return { metricsByPlayerId, contextsByPlayerId, teams, playersEvaluated: contextsByPlayerId.size, capViolations, unresolvedTeamPlayers: candidates.filter((candidate) => !candidate.player.nbaTeam).length };
}

function aggregateSupply(members: readonly EcosystemCandidate[], profiles: Map<string, PlayerRoleProfile>): { supply: PlayerRoleProfile; shares: Record<string, number> } {
  const weightedMinutes = members.map((member) => member.metrics.projection.projectedMinutes * injurySupply(member.player));
  const total = weightedMinutes.reduce((sum, value) => sum + value, 0) || 1;
  const shares = Object.fromEntries(members.map((member, index) => [member.player.id, weightedMinutes[index] / total]));
  const supply = emptyProfile();
  members.forEach((member, index) => { const profile = profiles.get(member.player.id)!; for (const key of CHANNELS) supply[key] += profile[key] * weightedMinutes[index] / total; });
  return { supply, shares };
}

function applyContext(candidate: EcosystemCandidate, role: PlayerRoleProfile, competition: PlayerRoleProfile, baseline: PlayerRoleProfile, config: LeagueConfig): { metrics: ProjectionMetrics; summary: TeamContextSummary } {
  const security = roleSecurity(candidate);
  const sensitivity = .45 + (1 - security) * .75;
  const comp = (key: keyof PlayerRoleProfile) => clamp((competition[key] - baseline[key]) / Math.max(.12, baseline[key]));
  const vacuum = (key: keyof PlayerRoleProfile) => clamp((baseline[key] - competition[key]) / Math.max(.12, baseline[key]));
  const scoringCompetition = comp("usageRoleScore"), creationCompetition = comp("creationRoleScore"), reboundingCompetition = comp("reboundingRoleScore"), rimProtectionCompetition = comp("rimProtectionRoleScore");
  const positionKeys = candidate.player.yahooPositions.map((position) => position === "G" ? "guardMinutesRoleScore" : position === "F" ? "forwardMinutesRoleScore" : "centerMinutesRoleScore") as Array<keyof PlayerRoleProfile>;
  const positionalMinuteCompetition = positionKeys.length ? Math.max(...positionKeys.map(comp)) : 0;
  const opportunityVacuum = Math.max(vacuum("usageRoleScore") * role.usageRoleScore, vacuum("creationRoleScore") * role.creationRoleScore, vacuum("reboundingRoleScore") * role.reboundingRoleScore, ...positionKeys.map((key) => vacuum(key) * role[key]));
  const competitionSensitivity = POST_MOCK_CONFIG.teamContext.competitionSensitivity * sensitivity;
  const vacuumSensitivity = POST_MOCK_CONFIG.teamContext.vacuumSensitivity * sensitivity;
  const scoringDelta = -scoringCompetition * role.usageRoleScore * competitionSensitivity + vacuum("usageRoleScore") * role.usageRoleScore * vacuumSensitivity;
  const creationDelta = -creationCompetition * role.creationRoleScore * competitionSensitivity + vacuum("creationRoleScore") * role.creationRoleScore * vacuumSensitivity;
  const reboundDelta = -reboundingCompetition * role.reboundingRoleScore * competitionSensitivity + vacuum("reboundingRoleScore") * role.reboundingRoleScore * vacuumSensitivity;
  const blockDelta = -rimProtectionCompetition * role.rimProtectionRoleScore * competitionSensitivity + vacuum("rimProtectionRoleScore") * role.rimProtectionRoleScore * vacuumSensitivity;
  const minutesDelta = clampSigned((-positionalMinuteCompetition * competitionSensitivity + Math.max(0, ...positionKeys.map(vacuum)) * vacuumSensitivity) * .65, POST_MOCK_CONFIG.teamContext.maximumMinutesAdjustment);
  const base = candidate.metrics.projection;
  const adjusted: Projection = { ...base,
    projectedMinutes: base.projectedMinutes * (1 + minutesDelta),
    projectedPoints: base.projectedPoints * (1 + scoringDelta + minutesDelta * .25),
    projectedAssists: base.projectedAssists * (1 + creationDelta + minutesDelta * .25),
    projectedOffensiveRebounds: base.projectedOffensiveRebounds * (1 + reboundDelta + minutesDelta * .3),
    projectedDefensiveRebounds: base.projectedDefensiveRebounds * (1 + reboundDelta + minutesDelta * .3),
    projectedBlocks: base.projectedBlocks * (1 + blockDelta + minutesDelta * .3),
  };
  adjusted.projectedFantasyPointsPerGame = fantasyPointsPerGame(adjusted, config);
  const cap = contextCap(candidate);
  const rawPercent = base.projectedFantasyPointsPerGame ? adjusted.projectedFantasyPointsPerGame / base.projectedFantasyPointsPerGame - 1 : 0;
  const adjustmentPercent = clampSigned(rawPercent, cap);
  const capInterpolation = rawPercent === 0 ? 1 : Math.min(1, Math.abs(adjustmentPercent / rawPercent));
  for (const key of ["projectedPoints", "projectedOffensiveRebounds", "projectedDefensiveRebounds", "projectedAssists", "projectedSteals", "projectedBlocks", "projectedTurnovers", "projectedDoubleDoubles", "projectedTripleDoubles"] as const) adjusted[key] = base[key] + (adjusted[key] - base[key]) * capInterpolation;
  adjusted.projectedMinutes = base.projectedMinutes + (adjusted.projectedMinutes - base.projectedMinutes) * capInterpolation;
  const targetFp = fantasyPointsPerGame(adjusted, config);
  adjusted.projectedFantasyPointsPerGame = targetFp;
  const lowSpread = Math.max(0, base.projectedFantasyPointsPerGame - (base.projectedFantasyPointsPerGameLow ?? base.projectedFantasyPointsPerGame * .9));
  const highSpread = Math.max(0, (base.projectedFantasyPointsPerGameHigh ?? base.projectedFantasyPointsPerGame * 1.1) - base.projectedFantasyPointsPerGame);
  adjusted.projectedFantasyPointsPerGameLow = Math.min(targetFp, targetFp - lowSpread * (adjustmentPercent < 0 ? 1.15 : .95));
  adjusted.projectedFantasyPointsPerGameHigh = Math.max(targetFp, targetFp + highSpread * (adjustmentPercent > 0 ? 1.05 : 1));
  const minuteLowSpread = Math.max(0, base.projectedMinutes - (base.projectedMinutesLow ?? base.projectedMinutes * .9));
  const minuteHighSpread = Math.max(0, (base.projectedMinutesHigh ?? base.projectedMinutes * 1.1) - base.projectedMinutes);
  adjusted.projectedMinutesLow = Math.min(adjusted.projectedMinutes, adjusted.projectedMinutes - minuteLowSpread * (minutesDelta < 0 ? 1.15 : .9));
  adjusted.projectedMinutesHigh = Math.max(adjusted.projectedMinutes, adjusted.projectedMinutes + minuteHighSpread * (minutesDelta > 0 ? 1.05 : 1));
  const overallContext = cap ? clampSigned(adjustmentPercent / cap, 1) : 0;
  const explanations = contextExplanations(creationCompetition, positionalMinuteCompetition, opportunityVacuum, security, adjustmentPercent);
  return { metrics: { ...candidate.metrics, projection: adjusted, opportunityScore: clamp100(candidate.metrics.opportunityScore + overallContext * 4) }, summary: {
    label: overallContext > .15 ? "Positive" : overallContext < -.15 ? "Crowded" : "Neutral", roleSecurity: security, scoringCompetition, creationCompetition, reboundingCompetition, rimProtectionCompetition, positionalMinuteCompetition, opportunityVacuum, overallContext, adjustmentPercent, minutesAdjustmentPercent: base.projectedMinutes ? adjusted.projectedMinutes / base.projectedMinutes - 1 : 0, baseFantasyPointsPerGame: base.projectedFantasyPointsPerGame, adjustedFantasyPointsPerGame: targetFp, explanations, roleProfile: role,
  }};
}

function roleSecurity({ player, metrics }: EcosystemCandidate): number { const games = player.historicalStats.reduce((sum, season) => sum + season.gamesPlayed, 0); return clamp(metrics.modelConfidence * .45 + Math.min(1, metrics.projection.projectedMinutes / 32) * .3 + Math.min(1, games / 100) * .25); }
function contextCap(candidate: EcosystemCandidate): number { if (candidate.metrics.projectionSource === "Rookie/new-player model") return POST_MOCK_CONFIG.teamContext.newcomerCap; return roleSecurity(candidate) >= .75 ? POST_MOCK_CONFIG.teamContext.secureVeteranCap : POST_MOCK_CONFIG.teamContext.uncertainVeteranCap; }
function injurySupply(player: Player): number { const status = player.injuryStatus ?? "Unknown"; return POST_MOCK_CONFIG.teamContext.injurySupplyFactors[status]; }
function contextExplanations(creation: number, positional: number, vacuum: number, security: number, adjustment: number): string[] { const reasons: string[] = []; if (creation > .35) reasons.push("Multiple high-minute creators reduce assist upside slightly."); if (positional > .35) reasons.push("Same-position minutes are crowded."); if (vacuum > .3) reasons.push("A thin role environment creates modest opportunity."); if (security > .75 && Math.abs(adjustment) > .005) reasons.push("Established role limits teammate-context adjustment."); if (!reasons.length) reasons.push("Current team-role environment is neutral."); return reasons.slice(0, 2); }
function fantasyPointsPerGame(projection: Projection, config: LeagueConfig): number { return calculateFantasyPoints({ points: projection.projectedPoints, offensiveRebounds: projection.projectedOffensiveRebounds, defensiveRebounds: projection.projectedDefensiveRebounds, assists: projection.projectedAssists, steals: projection.projectedSteals, blocks: projection.projectedBlocks, turnovers: projection.projectedTurnovers, doubleDoubles: projection.projectedDoubleDoubles / Math.max(1, projection.projectedGames), tripleDoubles: projection.projectedTripleDoubles / Math.max(1, projection.projectedGames) }, config.scoring); }
function averageProfiles(values: PlayerRoleProfile[]): PlayerRoleProfile { const result = emptyProfile(); if (!values.length) return result; for (const value of values) for (const key of CHANNELS) result[key] += value[key] / values.length; return result; }
function emptyProfile(): PlayerRoleProfile { return { usageRoleScore: 0, creationRoleScore: 0, reboundingRoleScore: 0, rimProtectionRoleScore: 0, guardMinutesRoleScore: 0, forwardMinutesRoleScore: 0, centerMinutesRoleScore: 0 }; }
function mapProfile(value: PlayerRoleProfile, mapper: (value: number, key: keyof PlayerRoleProfile) => number): PlayerRoleProfile { return Object.fromEntries(CHANNELS.map((key) => [key, mapper(value[key], key)])) as unknown as PlayerRoleProfile; }
function clamp(value: number): number { return Math.min(1, Math.max(0, value)); }
function clamp100(value: number): number { return Math.min(100, Math.max(0, value)); }
function clampSigned(value: number, cap: number): number { return Math.min(cap, Math.max(-cap, value)); }
