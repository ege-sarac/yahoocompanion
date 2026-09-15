import { DEFAULT_LEAGUE_CONFIG } from "../config/leagueConfig";
import { POST_MOCK_CONFIG } from "../config/postMockConfig";
import { ROLE_PROJECTION_CONFIG } from "../config/roleProjectionConfig";
import type { LeagueConfig, Player, PlayerRoleMetrics, PlayerRoleProfile, Projection, ProjectionMetrics, TeamContextSummary, TeamEcosystemResult, TeamRoleDebug } from "../types";
import { calculateFantasyPoints } from "./fantasyPoints";
import { estimateProjectedBonusCounts } from "./projectionModel";

interface EcosystemCandidate { player: Player; metrics: ProjectionMetrics }
const CHANNELS = ["usageRoleScore", "creationRoleScore", "ballDominanceRoleScore", "reboundingRoleScore", "rimProtectionRoleScore", "guardMinutesRoleScore", "forwardMinutesRoleScore", "centerMinutesRoleScore"] as const;
type Channel = typeof CHANNELS[number];
interface TeamBudget { loadBefore: number; loadAfter: number; usageAdjustmentByPlayerId: Map<string, number>; normalizedMinutes: Record<string, number>; projectedPace: number }

/** Measured role data wins; box-score/projection profiles remain a safe fallback. */
export function buildPlayerRoleProfile(player: Player, metrics: ProjectionMetrics, measured?: PlayerRoleMetrics): PlayerRoleProfile {
  const p = metrics.projection;
  const minutes = Math.max(1, p.projectedMinutes);
  const positionWeight = (position: "G" | "F" | "C") => player.yahooPositions.includes(position) ? 1 / Math.max(1, player.yahooPositions.length) : 0;
  const measuredValue = (value: number | undefined, scale: number, fallback: number) => value === undefined ? fallback : clamp(value / scale);
  const usageFallback = clamp((p.projectedPoints / 28) * .65 + (p.projectedPoints / minutes / 1.1) * .35);
  const creationFallback = clamp((p.projectedAssists / 9) * .7 + positionWeight("G") * .3);
  const reboundFallback = clamp(((p.projectedOffensiveRebounds + p.projectedDefensiveRebounds) / 13) * .75 + Math.max(positionWeight("F"), positionWeight("C")) * .25);
  const hasMeasured = Boolean(measured?.dataSourceFlags.some((flag) => flag === "NBA Advanced" || flag === "NBA Tracking"));
  return {
    usageRoleScore: measuredValue(measured?.usagePct, 35, measuredValue(measured?.fgaPer36, 24, usageFallback)),
    creationRoleScore: averageDefined([
      measured?.assistPct === undefined ? undefined : clamp(measured.assistPct / 45),
      measured?.potentialAssistsPer36 === undefined ? undefined : clamp(measured.potentialAssistsPer36 / 22),
      measured?.touchesPer36 === undefined ? undefined : clamp(measured.touchesPer36 / 95),
    ], creationFallback),
    ballDominanceRoleScore: averageDefined([
      measured?.timeOfPossessionPctOfMinutes === undefined ? undefined : clamp(measured.timeOfPossessionPctOfMinutes / 25),
      measured?.touchesPer36 === undefined ? undefined : clamp(measured.touchesPer36 / 95),
    ], creationFallback),
    reboundingRoleScore: averageDefined([
      measured?.totalReboundPct === undefined ? undefined : clamp(measured.totalReboundPct / 24),
      measured?.reboundChancesPer36 === undefined ? undefined : clamp(measured.reboundChancesPer36 / 24),
      measured?.offensiveReboundsPer36 === undefined || measured?.defensiveReboundsPer36 === undefined ? undefined : clamp((measured.offensiveReboundsPer36 + measured.defensiveReboundsPer36) / 15),
    ], reboundFallback),
    rimProtectionRoleScore: measuredValue(measured?.blocksPer36, 4, clamp((p.projectedBlocks / 3) * .8 + positionWeight("C") * .2)),
    guardMinutesRoleScore: clamp(p.projectedMinutes / 36 * positionWeight("G")),
    forwardMinutesRoleScore: clamp(p.projectedMinutes / 36 * positionWeight("F")),
    centerMinutesRoleScore: clamp(p.projectedMinutes / 36 * positionWeight("C")),
    expectedUsagePct: measured?.usagePct,
    pace: measured?.pace,
    source: hasMeasured ? "measured" : measured ? "derived proxy" : "projection heuristic",
  };
}

export function buildTeamEcosystem(candidates: readonly EcosystemCandidate[], config: LeagueConfig = DEFAULT_LEAGUE_CONFIG, latestRoleMetricsByPlayerId: ReadonlyMap<string, PlayerRoleMetrics> = new Map()): TeamEcosystemResult {
  const grouped = new Map<string, EcosystemCandidate[]>();
  for (const candidate of candidates) if (candidate.player.nbaTeam) grouped.set(candidate.player.nbaTeam, [...(grouped.get(candidate.player.nbaTeam) ?? []), candidate]);
  const profiles = new Map(candidates.map((candidate) => [candidate.player.id, buildPlayerRoleProfile(candidate.player, candidate.metrics, latestRoleMetricsByPlayerId.get(candidate.player.id))]));
  const priorGrouped = new Map<string, EcosystemCandidate[]>();
  for (const candidate of candidates) {
    const priorTeam = latestRoleMetricsByPlayerId.get(candidate.player.id)?.team;
    if (priorTeam) priorGrouped.set(priorTeam, [...(priorGrouped.get(priorTeam) ?? []), candidate]);
  }
  const teamSupply = new Map<string, { supply: PlayerRoleProfile; shares: Record<string, number> }>();
  const budgets = new Map<string, TeamBudget>();
  for (const [team, members] of grouped) { teamSupply.set(team, aggregateSupply(members, profiles)); budgets.set(team, reconcileUsageBudget(members, profiles)); }
  const baselines = averageProfiles([...teamSupply.values()].map((entry) => entry.supply));
  const metricsByPlayerId = new Map<string, ProjectionMetrics>();
  const contextsByPlayerId = new Map<string, TeamContextSummary>();
  let capViolations = 0;
  for (const candidate of candidates) {
    if (!candidate.player.nbaTeam) { metricsByPlayerId.set(candidate.player.id, candidate.metrics); continue; }
    const teammates = (grouped.get(candidate.player.nbaTeam) ?? []).filter((member) => member.player.id !== candidate.player.id);
    const priorTeam = latestRoleMetricsByPlayerId.get(candidate.player.id)?.team;
    const priorTeammates = priorTeam ? (priorGrouped.get(priorTeam) ?? []).filter((member) => member.player.id !== candidate.player.id) : [];
    const context = applyContext(candidate, profiles.get(candidate.player.id)!, aggregateSupply(teammates, profiles).supply, priorTeammates.length ? aggregateSupply(priorTeammates, profiles).supply : undefined, baselines, budgets.get(candidate.player.nbaTeam)!, config);
    metricsByPlayerId.set(candidate.player.id, context.metrics);
    contextsByPlayerId.set(candidate.player.id, context.summary);
    if (context.summary.maximumStatAdjustmentPercent > contextCap(candidate) + 1e-8) capViolations++;
  }
  const teams: TeamRoleDebug[] = [...grouped].map(([team, members]) => {
    const aggregate = teamSupply.get(team)!;
    const budget = budgets.get(team)!;
    const vacuums = mapProfile(aggregate.supply, (value, key) => clamp((baselines[key] - value) / Math.max(.1, baselines[key])));
    const congestion = mapProfile(aggregate.supply, (value, key) => clamp((value - baselines[key]) / Math.max(.1, baselines[key])));
    return { team, playerCount: members.length, normalizedMinuteShares: Object.fromEntries(Object.entries(budget.normalizedMinutes).map(([id, minutes]) => [id, minutes / 240])), supply: aggregate.supply, vacuums, congestion, teamUsageLoadBefore: budget.loadBefore, teamUsageLoadAfter: budget.loadAfter, creationCongestion: congestion.creationRoleScore, creationVacuum: vacuums.creationRoleScore, frontcourtCongestion: Math.max(congestion.reboundingRoleScore, congestion.centerMinutesRoleScore), frontcourtVacuum: Math.max(vacuums.reboundingRoleScore, vacuums.centerMinutesRoleScore), projectedPace: budget.projectedPace };
  });
  return { metricsByPlayerId, contextsByPlayerId, teams, playersEvaluated: contextsByPlayerId.size, capViolations, unresolvedTeamPlayers: candidates.filter((candidate) => !candidate.player.nbaTeam).length };
}

function reconcileUsageBudget(members: readonly EcosystemCandidate[], profiles: ReadonlyMap<string, PlayerRoleProfile>): TeamBudget {
  const minuteSupply = members.map((member) => Math.max(0, member.metrics.projection.projectedMinutes * injurySupply(member.player)));
  const totalMinutes = minuteSupply.reduce((sum, value) => sum + value, 0) || 1;
  const normalizedMinutes = Object.fromEntries(members.map((member, index) => [member.player.id, minuteSupply[index] * 240 / totalMinutes]));
  const expectedUsage = (member: EcosystemCandidate) => { const profile = profiles.get(member.player.id)!; return (profile.expectedUsagePct ?? (12 + profile.usageRoleScore * 23)) / 100; };
  const loadBefore = members.reduce((sum, member) => sum + normalizedMinutes[member.player.id] / 48 * expectedUsage(member), 0);
  const usageAdjustmentByPlayerId = new Map<string, number>();
  const { targetLow, targetHigh, compressionCap, vacuumCap, qualifiedVacuumRoleScore } = ROLE_PROJECTION_CONFIG.usageBudget;
  if (loadBefore > targetHigh) {
    const excess = clamp((loadBefore - targetHigh) / Math.max(.1, loadBefore));
    for (const member of members) usageAdjustmentByPlayerId.set(member.player.id, -Math.min(compressionCap, excess * (1.2 - roleSecurity(member))));
  } else if (loadBefore < targetLow) {
    const shortage = clamp((targetLow - loadBefore) / Math.max(.1, targetLow));
    const qualified = members.filter((member) => { const role = profiles.get(member.player.id)!; return role.usageRoleScore >= qualifiedVacuumRoleScore || role.creationRoleScore >= qualifiedVacuumRoleScore || (member.metrics.newPlayerDetails?.draftCapitalContribution ?? 0) >= .65; });
    const denominator = qualified.reduce((sum, member) => sum + profiles.get(member.player.id)!.usageRoleScore * (.6 + roleSecurity(member) * .4), 0) || 1;
    for (const member of qualified) { const weight = profiles.get(member.player.id)!.usageRoleScore * (.6 + roleSecurity(member) * .4) / denominator; usageAdjustmentByPlayerId.set(member.player.id, Math.min(vacuumCap, shortage * weight * Math.max(1, qualified.length * .7))); }
  }
  const loadAfter = members.reduce((sum, member) => sum + normalizedMinutes[member.player.id] / 48 * expectedUsage(member) * (1 + (usageAdjustmentByPlayerId.get(member.player.id) ?? 0)), 0);
  const paceValues = members.flatMap((member) => profiles.get(member.player.id)?.pace === undefined ? [] : [{ pace: profiles.get(member.player.id)!.pace!, minutes: normalizedMinutes[member.player.id] }]);
  const projectedPace = paceValues.length ? paceValues.reduce((sum, item) => sum + item.pace * item.minutes, 0) / paceValues.reduce((sum, item) => sum + item.minutes, 0) : ROLE_PROJECTION_CONFIG.pace.leagueBaseline;
  return { loadBefore, loadAfter, usageAdjustmentByPlayerId, normalizedMinutes, projectedPace };
}

function aggregateSupply(members: readonly EcosystemCandidate[], profiles: ReadonlyMap<string, PlayerRoleProfile>): { supply: PlayerRoleProfile; shares: Record<string, number> } {
  const weightedMinutes = members.map((member) => member.metrics.projection.projectedMinutes * injurySupply(member.player));
  const total = weightedMinutes.reduce((sum, value) => sum + value, 0) || 1;
  const shares = Object.fromEntries(members.map((member, index) => [member.player.id, weightedMinutes[index] / total]));
  const supply = emptyProfile();
  members.forEach((member, index) => { const profile = profiles.get(member.player.id)!; for (const key of CHANNELS) supply[key] += profile[key] * weightedMinutes[index] / total; });
  return { supply, shares };
}

function applyContext(candidate: EcosystemCandidate, role: PlayerRoleProfile, competition: PlayerRoleProfile, priorCompetition: PlayerRoleProfile | undefined, baseline: PlayerRoleProfile, budget: TeamBudget, config: LeagueConfig): { metrics: ProjectionMetrics; summary: TeamContextSummary } {
  const security = roleSecurity(candidate), sensitivity = .45 + (1 - security) * .75;
  const comp = (key: Channel) => clamp((competition[key] - baseline[key]) / Math.max(.12, baseline[key]));
  const vacuum = (key: Channel) => clamp((baseline[key] - competition[key]) / Math.max(.12, baseline[key]));
  const scoringCompetition = comp("usageRoleScore"), creationCompetition = Math.max(comp("creationRoleScore"), comp("ballDominanceRoleScore") * .8), reboundingCompetition = comp("reboundingRoleScore"), rimProtectionCompetition = comp("rimProtectionRoleScore");
  const positionKeys = candidate.player.yahooPositions.map((position) => position === "G" ? "guardMinutesRoleScore" : position === "F" ? "forwardMinutesRoleScore" : "centerMinutesRoleScore") as Channel[];
  const positionalMinuteCompetition = positionKeys.length ? Math.max(...positionKeys.map(comp)) : 0;
  const opportunityVacuum = Math.max(vacuum("usageRoleScore") * role.usageRoleScore, vacuum("creationRoleScore") * role.creationRoleScore, vacuum("ballDominanceRoleScore") * role.ballDominanceRoleScore, vacuum("reboundingRoleScore") * role.reboundingRoleScore, ...positionKeys.map((key) => vacuum(key) * role[key]));
  const competitionSensitivity = POST_MOCK_CONFIG.teamContext.competitionSensitivity * sensitivity, vacuumSensitivity = POST_MOCK_CONFIG.teamContext.vacuumSensitivity * sensitivity;
  const usageBudgetDelta = budget.usageAdjustmentByPlayerId.get(candidate.player.id) ?? 0;
  const scoringDelta = -scoringCompetition * role.usageRoleScore * competitionSensitivity + vacuum("usageRoleScore") * role.usageRoleScore * vacuumSensitivity + usageBudgetDelta;
  const creationVacuum = Math.max(vacuum("creationRoleScore"), vacuum("ballDominanceRoleScore") * .8);
  const creationDelta = -creationCompetition * role.creationRoleScore * competitionSensitivity + creationVacuum * Math.max(role.creationRoleScore, role.ballDominanceRoleScore * .8) * vacuumSensitivity;
  const reboundDelta = -reboundingCompetition * role.reboundingRoleScore * competitionSensitivity + vacuum("reboundingRoleScore") * role.reboundingRoleScore * vacuumSensitivity;
  const blockDelta = -rimProtectionCompetition * role.rimProtectionRoleScore * competitionSensitivity + vacuum("rimProtectionRoleScore") * role.rimProtectionRoleScore * vacuumSensitivity;
  const minutesDelta = clampSigned((-positionalMinuteCompetition * competitionSensitivity + Math.max(0, ...positionKeys.map(vacuum)) * vacuumSensitivity) * .65, POST_MOCK_CONFIG.teamContext.maximumMinutesAdjustment);
  const paceAdjustment = clampSigned((budget.projectedPace / ROLE_PROJECTION_CONFIG.pace.leagueBaseline - 1) * .35, ROLE_PROJECTION_CONFIG.pace.maximumStatAdjustment);
  const resourceShock = priorCompetition ? calculateResourceShock(competition, priorCompetition) : { usage: 0, creation: 0, rebounding: 0 };
  const shockConfig = POST_MOCK_CONFIG.teamContext.resourceShock;
  const usageShock = resourceShock.usage * shockConfig.usageSensitivity * (.4 + role.usageRoleScore * .6);
  const creationShock = resourceShock.creation * shockConfig.creationSensitivity * (.4 + role.creationRoleScore * .6);
  const reboundShock = resourceShock.rebounding * shockConfig.reboundSensitivity * (.4 + role.reboundingRoleScore * .6);
  const base = candidate.metrics.projection;
  const adjusted: Projection = { ...base, projectedMinutes: base.projectedMinutes * (1 + minutesDelta), projectedPoints: base.projectedPoints * (1 + scoringDelta + minutesDelta * .25 + paceAdjustment - usageShock), projectedTurnovers: base.projectedTurnovers * (1 + usageBudgetDelta * .8 + minutesDelta * .25 + paceAdjustment - usageShock * .7), projectedAssists: base.projectedAssists * (1 + creationDelta + minutesDelta * .25 + paceAdjustment - creationShock), projectedOffensiveRebounds: base.projectedOffensiveRebounds * (1 + reboundDelta + minutesDelta * .3 + paceAdjustment - reboundShock), projectedDefensiveRebounds: base.projectedDefensiveRebounds * (1 + reboundDelta + minutesDelta * .3 + paceAdjustment - reboundShock), projectedSteals: base.projectedSteals * (1 + minutesDelta * .3 + paceAdjustment), projectedBlocks: base.projectedBlocks * (1 + blockDelta + minutesDelta * .3 + paceAdjustment) };
  Object.assign(adjusted, estimateProjectedBonusCounts(adjusted, adjusted.projectedGames));
  adjusted.projectedFantasyPointsPerGame = fantasyPointsPerGame(adjusted, config);
  const cap = contextCap(candidate), rawStatAdjustment = maxRelativeChange(base, adjusted, ["projectedMinutes", "projectedPoints", "projectedOffensiveRebounds", "projectedDefensiveRebounds", "projectedAssists", "projectedSteals", "projectedBlocks", "projectedTurnovers"]), interpolation = rawStatAdjustment === 0 ? 1 : Math.min(1, cap / rawStatAdjustment);
  for (const key of ["projectedPoints", "projectedOffensiveRebounds", "projectedDefensiveRebounds", "projectedAssists", "projectedSteals", "projectedBlocks", "projectedTurnovers"] as const) adjusted[key] = base[key] + (adjusted[key] - base[key]) * interpolation;
  adjusted.projectedMinutes = base.projectedMinutes + (adjusted.projectedMinutes - base.projectedMinutes) * interpolation;
  Object.assign(adjusted, estimateProjectedBonusCounts(adjusted, adjusted.projectedGames));
  const targetFp = fantasyPointsPerGame(adjusted, config); adjusted.projectedFantasyPointsPerGame = targetFp;
  const adjustmentPercent = base.projectedFantasyPointsPerGame ? targetFp / base.projectedFantasyPointsPerGame - 1 : 0;
  const maximumStatAdjustmentPercent = maxRelativeChange(base, adjusted, ["projectedMinutes", "projectedPoints", "projectedOffensiveRebounds", "projectedDefensiveRebounds", "projectedAssists", "projectedSteals", "projectedBlocks", "projectedTurnovers"]);
  const uncertainty = (1 - security) * Math.abs(adjustmentPercent) * .5, lowSpread = Math.max(0, base.projectedFantasyPointsPerGame - (base.projectedFantasyPointsPerGameLow ?? base.projectedFantasyPointsPerGame * .9)), highSpread = Math.max(0, (base.projectedFantasyPointsPerGameHigh ?? base.projectedFantasyPointsPerGame * 1.1) - base.projectedFantasyPointsPerGame);
  adjusted.projectedFantasyPointsPerGameLow = Math.max(0, targetFp - lowSpread * (1 + uncertainty)); adjusted.projectedFantasyPointsPerGameHigh = targetFp + highSpread * (1 + uncertainty * .5);
  const overallContext = cap ? clampSigned(adjustmentPercent / cap, 1) : 0;
  return { metrics: { ...candidate.metrics, projection: adjusted, opportunityScore: clamp100(candidate.metrics.opportunityScore + overallContext * 4) }, summary: { label: overallContext > .15 ? "Positive" : overallContext < -.15 ? "Crowded" : "Neutral", roleSecurity: security, scoringCompetition, creationCompetition, reboundingCompetition, rimProtectionCompetition, positionalMinuteCompetition, opportunityVacuum, overallContext, adjustmentPercent, minutesAdjustmentPercent: base.projectedMinutes ? adjusted.projectedMinutes / base.projectedMinutes - 1 : 0, baseFantasyPointsPerGame: base.projectedFantasyPointsPerGame, adjustedFantasyPointsPerGame: targetFp, explanations: contextExplanations(creationCompetition, positionalMinuteCompetition, opportunityVacuum, security, usageBudgetDelta, adjustmentPercent, resourceShock), roleProfile: role, teamUsageLoad: budget.loadBefore, teamUsageAdjustment: usageBudgetDelta, paceAdjustment, maximumStatAdjustmentPercent, resourceShock } };
}

export function calculateRoleSecurity({ player, metrics }: EcosystemCandidate): number { if (metrics.roleAssessment) return metrics.roleAssessment.currentRoleSecurity; const games = player.historicalStats.reduce((sum, season) => sum + season.gamesPlayed, 0), sorted = [...player.historicalStats].sort((a, b) => b.season.localeCompare(a.season)), stability = sorted.length > 1 ? 1 - Math.min(1, Math.abs(sorted[0].minutesPerGame - sorted[1].minutesPerGame) / 12) : .5, weights = ROLE_PROJECTION_CONFIG.roleSecurity, injuryFactor = player.injuryStatus === "Out" || player.injuryStatus === "Injured" ? .85 : 1; return clamp((metrics.modelConfidence * weights.confidence + Math.min(1, metrics.projection.projectedMinutes / 32) * weights.minutes + Math.min(1, games / 100) * weights.sample + stability * weights.stability) * injuryFactor); }
function roleSecurity(candidate: EcosystemCandidate): number { return calculateRoleSecurity(candidate); }
function contextCap(candidate: EcosystemCandidate): number { if (candidate.metrics.projectionSource === "Rookie/new-player model") return POST_MOCK_CONFIG.teamContext.newcomerCap; return roleSecurity(candidate) >= .75 ? POST_MOCK_CONFIG.teamContext.secureVeteranCap : POST_MOCK_CONFIG.teamContext.uncertainVeteranCap; }
function injurySupply(_player: Player): number { return 1; }
function calculateResourceShock(current: PlayerRoleProfile, prior: PlayerRoleProfile): { usage: number; creation: number; rebounding: number } { return { usage: clampSigned((current.usageRoleScore - prior.usageRoleScore) / Math.max(.15, prior.usageRoleScore)), creation: clampSigned((Math.max(current.creationRoleScore, current.ballDominanceRoleScore) - Math.max(prior.creationRoleScore, prior.ballDominanceRoleScore)) / Math.max(.15, Math.max(prior.creationRoleScore, prior.ballDominanceRoleScore))), rebounding: clampSigned((current.reboundingRoleScore - prior.reboundingRoleScore) / Math.max(.15, prior.reboundingRoleScore)) }; }
function contextExplanations(creation: number, positional: number, vacuum: number, security: number, usage: number, adjustment: number, shock: { usage: number; creation: number; rebounding: number }): string[] { const reasons: string[] = []; const material = POST_MOCK_CONFIG.teamContext.resourceShock.materialThreshold; if (shock.usage >= material) reasons.push("New high-usage teammates reduce projected scoring opportunity."); else if (shock.usage <= -material) reasons.push("Outgoing scoring usage offsets current-team pressure."); if (shock.creation >= material) reasons.push("Current creators reduce projected assist opportunity."); if (shock.rebounding >= material) reasons.push("Current frontcourt competition lowers rebound opportunity."); if (usage < -.005) reasons.push("Crowded team usage budget compresses scoring and turnover volume."); if (usage > .005) reasons.push("Qualified scorer receives a modest share of the team usage vacuum."); if (creation > .35) reasons.push("Multiple high-minute creators reduce assist upside slightly."); if (positional > .35) reasons.push("Same-position minutes are crowded."); if (vacuum > .3) reasons.push("A thin role environment creates modest opportunity."); if (security > .75 && Math.abs(adjustment) > .005) reasons.push("Established role limits teammate-context adjustment."); if (!reasons.length) reasons.push("Current team-role environment is neutral."); return reasons.slice(0, 2); }
function fantasyPointsPerGame(p: Projection, config: LeagueConfig): number { return calculateFantasyPoints({ points: p.projectedPoints, offensiveRebounds: p.projectedOffensiveRebounds, defensiveRebounds: p.projectedDefensiveRebounds, assists: p.projectedAssists, steals: p.projectedSteals, blocks: p.projectedBlocks, turnovers: p.projectedTurnovers, doubleDoubles: p.projectedDoubleDoubles / Math.max(1, p.projectedGames), tripleDoubles: p.projectedTripleDoubles / Math.max(1, p.projectedGames) }, config.scoring); }
function averageProfiles(values: PlayerRoleProfile[]): PlayerRoleProfile { const result = emptyProfile(); if (!values.length) return result; for (const value of values) for (const key of CHANNELS) result[key] += value[key] / values.length; return result; }
function emptyProfile(): PlayerRoleProfile { return { usageRoleScore: 0, creationRoleScore: 0, ballDominanceRoleScore: 0, reboundingRoleScore: 0, rimProtectionRoleScore: 0, guardMinutesRoleScore: 0, forwardMinutesRoleScore: 0, centerMinutesRoleScore: 0, source: "projection heuristic" }; }
function mapProfile(value: PlayerRoleProfile, mapper: (value: number, key: Channel) => number): PlayerRoleProfile { return { ...value, ...Object.fromEntries(CHANNELS.map((key) => [key, mapper(value[key], key)])) }; }
function averageDefined(values: Array<number | undefined>, fallback: number): number { const present = values.filter((value): value is number => value !== undefined); return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : fallback; }
function clamp(value: number): number { return Math.min(1, Math.max(0, value)); }
function clamp100(value: number): number { return Math.min(100, Math.max(0, value)); }
function clampSigned(value: number, cap = 1): number { return Math.min(cap, Math.max(-cap, value)); }
function maxRelativeChange(base: Projection, adjusted: Projection, keys: ReadonlyArray<keyof Projection>): number { return Math.max(0, ...keys.map((key) => { const before = base[key], after = adjusted[key]; return typeof before === "number" && typeof after === "number" && before !== 0 ? Math.abs(after / before - 1) : 0; })); }
