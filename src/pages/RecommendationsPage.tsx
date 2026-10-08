import { useMemo } from "react";

import { useLeagueConfig } from "../context/LeagueConfigContext";
import { useDraft } from "../context/DraftContext";
import { PositionIntentControls } from "../components/PositionIntentControls";
import { getAvailabilityRiskClass } from "../components/availabilityRisk";
import type { PlayerDataSource } from "../data/playerLoader";
import {
  deriveMyRoster,
  getDraftInfo,
  getPicksUntilMyNextPick,
  getRecommendationStage,
  rankPlayers,
  formatYahooAdp,
} from "../engine";
import type {
  NewPlayerProjectionInput,
  Player,
  RecommendationContributions,
  PlayerRoleDataSet,
  MarketDataSet,
  YahooDefaultProjectionDataSet,
} from "../types";

interface RecommendationsPageProps {
  players: Player[];
  dataSource: PlayerDataSource;
  newPlayerInputs: readonly NewPlayerProjectionInput[];
  roleData?: PlayerRoleDataSet;
  marketData?: MarketDataSet;
  yahooDefaultProjections?: YahooDefaultProjectionDataSet;
}

const CONTRIBUTION_LABELS: ReadonlyArray<{
  key: keyof RecommendationContributions;
  label: string;
}> = [
  { key: "projectedValue", label: "Season VORP value" },
  { key: "availability", label: "Availability reliability" },
  { key: "rosterFit", label: "Roster fit" },
  { key: "scarcity", label: "Scarcity" },
  { key: "opportunity", label: "Opportunity" },
  { key: "breakout", label: "Breakout" },
  { key: "flexibility", label: "Flexibility" },
  { key: "confidence", label: "Confidence adjustment" },
  { key: "survivalUrgency", label: "Survival urgency" },
  { key: "recentRun", label: "Recent run" },
  { key: "tierDropoff", label: "Tier drop-off" },
];

export function RecommendationsPage({
  players,
  dataSource,
  newPlayerInputs,
  roleData,
  marketData,
  yahooDefaultProjections,
}: RecommendationsPageProps) {
  const { config } = useLeagueConfig();
  const { state, markUnavailable } = useDraft();
  const currentDraftInfo = getDraftInfo(state.currentOverallPick, config);
  const currentRound =
    currentDraftInfo?.round ?? config.rounds;
  const picksUntilMine = getPicksUntilMyNextPick(state.currentOverallPick, config);
  const myRoster = useMemo(
    () => deriveMyRoster(state, players),
    [players, state],
  );
  const result = useMemo(
    () =>
      rankPlayers({
        players: dataSource === "processed" ? players : [],
        draftedPlayerIds: state.draftedPlayerIds,
        myRoster,
        currentRound,
        currentOverallPick: state.currentOverallPick,
        draftPicks: state.picks,
        leagueConfig: config,
        newPlayerInputs,
        manualUnavailablePlayerIds: state.manualUnavailablePlayerIds,
        positionIntent: state.positionIntent,
        teamEcosystemEnabled: state.teamEcosystemEnabled,
        roleData,
        teamDiversificationMode: state.teamDiversificationMode,
        preferredMaxSameTeam: state.preferredMaxSameTeam,
        marketData,
        yahooDefaultProjections,
        decisionLog: state.decisionLog,
      }),
    [config, currentRound, dataSource, marketData, myRoster, newPlayerInputs, players, roleData, state.currentOverallPick, state.decisionLog, state.draftedPlayerIds, state.manualUnavailablePlayerIds, state.picks, state.positionIntent, state.preferredMaxSameTeam, state.teamDiversificationMode, state.teamEcosystemEnabled, yahooDefaultProjections],
  );
  const topRecommendations = result.topRecommendations;
  const stage = getRecommendationStage(currentRound, config);

  return (
    <section className="page" aria-labelledby="recommendations-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Decision support</p>
          <h2 id="recommendations-heading">Recommendations</h2>
          <p>
            Deterministic estimates for the current undrafted player pool.
          </p>
        </div>
        <div className="recommendation-context" aria-label="Draft context">
          <span>Round {currentRound}</span>
          <span>
            {picksUntilMine === null
              ? "Draft complete"
              : `${picksUntilMine} picks until mine`}
          </span>
          <span>{stage} weights</span>
        </div>
      </div>

      {dataSource !== "processed" && (
        <div className="model-warning" role="status">
          Recommendations require the real processed dataset. Generate
          <code> data/processed/players.json</code>; fake players are used only in
          controlled unit tests.
        </div>
      )}
      {dataSource === "processed" && result.missingEligibilityCount > 0 && (
        <div className="model-warning" role="status">
          Yahoo eligibility is missing for {result.missingEligibilityCount} available
          players. Their roster fit, scarcity, and flexibility inputs remain neutral;
          no positions were inferred.
        </div>
      )}
      {result.newPlayerModelCount > 0 && (
        <div className="model-note">
          {result.newPlayerModelCount} available players use the lower-confidence
          rookie/new-player pathway instead of fabricated NBA history.
        </div>
      )}

      <section className="panel recommendations-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Live top 5</p>
            <h3>Model-ranked players</h3>
          </div>
          <span className="status-pill">
            {result.recommendations.length} projectable
          </span>
        </div>
        <PositionIntentControls urgency={result.positionNeedUrgency} filterWarning={result.filterExcludesAllFeasible} />
        <p className="feasibility-summary">Feasibility slack: <strong>{result.rosterFeasibility.feasibilitySlack}</strong> · Restrictive picks required: <strong>{result.rosterFeasibility.minimumPicksNeededForRestrictiveSlots}</strong></p>
        {result.positionFilterHadNoMatches && <div className="model-warning">No available players match the current {state.positionIntent.positions.join("/")} filter. Clear the filter to show all players.</div>}
        {result.positionFilterActive && result.teamDiversificationFilteredCount > 0 && <div className="model-warning">The active position filter includes {result.teamDiversificationFilteredCount} candidate(s) above the Strict team-diversification cap. They remain manually draftable; switch diversification mode or raise the cap to restore them to Top 5 consideration.</div>}

        {topRecommendations.length === 0 ? (
          <div className="empty-state">
            <h4>No real-data recommendations available</h4>
            <p>Load processed NBA data or check whether the draft is complete.</p>
          </div>
        ) : (
          <div className="recommendations-table-wrap">
            <table className="recommendations-table">
              <thead>
                <tr>
                  <th>Rank / Player</th>
                  <th>Eligibility</th>
                  <th>FP/G</th>
                  <th>Expected games</th>
                  <th>Season value</th>
                  <th>Market cost</th>
                  <th>Yahoo ADP</th>
                  <th>MPG</th>
                  <th>History risk</th>
                  <th>Injury status</th>
                  <th>Expected return</th>
                  <th>Current penalty</th>
                  <th>Opportunity</th>
                  <th>Breakout</th>
                  <th>Roster fit</th>
                  <th>Scarcity</th>
                  <th>Confidence</th>
                  <th>Survival estimate</th>
                  <th>Final</th>
                </tr>
              </thead>
              <tbody>
                {topRecommendations.map((recommendation, index) => (
                  <tr key={recommendation.player.id}>
                    <td className="recommendation-player-cell">
                      <div className="recommendation-player-heading">
                        <span className={`rank-badge ${index < 3 ? "top" : ""}`}>
                          {index + 1}
                        </span>
                        <div>
                          <strong>{recommendation.player.name}</strong>
                          <small>
                            {recommendation.player.nbaTeam ?? "Team unavailable"}
                          </small>
                          {recommendation.newPlayerDetails && (
                            <>
                              <span className="projection-model-badge">
                                {newPlayerBadge(recommendation.newPlayerDetails.classification)}
                              </span>
                              <small>
                                {recommendation.newPlayerDetails.classification}
                                {recommendation.newPlayerInput?.nbaDraftPick
                                  ? ` · Draft pick #${recommendation.newPlayerInput.nbaDraftPick}`
                                  : ""}
                                {recommendation.newPlayerDetails.previousLeague !== "Unknown"
                                  ? ` · ${recommendation.newPlayerDetails.previousLeague}`
                                  : ""}
                              </small>
                            </>
                          )}
                        </div>
                      </div>
                      {index < 3 && recommendation.explanations.length > 0 && (
                        <ul className="recommendation-reasons">
                          {recommendation.explanations.map((explanation) => (
                            <li key={explanation}>{explanation}</li>
                          ))}
                        </ul>
                      )}
                      <details className="score-details">
                        <summary>Score details</summary>
                        <div className="contribution-grid">
                          <div>
                            <span>Projection source</span>
                            <strong>{recommendation.projectionSource}</strong>
                          </div>
                          {recommendation.newPlayerDetails && (
                            <>
                              <div><span>Classification</span><strong>{recommendation.newPlayerDetails.classification}</strong></div>
                              <div><span>Expected MPG source</span><strong>{recommendation.newPlayerDetails.expectedMinutesSource}</strong></div>
                              <div><span>Draft-capital signal</span><strong>{recommendation.newPlayerDetails.draftCapitalContribution.toFixed(2)}</strong></div>
                              <div><span>Previous-league translation</span><strong>{recommendation.newPlayerDetails.previousLeague} × {recommendation.newPlayerDetails.previousLeagueTranslationFactor.toFixed(2)}</strong></div>
                              <div><span>Sample-size adjustment</span><strong>{formatPercent(recommendation.newPlayerDetails.sampleSizeAdjustment)}</strong></div>
                              <div><span>Confidence adjustment</span><strong>{recommendation.newPlayerDetails.confidenceAdjustment.toFixed(2)}</strong></div>
                            </>
                          )}
                          {CONTRIBUTION_LABELS.map(({ key, label }) => (
                            <div key={key}>
                              <span>{label}</span>
                              <strong>
                                {recommendation.contributions[key].toFixed(2)}
                              </strong>
                              <small>
                                component {recommendation.components[key].toFixed(1)}
                              </small>
                            </div>
                          ))}
                        </div>
                      </details>
                      {recommendation.teamContextSummary && state.showTeamContextDetails && <small className="team-context-inline">Team context: {recommendation.teamContextSummary.label} ({recommendation.teamContextSummary.adjustmentPercent >= 0 ? "+" : ""}{formatPercent(recommendation.teamContextSummary.adjustmentPercent)})</small>}
                      {recommendation.roleContextSummary?.usagePctBaseline !== undefined && <small className="team-context-inline">Role: {recommendation.roleContextSummary.usagePctBaseline.toFixed(1)}% USG · {recommendation.roleContextSummary.lateSeasonRegime?.replaceAll("_", " ")} · {Math.round((recommendation.roleContextSummary.regimeConfidence ?? 0) * 100)}% confidence</small>}
                      {recommendation.expectedGamesProjection.majorInjuryComeback && <small className="team-context-inline">Major-injury comeback · high projection uncertainty</small>}
                      {recommendation.teamConcentrationWarning && <small className="team-context-inline">{recommendation.teamConcentrationWarning} ({recommendation.teamDiversificationComponent.toFixed(1)})</small>}
                      <button className="compact-button" onClick={() => markUnavailable(recommendation.player.id)} type="button">Mark unavailable</button>
                    </td>
                    <td>
                      {recommendation.player.yahooPositions.join(" / ") || (
                        <span className="missing-value">Missing</span>
                      )}
                      <small className="return-confidence-inline">{recommendation.player.positionSource ?? "unknown"}</small>
                    </td>
                    <td>
                      {recommendation.projection.projectedFantasyPointsPerGame.toFixed(
                        1,
                      )}
                      <small className="return-confidence-inline">{formatRange(recommendation.projection.projectedFantasyPointsPerGameLow, recommendation.projection.projectedFantasyPointsPerGameHigh)}</small>
                    </td>
                    <td><span className={getAvailabilityRiskClass(recommendation.expectedGamesProjection.availabilityRiskLabel)}>{recommendation.expectedGamesProjection.expectedGames.toFixed(1)}</span><small className={`return-confidence-inline ${getAvailabilityRiskClass(recommendation.expectedGamesProjection.availabilityRiskLabel)}`}>{recommendation.expectedGamesProjection.expectedGamesLow.toFixed(0)}-{recommendation.expectedGamesProjection.expectedGamesHigh.toFixed(0)} · {recommendation.expectedGamesProjection.availabilityRiskLabel}</small></td>
                    <td>{recommendation.seasonValue.availabilityAdjustedFantasyPointsEquivalent.toFixed(1)}<small className="return-confidence-inline">VORP {recommendation.seasonValue.seasonVorp.toFixed(0)} · replacement {recommendation.seasonValue.replacementFantasyPointsPerGame.toFixed(1)}</small></td>
                    <td>{recommendation.marketTiming.marketPickEstimate === null ? "-" : `~${recommendation.marketTiming.marketPickEstimate}`}<small className="return-confidence-inline">{recommendation.marketTiming.marketPickEstimate === null ? recommendation.marketTiming.marketEvidenceLabel : `${recommendation.marketTiming.valueLabel} · ${recommendation.marketTiming.marketEvidenceLevel}`}</small></td>
                    <td><b>{formatYahooAdp(recommendation.marketTiming.yahooAdp, config.teamCount)}</b></td>
                    <td>{recommendation.projection.projectedMinutes.toFixed(1)}<small className="return-confidence-inline">{formatRange(recommendation.projection.projectedMinutesLow, recommendation.projection.projectedMinutesHigh)}</small></td>
                    <td>
                      {formatPercent(recommendation.historicalAvailabilityRisk)}
                    </td>
                    <td>{recommendation.player.injuryStatus ?? "Unknown"}</td>
                    <td>
                      {recommendation.player.expectedReturnDate ??
                        recommendation.player.expectedReturnText ??
                        "-"}
                      {(recommendation.player.expectedReturnDate ||
                        recommendation.player.expectedReturnText) && (
                        <small className="return-confidence-inline">
                          {recommendation.player.returnConfidence ?? "unknown"} confidence
                        </small>
                      )}
                    </td>
                    <td>{formatPercent(recommendation.currentInjuryPenalty)}</td>
                    <td>{recommendation.opportunityScore.toFixed(1)}</td>
                    <td>{recommendation.breakoutScore.toFixed(1)}</td>
                    <td>{recommendation.rosterFitScore.toFixed(1)}</td>
                    <td>{recommendation.scarcityScore.toFixed(1)}</td>
                    <td>{formatPercent(recommendation.roleAssessment.skillConfidence)}<small className="return-confidence-inline">role {formatPercent(recommendation.roleAssessment.currentRoleSecurity)} · {recommendation.careerStageProjection.careerTrend.replaceAll("_", " ")}</small></td>
                    <td>{Math.round(recommendation.survivalEstimate)} / 100<small className="return-confidence-inline">{recommendation.survivalLabel}{recommendation.recentRunLabel !== "No run" ? ` · ${recommendation.recentRunLabel}` : ""}</small></td>
                    <td className="final-score">
                      {recommendation.finalScore.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatRange(low?: number, high?: number): string {
  return low === undefined || high === undefined ? "range unavailable" : `${low.toFixed(1)}–${high.toFixed(1)}`;
}

function newPlayerBadge(classification: string): string {
  if (classification === "Rookie") return "ROOKIE MODEL";
  if (classification === "Returning NBA veteran") {
    return "RETURNING VETERAN MODEL";
  }
  return "NEW PLAYER MODEL";
}
