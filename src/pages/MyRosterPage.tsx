import { DEFAULT_LEAGUE_CONFIG, getDraftedRosterSize } from "../config/leagueConfig";
import { useLeagueConfig } from "../context/LeagueConfigContext";
import type { LeagueConfig } from "../types";
import { RECOMMENDATION_CONFIG } from "../config/recommendationConfig";
import { useDraft } from "../context/DraftContext";
import {
  assignRosterSlots,
  deriveMyRoster,
  getDraftInfo,
  getRosterCoverage,
  projectPlayerForRecommendations,
} from "../engine";
import type { NewPlayerProjectionInput, Player, YahooPosition } from "../types";

interface MyRosterPageProps {
  players: Player[];
  newPlayerInputs: readonly NewPlayerProjectionInput[];
}

const POSITION_LABELS: Record<YahooPosition, string> = {
  G: "G eligible",
  F: "F eligible",
  C: "C eligible",
};

export function MyRosterPage({ players, newPlayerInputs }: MyRosterPageProps) {
  const { config: leagueConfig } = useLeagueConfig();
  const { state } = useDraft();
  const roster = deriveMyRoster(state, players);
  const coverage = getRosterCoverage(roster);
  const assignment = assignRosterSlots(roster, leagueConfig);
  const assignmentByPlayer = new Map(
    assignment.assignments.map((entry) => [entry.playerId, entry]),
  );
  const rosterMetrics = roster.map((player) => ({
    player,
    metrics: projectPlayerForRecommendations(
      player,
      newPlayerInputs.find((input) => input.playerId === player.id),
      undefined,
      leagueConfig,
    ),
  }));
  const totalProjectedFantasyPoints = rosterMetrics.reduce(
    (total, { metrics }) =>
      total + (metrics?.projection.projectedFantasyPointsPerGame ?? 0),
    0,
  );
  const currentRound =
    getDraftInfo(state.currentOverallPick, leagueConfig)?.round ?? leagueConfig.rounds;
  const warnings = getRosterWarnings(roster.length, coverage, currentRound, leagueConfig);

  return (
    <section className="page" aria-labelledby="roster-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Team {leagueConfig.userDraftSlot}</p>
          <h2 id="roster-heading">My Roster</h2>
          <p>Eligibility, projected output, risk, and deterministic slot fit.</p>
        </div>
        <span className="status-pill">
          {state.myPlayerIds.length} / {getDraftedRosterSize(leagueConfig)} filled
        </span>
      </div>

      <div className="coverage-grid" aria-label="Position coverage">
        {(["G", "F", "C"] as YahooPosition[]).map((position) => (
          <article className="coverage-card" key={position}>
            <span>{POSITION_LABELS[position]}</span>
            <strong>{coverage[position]}</strong>
          </article>
        ))}
        <article className="coverage-card total-card">
          <span>Total projected roster FP/G</span>
          <strong>{totalProjectedFantasyPoints.toFixed(1)}</strong>
        </article>
      </div>

      <div className={`roster-legality ${assignment.isLegal ? "legal" : "illegal"}`}>
        <strong>{assignment.isLegal ? "Roster fits legally" : "Roster fit warning"}</strong>
        <span>{assignment.explanation}</span>
      </div>

      {warnings.length > 0 && (
        <div className="roster-warnings">
          {warnings.map((warning) => <span key={warning}>{warning}</span>)}
        </div>
      )}

      <section className="panel roster-panel" aria-labelledby="players-heading">
        <div className="panel-heading">
          <div><p className="eyebrow">Drafted players</p><h3 id="players-heading">Roster list</h3></div>
        </div>

        {roster.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon" aria-hidden="true">{leagueConfig.userDraftSlot}</div>
            <h4>Your roster is empty</h4>
            <p>Players selected at Team {leagueConfig.userDraftSlot}'s picks will appear here.</p>
          </div>
        ) : (
          <div className="roster-list">
            {rosterMetrics.map(({ player, metrics }) => {
              const slot = assignmentByPlayer.get(player.id);
              return (
                <article className="roster-player detailed" key={player.id}>
                  <div className="roster-player-main">
                    <strong>{player.name}</strong>
                    <span>{player.nbaTeam ?? "NBA team unavailable"}</span>
                  </div>
                  <PlayerDetail label="Yahoo eligibility" value={player.yahooPositions.join(" / ") || "Missing"} />
                  <PlayerDetail label="Assigned slot" value={slot ? `${slot.slot}${slot.slotIndex}` : "Unassigned"} />
                  <PlayerDetail label="Projected FP/G" value={metrics ? metrics.projection.projectedFantasyPointsPerGame.toFixed(1) : "-"} />
                  <PlayerDetail label="Injury status" value={player.injuryStatus ?? "Unknown"} />
                  <PlayerDetail label="History risk" value={metrics ? `${Math.round(metrics.historicalAvailabilityRisk * 100)}%` : "-"} />
                  <PlayerDetail label="Current penalty" value={metrics ? `${Math.round(metrics.currentInjuryPenalty * 100)}%` : "-"} />
                </article>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}

function PlayerDetail({ label, value }: { label: string; value: string }) {
  return <div className="player-detail"><span>{label}</span><strong>{value}</strong></div>;
}

function getRosterWarnings(
  rosterSize: number,
  coverage: Record<YahooPosition, number>,
  currentRound: number,
  leagueConfig: LeagueConfig = DEFAULT_LEAGUE_CONFIG,
): string[] {
  const config = RECOMMENDATION_CONFIG.rosterFeedback;
  if (currentRound < config.minimumRoundForWarnings || rosterSize === 0) return [];

  const warnings: string[] = [];
  for (const position of ["G", "F", "C"] as YahooPosition[]) {
    const proportionalTarget =
      leagueConfig.roster[position] * (rosterSize / getDraftedRosterSize(leagueConfig));
    if (coverage[position] < proportionalTarget * config.coverageTolerance) {
      warnings.push(`Model sees relatively low ${position} coverage for this draft stage.`);
    }
  }
  if (rosterSize >= config.concentrationMinimumPlayers) {
    for (const position of ["G", "F", "C"] as YahooPosition[]) {
      if (coverage[position] / rosterSize >= config.concentrationThreshold) {
        warnings.push(`Roster is becoming concentrated in ${position}-eligible players.`);
      }
    }
  }
  return warnings;
}
