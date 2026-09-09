import { DEFAULT_LEAGUE_CONFIG } from "../config/leagueConfig";
import type { ScoringSettings } from "../types";

export interface FantasyStatLine {
  points: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  doubleDoubles: number;
  tripleDoubles: number;
}

export function calculateFantasyPoints(statLine: FantasyStatLine, scoring: ScoringSettings = DEFAULT_LEAGUE_CONFIG.scoring): number {

  return (
    statLine.points * scoring.PTS + statLine.offensiveRebounds * scoring.OREB +
    statLine.defensiveRebounds * scoring.DREB + statLine.assists * scoring.AST +
    statLine.steals * scoring.STL + statLine.blocks * scoring.BLK +
    statLine.turnovers * scoring.TO + statLine.doubleDoubles * scoring.DD +
    statLine.tripleDoubles * scoring.TD
  );
}
