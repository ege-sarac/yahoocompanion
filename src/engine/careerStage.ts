import { DRAFT_VALUE_CONFIG } from "../config/draftValueConfig";
import { DEFAULT_LEAGUE_CONFIG } from "../config/leagueConfig";
import type { CareerStage, CareerStageProjection, LeagueConfig, Player, PlayerRoleHistoryRecord } from "../types";
import { calculateFantasyPoints } from "./fantasyPoints";

export function getCareerStage(age: number | null): CareerStage {
  const c = DRAFT_VALUE_CONFIG.career;
  if (age === null || age < c.latePrimeAge) return "PRIME";
  if (age < c.agingAge) return "LATE_PRIME";
  if (age < c.lateCareerAge) return "AGING";
  if (age < c.extremeLateCareerAge) return "LATE_CAREER";
  return "EXTREME_LATE_CAREER";
}

export function analyzeCareerStage(player: Player, roleRecord?: PlayerRoleHistoryRecord, config: LeagueConfig = DEFAULT_LEAGUE_CONFIG): CareerStageProjection {
  const seasons = [...player.historicalStats].sort((a, b) => b.season.localeCompare(a.season)).slice(0, 3);
  const latest = seasons[0], previous = seasons[1];
  const roleSeasons = [...(roleRecord?.seasons ?? [])].sort((a, b) => b.season.localeCompare(a.season));
  const latestRole = roleSeasons[0], previousRole = roleSeasons[1];
  const eligible = Boolean(latest && previous && latest.gamesPlayed >= DRAFT_VALUE_CONFIG.career.trend.minimumGames && previous.gamesPlayed >= DRAFT_VALUE_CONFIG.career.trend.minimumGames);
  const minuteDelta = eligible ? latest.minutesPerGame - previous.minutesPerGame : 0;
  const fpMinuteDelta = eligible ? fantasyPerMinute(latest, config) - fantasyPerMinute(previous, config) : 0;
  const usageDelta = latestRole?.usagePct !== undefined && previousRole?.usagePct !== undefined ? latestRole.usagePct - previousRole.usagePct : 0;
  const starterDelta = latestRole?.starterRate !== undefined && previousRole?.starterRate !== undefined ? latestRole.starterRate - previousRole.starterRate : 0;
  const currentTeamMinutes = roleRecord?.regime?.windows.currentTeamStint.minutesPerGame;
  const stintDecline = currentTeamMinutes !== undefined && previous ? currentTeamMinutes - previous.minutesPerGame : 0;
  const structuralEvidence = Number(minuteDelta <= DRAFT_VALUE_CONFIG.career.trend.minutesStructural)
    + Number(fpMinuteDelta <= DRAFT_VALUE_CONFIG.career.trend.fantasyPerMinuteStructural)
    + Number(usageDelta <= DRAFT_VALUE_CONFIG.career.trend.usageStructural)
    + Number(starterDelta <= DRAFT_VALUE_CONFIG.career.trend.starterRateStructural)
    + Number(stintDecline <= DRAFT_VALUE_CONFIG.career.trend.minutesStructural)
    + Number(roleRecord?.regime?.type === "SUSTAINED_ROLE_LOSS");
  const mildEvidence = Number(minuteDelta <= DRAFT_VALUE_CONFIG.career.trend.minutesMild)
    + Number(fpMinuteDelta <= DRAFT_VALUE_CONFIG.career.trend.fantasyPerMinuteMild)
    + Number(usageDelta <= DRAFT_VALUE_CONFIG.career.trend.usageMild)
    + Number(starterDelta <= DRAFT_VALUE_CONFIG.career.trend.starterRateMild)
    + Number(stintDecline <= DRAFT_VALUE_CONFIG.career.trend.minutesMild);
  const improvingEvidence = Number(minuteDelta >= 2) + Number(fpMinuteDelta >= .035) + Number(usageDelta >= 1.5);
  const careerStage = getCareerStage(player.age);
  const ageSupportsDecline = careerStage === "AGING" || careerStage === "LATE_CAREER" || careerStage === "EXTREME_LATE_CAREER";
  const careerTrend = structuralEvidence >= DRAFT_VALUE_CONFIG.career.trend.evidenceForStructural && ageSupportsDecline
    ? "STRUCTURAL_DECLINE" as const
    : mildEvidence >= 2 && ageSupportsDecline
      ? "MILD_DECLINE" as const
      : improvingEvidence >= 2
        ? "IMPROVING" as const
        : "STABLE" as const;
  const confidence = clamp((eligible ? .45 : .18) + Math.min(.35, seasons.length * .08) + Math.min(.2, Math.max(structuralEvidence, mildEvidence, improvingEvidence) * .06));
  const stageBase = careerStage === "EXTREME_LATE_CAREER" ? -.045 : careerStage === "LATE_CAREER" ? -.018 : 0;
  const trendAdjustment = careerTrend === "STRUCTURAL_DECLINE" ? -DRAFT_VALUE_CONFIG.career.trend.structuralMinutesPenalty : careerTrend === "MILD_DECLINE" ? -DRAFT_VALUE_CONFIG.career.trend.mildMinutesPenalty : careerTrend === "IMPROVING" ? DRAFT_VALUE_CONFIG.career.trend.improvingMinutesBonus : 0;
  const minutesAdjustment = Math.max(-DRAFT_VALUE_CONFIG.career.trend.maximumMinutesPenalty, stageBase + trendAdjustment * confidence);
  const reasons: string[] = [];
  if (careerTrend === "STRUCTURAL_DECLINE") reasons.push("Multi-season minutes, role, or per-minute evidence indicates structural decline.");
  else if (careerTrend === "MILD_DECLINE") reasons.push("Multiple recent indicators show a mild career decline.");
  if (careerStage === "LATE_CAREER" || careerStage === "EXTREME_LATE_CAREER") reasons.push("Late-career durability and minute uncertainty widen the downside.");
  return { careerStage, careerTrend, careerTrendConfidence: confidence, minutesAdjustment, durabilityAdjustment: durabilityAdjustment(careerStage, careerTrend, confidence), reasons };
}

function durabilityAdjustment(stage: CareerStage, trend: CareerStageProjection["careerTrend"], confidence: number): number {
  const base = stage === "EXTREME_LATE_CAREER" ? 7 : stage === "LATE_CAREER" ? 4 : stage === "AGING" ? 1.5 : 0;
  return base + (trend === "STRUCTURAL_DECLINE" ? 3 : trend === "MILD_DECLINE" ? 1 : 0) * confidence;
}
function fantasyPerMinute(stats: Player["historicalStats"][number], config: LeagueConfig): number { return stats.minutesPerGame <= 0 ? 0 : calculateFantasyPoints({ points: stats.points, offensiveRebounds: stats.offensiveRebounds, defensiveRebounds: stats.defensiveRebounds, assists: stats.assists, steals: stats.steals, blocks: stats.blocks, turnovers: stats.turnovers, doubleDoubles: 0, tripleDoubles: 0 }, config.scoring) / stats.minutesPerGame; }
function clamp(value: number): number { return Math.min(1, Math.max(0, value)); }
