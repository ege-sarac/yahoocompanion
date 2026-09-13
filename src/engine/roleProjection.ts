import { ROLE_PROJECTION_CONFIG } from "../config/roleProjectionConfig";
import { DEFAULT_LEAGUE_CONFIG } from "../config/leagueConfig";
import type { LeagueConfig, Player, PlayerRoleHistoryRecord, Projection, ProjectionMetrics, RoleContextSummary } from "../types";
import { calculateFantasyPoints } from "./fantasyPoints";
import { analyzeLateSeasonRegime } from "./lateSeasonRegime";

export function applyRoleIntelligence(player: Player, metrics: ProjectionMetrics, record: PlayerRoleHistoryRecord | undefined, config: LeagueConfig = DEFAULT_LEAGUE_CONFIG): { metrics: ProjectionMetrics; summary?: RoleContextSummary } {
  if (!record || !record.seasons.length || (!record.regime && !record.latestSeasonGames.length)) return { metrics };
  const regime = record.regime ?? analyzeLateSeasonRegime(record, player.nbaTeam, config, player.injuryStatus, player.age);
  const latest = [...record.seasons].sort((a, b) => b.season.localeCompare(a.season))[0];
  const early = regime.windows.firstTwoThirds;
  const late = regime.type === "TRADE_ROLE_CHANGE" && regime.windows.currentTeamStint.games >= ROLE_PROJECTION_CONFIG.regime.minimumGames
    ? regime.windows.currentTeamStint
    : regime.type === "RETURN_FROM_INJURY_RAMP" && regime.windows.last10.games >= 5
      ? regime.windows.last10
      : regime.windows.finalThird;
  const usageChange = difference(late.usagePct, early.usagePct);
  const creationChange = difference(late.assistsPer36, early.assistsPer36);
  const reboundChange = difference(late.reboundsPer36, early.reboundsPer36);
  if (regime.regimeWeight <= 0) return { metrics, summary: { usagePctBaseline: latest.usagePct, usagePctRecent: late.usagePct, usageChange, creationRoleChange: creationChange, reboundRoleChange: reboundChange, lateSeasonRegime: regime.type, regimeConfidence: regime.regimeConfidence, lateSeasonPersistenceScore: regime.persistenceScore, absenceDependencyScore: regime.absenceDependencyScore, adjustmentPercent: 0, roleReasons: regime.reasons } };
  const base = metrics.projection;
  const minutesChange = relativeChange(late.minutesPerGame, regime.windows.fullSeason.minutesPerGame);
  const usageRate = clampSigned((usageChange ?? 0) / ROLE_PROJECTION_CONFIG.regime.usageChangeScale) * regime.regimeWeight;
  const creationRate = clampSigned((creationChange ?? 0) / ROLE_PROJECTION_CONFIG.regime.assistsPer36ChangeScale) * regime.regimeWeight;
  const reboundRate = clampSigned((reboundChange ?? 0) / ROLE_PROJECTION_CONFIG.regime.reboundsPer36ChangeScale) * regime.regimeWeight;
  const minutesRate = clampSigned(minutesChange ?? 0, .08) * regime.regimeWeight;
  const adjusted: Projection = { ...base,
    projectedMinutes: base.projectedMinutes * (1 + minutesRate),
    projectedPoints: base.projectedPoints * (1 + usageRate + minutesRate * .4),
    projectedTurnovers: base.projectedTurnovers * (1 + Math.max(-.5, usageRate * .75) + minutesRate * .3),
    projectedAssists: base.projectedAssists * (1 + creationRate + minutesRate * .35),
    projectedOffensiveRebounds: base.projectedOffensiveRebounds * (1 + reboundRate + minutesRate * .35),
    projectedDefensiveRebounds: base.projectedDefensiveRebounds * (1 + reboundRate + minutesRate * .35),
  };
  adjusted.projectedFantasyPointsPerGame = fantasy(adjusted, config);
  const basketballChange = maxRelativeChange(base, adjusted, ["projectedMinutes", "projectedPoints", "projectedTurnovers", "projectedAssists", "projectedOffensiveRebounds", "projectedDefensiveRebounds"]);
  const interpolation = basketballChange === 0 ? 1 : Math.min(1, ROLE_PROJECTION_CONFIG.totalRoleAdjustmentCap / basketballChange);
  for (const key of ["projectedPoints", "projectedTurnovers", "projectedAssists", "projectedOffensiveRebounds", "projectedDefensiveRebounds"] as const) adjusted[key] = base[key] + (adjusted[key] - base[key]) * interpolation;
  adjusted.projectedMinutes = base.projectedMinutes + (adjusted.projectedMinutes - base.projectedMinutes) * interpolation;
  adjusted.projectedFantasyPointsPerGame = fantasy(adjusted, config);
  const finalPercent = base.projectedFantasyPointsPerGame ? adjusted.projectedFantasyPointsPerGame / base.projectedFantasyPointsPerGame - 1 : 0;
  const uncertainty = regime.type === "ABSENCE_DEPENDENT_BOOST" || regime.type === "END_SEASON_VOLATILITY" ? .04 : regime.type === "TRADE_ROLE_CHANGE" && regime.regimeConfidence > .65 ? -.015 : .01 * regime.roleChangeScore;
  const lowSpread = Math.max(0, base.projectedFantasyPointsPerGame - (base.projectedFantasyPointsPerGameLow ?? base.projectedFantasyPointsPerGame * .9));
  const highSpread = Math.max(0, (base.projectedFantasyPointsPerGameHigh ?? base.projectedFantasyPointsPerGame * 1.1) - base.projectedFantasyPointsPerGame);
  adjusted.projectedFantasyPointsPerGameLow = Math.max(0, adjusted.projectedFantasyPointsPerGame - lowSpread * (1 + uncertainty));
  adjusted.projectedFantasyPointsPerGameHigh = adjusted.projectedFantasyPointsPerGame + highSpread * (1 + Math.max(0, uncertainty * .5));
  return { metrics: { ...metrics, projection: adjusted, modelConfidence: clamp01(metrics.modelConfidence - Math.max(0, uncertainty) * .4 + Math.max(0, -uncertainty) * .2) }, summary: { usagePctBaseline: latest.usagePct, usagePctRecent: late.usagePct, usageChange, creationRoleChange: creationChange, reboundRoleChange: reboundChange, lateSeasonRegime: regime.type, regimeConfidence: regime.regimeConfidence, lateSeasonPersistenceScore: regime.persistenceScore, absenceDependencyScore: regime.absenceDependencyScore, adjustmentPercent: finalPercent, roleReasons: regime.reasons } };
}

function fantasy(p: Projection, config: LeagueConfig): number { return calculateFantasyPoints({ points: p.projectedPoints, offensiveRebounds: p.projectedOffensiveRebounds, defensiveRebounds: p.projectedDefensiveRebounds, assists: p.projectedAssists, steals: p.projectedSteals, blocks: p.projectedBlocks, turnovers: p.projectedTurnovers, doubleDoubles: p.projectedDoubleDoubles / Math.max(1, p.projectedGames), tripleDoubles: p.projectedTripleDoubles / Math.max(1, p.projectedGames) }, config.scoring); }
function difference(a?: number, b?: number): number | undefined { return a === undefined || b === undefined ? undefined : a - b; }
function relativeChange(a?: number, b?: number): number | undefined { return a === undefined || b === undefined || b === 0 ? undefined : a / b - 1; }
function clampSigned(value: number, cap = 1): number { return Math.min(cap, Math.max(-cap, value)); }
function clamp01(value: number): number { return Math.min(1, Math.max(0, value)); }
function maxRelativeChange(base: Projection, adjusted: Projection, keys: ReadonlyArray<keyof Projection>): number { return Math.max(0, ...keys.map((key) => { const before = base[key], after = adjusted[key]; return typeof before === "number" && typeof after === "number" && before !== 0 ? Math.abs(after / before - 1) : 0; })); }
