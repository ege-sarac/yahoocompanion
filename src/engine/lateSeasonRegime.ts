import { ROLE_PROJECTION_CONFIG } from "../config/roleProjectionConfig";
import { DEFAULT_LEAGUE_CONFIG } from "../config/leagueConfig";
import type { InjuryStatus, LateSeasonRegime, LeagueConfig, PlayerRoleGame, PlayerRoleHistoryRecord, RoleWindowSummary, TeammateDependency } from "../types";
import { calculateFantasyPoints } from "./fantasyPoints";

export function analyzeLateSeasonRegime(
  record: PlayerRoleHistoryRecord,
  currentTeam: string | null,
  config: LeagueConfig = DEFAULT_LEAGUE_CONFIG,
  injuryStatus: InjuryStatus | null = null,
  age: number | null = null,
): LateSeasonRegime {
  const games = [...record.latestSeasonGames].sort((a, b) => a.teamGameNumber - b.teamGameNumber || a.gameDate.localeCompare(b.gameDate));
  const finalStart = ROLE_PROJECTION_CONFIG.regime.finalThirdStartsAtTeamGame;
  const currentTeamGames = currentTeam ? games.filter((game) => game.team === currentTeam) : games;
  const gameYears = games.map((game) => Number(game.gameDate.slice(0, 4))).filter(Number.isFinite);
  const seasonEndYear = gameYears.length ? Math.max(...gameYears) : new Date().getUTCFullYear();
  const postAllStarDate = `${seasonEndYear}-${ROLE_PROJECTION_CONFIG.regime.postAllStarMonthDay}`;
  const postTradeDeadlineDate = `${seasonEndYear}-${ROLE_PROJECTION_CONFIG.regime.postTradeDeadlineMonthDay}`;
  const windows = {
    fullSeason: summarize(games, config),
    firstTwoThirds: summarize(games.filter((game) => game.teamGameNumber < finalStart), config),
    finalThird: summarize(games.filter((game) => game.teamGameNumber >= finalStart), config),
    postAllStar: summarize(games.filter((game) => game.gameDate >= postAllStarDate), config),
    postTradeDeadline: summarize(games.filter((game) => game.gameDate >= postTradeDeadlineDate), config),
    last20: summarize(games.slice(-20), config),
    last10: summarize(games.slice(-10), config),
    last5: summarize(games.slice(-5), config),
    currentTeamStint: summarize(currentTeamGames, config),
  };
  const early = windows.firstTwoThirds.games >= 5 ? windows.firstTwoThirds : windows.fullSeason;
  const late = windows.finalThird;
  if (games.length < ROLE_PROJECTION_CONFIG.regime.minimumGames || late.games < 3) return emptyRegime(windows, "UNKNOWN_INSUFFICIENT_SAMPLE", ["Insufficient game-level sample for regime detection."]);
  const signals = [
    scaledChange(late.minutesPerGame, early.minutesPerGame, ROLE_PROJECTION_CONFIG.regime.minutesChangeScale),
    scaledChange(late.usagePct, early.usagePct, ROLE_PROJECTION_CONFIG.regime.usageChangeScale),
    scaledChange(late.fgaPer36, early.fgaPer36, ROLE_PROJECTION_CONFIG.regime.fgaPer36ChangeScale),
    scaledChange(late.assistsPer36, early.assistsPer36, ROLE_PROJECTION_CONFIG.regime.assistsPer36ChangeScale),
    scaledChange(late.reboundsPer36, early.reboundsPer36, ROLE_PROJECTION_CONFIG.regime.reboundsPer36ChangeScale),
  ].filter((value): value is number => value !== undefined);
  const signedChange = signals.length ? signals.reduce((sum, value) => sum + value, 0) / signals.length : 0;
  const direction = signedChange > .08 ? 1 : signedChange < -.08 ? -1 : 0;
  const roleChangeScore = clamp(Math.abs(signedChange));
  const agreeing = signals.filter((value) => Math.abs(value) >= .12 && Math.sign(value) === direction).length;
  const roleMetricAgreement = signals.length ? agreeing / signals.length : 0;
  const sampleConfidence = clamp(late.games / ROLE_PROJECTION_CONFIG.regime.fullConfidenceGames);
  const absenceDependencyScore = Math.max(0, ...(record.teammateDependencies ?? []).filter((item) => item.teammateStillOnCurrentTeam).map((item) => item.dependencyScore));
  const returnRampDetected = detectReturnRamp(games, injuryStatus);
  const efficiencyJump = definedDifference(late.trueShootingPct, early.trueShootingPct) ?? 0;
  const stableRole = roleChangeScore < .24;
  const finalWeekVolatility = late.games >= 8 && windows.last5.games >= 3 && (windows.last5.fantasyPointsPerMinute ?? 0) > (windows.last20.fantasyPointsPerMinute ?? 0) * 1.28 && stableRole;
  const teams = [...new Set(games.map((game) => game.team))];
  const currentTeamMatch = !currentTeam || currentTeamGames.length > 0;
  const tradeChange = teams.length > 1 && currentTeamMatch && windows.currentTeamStint.games >= ROLE_PROJECTION_CONFIG.regime.minimumGames;
  const dataCompleteness = record.seasons.slice().sort((a, b) => b.season.localeCompare(a.season))[0]?.dataCompleteness ?? 0;
  const persistenceScore = clamp(sampleConfidence * .4 + roleMetricAgreement * .25 + (currentTeamMatch ? .1 : 0) + roleChangeScore * .1 + dataCompleteness * .15 - absenceDependencyScore * .3 - (finalWeekVolatility ? .3 : 0));
  const regimeConfidence = clamp(sampleConfidence * .35 + roleMetricAgreement * .3 + (currentTeamMatch ? .15 : 0) + roleChangeScore * .1 + dataCompleteness * .1);
  let type: LateSeasonRegime["type"] = "NO_MEANINGFUL_CHANGE";
  if (returnRampDetected) type = "RETURN_FROM_INJURY_RAMP";
  else if (direction > 0 && absenceDependencyScore >= .5) type = "ABSENCE_DEPENDENT_BOOST";
  else if (tradeChange && roleChangeScore >= .25) type = "TRADE_ROLE_CHANGE";
  else if (stableRole && efficiencyJump >= ROLE_PROJECTION_CONFIG.regime.hotShootingThreshold) type = "EFFICIENCY_SPIKE_WITHOUT_ROLE_CHANGE";
  else if (finalWeekVolatility) type = "END_SEASON_VOLATILITY";
  else if (roleChangeScore >= ROLE_PROJECTION_CONFIG.regime.meaningfulRoleChangeScore && direction > 0) type = age !== null && age <= 23 ? "LATE_SEASON_DEVELOPMENT_ROLE" : "SUSTAINED_ROLE_GAIN";
  else if (roleChangeScore >= ROLE_PROJECTION_CONFIG.regime.meaningfulRoleChangeScore && direction < 0) type = "SUSTAINED_ROLE_LOSS";
  let regimeWeight = ROLE_PROJECTION_CONFIG.regime.maximumInfluence * regimeConfidence * persistenceScore;
  if (type === "NO_MEANINGFUL_CHANGE") regimeWeight = 0;
  if (type === "EFFICIENCY_SPIKE_WITHOUT_ROLE_CHANGE" || type === "END_SEASON_VOLATILITY") regimeWeight = Math.min(regimeWeight, ROLE_PROJECTION_CONFIG.regime.finalWeekInfluenceCap);
  if (type === "RETURN_FROM_INJURY_RAMP") regimeWeight *= .35;
  const reasons = regimeReasons(type, direction, absenceDependencyScore, currentTeamMatch);
  return { type, roleChangeScore, regimeConfidence, persistenceScore, direction, regimeWeight, absenceDependencyScore, returnRampDetected, finalWeekVolatility, currentTeamMatch, roleMetricAgreement, windows, reasons };
}

export function calculateTeammateDependencies(
  targetGames: readonly PlayerRoleGame[],
  competitors: ReadonlyArray<{ playerId: string; roleOverlap: number }>,
  participation: readonly { gameId: string; playerIds: string[] }[],
  currentTeamPlayerIds: ReadonlySet<string>,
): TeammateDependency[] {
  const participationByGame = new Map(participation.map((game) => [game.gameId, new Set(game.playerIds)]));
  return competitors.slice(0, ROLE_PROJECTION_CONFIG.absence.maximumCompetitors).flatMap((competitor) => {
    const withGames = targetGames.filter((game) => participationByGame.get(game.gameId)?.has(competitor.playerId));
    const withoutGames = targetGames.filter((game) => !participationByGame.get(game.gameId)?.has(competitor.playerId));
    if (!withGames.length || !withoutGames.length) return [];
    const withRole = roleProxy(withGames), withoutRole = roleProxy(withoutGames);
    const rawChange = clampSigned((withoutRole - withRole) / Math.max(.1, withRole));
    const sampleFactor = Math.min(1, withGames.length / ROLE_PROJECTION_CONFIG.absence.minimumGamesEachState) * Math.min(1, withoutGames.length / ROLE_PROJECTION_CONFIG.absence.minimumGamesEachState);
    const dependencyScore = clamp(Math.max(0, rawChange) * competitor.roleOverlap * (sampleFactor < 1 ? sampleFactor * ROLE_PROJECTION_CONFIG.absence.smallSampleShrinkage : 1));
    return [{ teammatePlayerId: competitor.playerId, gamesWith: withGames.length, gamesWithout: withoutGames.length, roleChangeWhenAbsent: rawChange, dependencyScore, teammateStillOnCurrentTeam: currentTeamPlayerIds.has(competitor.playerId) }];
  }).sort((a, b) => b.dependencyScore - a.dependencyScore);
}

function summarize(games: readonly PlayerRoleGame[], config: LeagueConfig): RoleWindowSummary {
  if (!games.length) return { games: 0 };
  const minutes = average(games.map((game) => game.minutes));
  const per36 = (selector: (game: PlayerRoleGame) => number) => games.reduce((sum, game) => sum + selector(game), 0) / Math.max(1, games.reduce((sum, game) => sum + game.minutes, 0)) * 36;
  const fantasy = games.reduce((sum, game) => sum + calculateFantasyPoints({ points: game.points, offensiveRebounds: game.offensiveRebounds, defensiveRebounds: game.defensiveRebounds, assists: game.assists, steals: game.steals, blocks: game.blocks, turnovers: game.turnovers, doubleDoubles: 0, tripleDoubles: 0 }, config.scoring), 0);
  const usages = games.flatMap((game) => game.usagePct === undefined ? [] : [game.usagePct]);
  const ts = games.flatMap((game) => game.trueShootingPct === undefined ? [] : [game.trueShootingPct]);
  return { games: games.length, minutesPerGame: minutes, usagePct: usages.length ? average(usages) : undefined, trueShootingPct: ts.length ? average(ts) : undefined, fgaPer36: per36((game) => game.fga), assistsPer36: per36((game) => game.assists), reboundsPer36: per36((game) => game.offensiveRebounds + game.defensiveRebounds), fantasyPointsPerMinute: fantasy / Math.max(1, games.reduce((sum, game) => sum + game.minutes, 0)) };
}

function detectReturnRamp(games: readonly PlayerRoleGame[], injuryStatus: InjuryStatus | null): boolean {
  for (let index = 1; index < games.length - 5; index++) {
    const gapDays = (Date.parse(games[index].gameDate) - Date.parse(games[index - 1].gameDate)) / 86_400_000;
    if (gapDays >= 21) {
      const first = average(games.slice(index, index + 3).map((game) => game.minutes));
      const later = average(games.slice(index + 3, index + 8).map((game) => game.minutes));
      if (later - first >= 5 && later >= 26) return true;
    }
  }
  return injuryStatus === "Returning soon" && games.length >= 5 && average(games.slice(-3).map((game) => game.minutes)) > average(games.slice(-6, -3).map((game) => game.minutes)) + 4;
}
function roleProxy(games: readonly PlayerRoleGame[]): number { const minutes = games.reduce((sum, game) => sum + game.minutes, 0); return games.reduce((sum, game) => sum + game.fga + game.fta * .44 + game.assists * 1.5 + game.turnovers, 0) / Math.max(1, minutes) * 36; }
function regimeReasons(type: LateSeasonRegime["type"], direction: number, dependency: number, teamMatch: boolean): string[] { const reasons: string[] = []; if (type === "EFFICIENCY_SPIKE_WITHOUT_ROLE_CHANGE") reasons.push("Late results improved without matching role growth; shooting spike regressed."); else if (type === "END_SEASON_VOLATILITY") reasons.push("Final-week production was volatile and receives little weight."); else if (type === "RETURN_FROM_INJURY_RAMP") reasons.push("Early return-game minutes are treated as a temporary ramp."); else if (type === "ABSENCE_DEPENDENT_BOOST") reasons.push("Late role growth was teammate-absence dependent and is partially regressed."); else if (type === "TRADE_ROLE_CHANGE") reasons.push("Current-team post-trade role receives additional relevance."); else if (direction > 0) reasons.push("Multiple role signals support a sustained late-season gain."); else if (direction < 0) reasons.push("Multiple role signals support a sustained late-season decline."); else reasons.push("No meaningful late-season role change detected."); if (!teamMatch) reasons.push("Offseason team change reduces direct regime persistence."); if (dependency > 0 && type !== "ABSENCE_DEPENDENT_BOOST") reasons.push("Teammate-absence dependency reduces persistence."); return reasons.slice(0, 3); }
function emptyRegime(windows: LateSeasonRegime["windows"], type: LateSeasonRegime["type"], reasons: string[]): LateSeasonRegime { return { type, roleChangeScore: 0, regimeConfidence: 0, persistenceScore: 0, direction: 0, regimeWeight: 0, absenceDependencyScore: 0, returnRampDetected: false, finalWeekVolatility: false, currentTeamMatch: false, roleMetricAgreement: 0, windows, reasons }; }
function scaledChange(a: number | undefined, b: number | undefined, scale: number): number | undefined { return a === undefined || b === undefined ? undefined : clampSigned((a - b) / scale); }
function definedDifference(a?: number, b?: number): number | undefined { return a === undefined || b === undefined ? undefined : a - b; }
function average(values: readonly number[]): number { return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length); }
function clamp(value: number): number { return Math.min(1, Math.max(0, value)); }
function clampSigned(value: number): number { return Math.min(1, Math.max(-1, value)); }
