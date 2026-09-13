import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useMemo,
  useRef,
  useState,
} from "react";

import { getTotalDraftPicks } from "../config/leagueConfig";
import { useLeagueConfig } from "../context/LeagueConfigContext";
import { useDraft } from "../context/DraftContext";
import { PositionIntentControls } from "../components/PositionIntentControls";
import { DraftRepair } from "../components/DraftRepair";
import type { PlayerDataSource } from "../data/playerLoader";
import {
  deriveMyRoster,
  getDraftInfo,
  getNextMyPick,
  getPicksUntilMyNextPick,
  matchesPlayerName,
  rankPlayers,
  createDecisionSnapshot,
} from "../engine";
import type { MarketDataSet, NewPlayerProjectionInput, Player, PlayerRoleDataSet } from "../types";

interface DraftPageProps {
  players: Player[];
  dataSource: PlayerDataSource;
  newPlayerInputs: readonly NewPlayerProjectionInput[];
  roleData?: PlayerRoleDataSet;
  marketData?: MarketDataSet;
}

export function DraftPage({ players, dataSource, newPlayerInputs, roleData, marketData }: DraftPageProps) {
  const { config } = useLeagueConfig();
  const {
    state,
    draftPlayer,
    undoLastPick,
    resetDraft,
    exportDraft,
    importDraft,
    markUnavailable,
  } = useDraft();
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const playerById = useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players],
  );
  const availablePlayers = useMemo(() => {
    if (!query.trim()) return [];
    const drafted = new Set([...state.draftedPlayerIds, ...state.manualUnavailablePlayerIds]);
    return players
      .filter(
        (player) =>
          !drafted.has(player.id) && matchesPlayerName(player.name, query),
      )
      .slice(0, 12);
  }, [players, query, state.draftedPlayerIds, state.manualUnavailablePlayerIds]);
  const currentInfo = getDraftInfo(state.currentOverallPick, config);
  const currentRound = currentInfo?.round ?? config.rounds;
  const nextMyPick = getNextMyPick(state.currentOverallPick, config);
  const picksUntilMine = getPicksUntilMyNextPick(state.currentOverallPick, config);
  const recentPicks = state.picks.slice(-10).reverse();
  const myRoster = useMemo(
    () => deriveMyRoster(state, players),
    [players, state],
  );
  const draftRecommendationResult = useMemo(() => {
    if (dataSource !== "processed") return null;
    return rankPlayers({
      players,
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
    });
  }, [config, currentRound, dataSource, marketData, myRoster, newPlayerInputs, players, roleData, state.currentOverallPick, state.draftedPlayerIds, state.manualUnavailablePlayerIds, state.picks, state.positionIntent, state.preferredMaxSameTeam, state.teamDiversificationMode, state.teamEcosystemEnabled]);
  const topDraftRecommendations = draftRecommendationResult?.topRecommendations ?? [];

  function selectPlayer(player: Player) {
    try {
      const completionRisk = currentInfo?.isMyTeam && draftRecommendationResult?.recommendations.find((entry) => entry.player.id === player.id)?.candidateFeasibility.candidateKeepsRosterFeasible === false;
      const decisionSnapshot = currentInfo?.isMyTeam && draftRecommendationResult && state.decisionLoggingEnabled
        ? createDecisionSnapshot(state.currentOverallPick, state.myPlayerIds, state.positionIntent, draftRecommendationResult.topRecommendations)
        : undefined;
      draftPlayer(player.id, decisionSnapshot);
      setQuery("");
      setHighlightedIndex(0);
      setMessage(completionRisk ? "Pick recorded. Warning: this selection creates roster completion risk under the configured eligibility." : null);
      searchInputRef.current?.focus();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to draft player.",
      );
    }
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const player =
      availablePlayers[highlightedIndex] ?? availablePlayers[0];
    if (player) selectPlayer(player);
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && availablePlayers.length > 0) {
      event.preventDefault();
      setHighlightedIndex((index) =>
        Math.min(index + 1, availablePlayers.length - 1),
      );
    } else if (event.key === "ArrowUp" && availablePlayers.length > 0) {
      event.preventDefault();
      setHighlightedIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Escape") {
      event.preventDefault();
      setQuery("");
      setHighlightedIndex(0);
    }
  }

  function handleReset() {
    if (
      window.confirm(
        "Reset the entire draft? This removes every recorded pick and cannot be undone.",
      )
    ) {
      resetDraft();
      setQuery("");
      setMessage("Draft reset.");
      searchInputRef.current?.focus();
    }
  }

  function downloadDraft() {
    const blob = new Blob([exportDraft()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `yahoo-companion-draft-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setMessage("Draft exported.");
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      importDraft(JSON.parse(await file.text()) as unknown);
      setQuery("");
      setMessage(`Imported ${file.name}.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Import failed: ${error.message}`
          : "Import failed.",
      );
    } finally {
      event.target.value = "";
      searchInputRef.current?.focus();
    }
  }

  return (
    <section className="page" aria-labelledby="draft-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Draft board</p>
          <h2 id="draft-heading">Draft</h2>
          <p>Search, select, and move immediately to the next pick.</p>
        </div>
        <span className={`data-badge ${dataSource}`}>
          {dataSource === "processed" ? "NBA data" : "Data unavailable"}
        </span>
      </div>

      {currentInfo?.isMyTeam && (
        <div className="my-pick-banner" role="status">
          <span>MY PICK</span>
          Team {config.userDraftSlot} is on the clock
        </div>
      )}

      <div className="draft-stat-grid">
        <DraftStat accent label="Current pick" value={currentInfo ? `#${currentInfo.overallPick}` : "Complete"} />
        <DraftStat label="Round" value={currentInfo ? `${currentInfo.round} / ${config.rounds}` : `${config.rounds} / ${config.rounds}`} />
        <DraftStat label="Pick in round" value={currentInfo ? `#${currentInfo.pickInRound}` : "-"} />
        <DraftStat label="Drafting team" value={currentInfo ? `Team ${currentInfo.teamNumber}` : "-"} />
        <DraftStat label="Next user pick" value={nextMyPick ? `#${nextMyPick}` : "Complete"} />
        <DraftStat label="Picks until mine" value={picksUntilMine === null ? "-" : String(picksUntilMine)} />
      </div>

      <section className="live-draft-strategy" aria-labelledby="live-strategy-heading">
        <h3 className="visually-hidden" id="live-strategy-heading">Live draft position strategy</h3>
        <PositionIntentControls compact urgency={draftRecommendationResult?.positionNeedUrgency} feasibility={draftRecommendationResult?.rosterFeasibility} filterWarning={draftRecommendationResult?.filterExcludesAllFeasible} />
        {draftRecommendationResult?.positionFilterHadNoMatches && <div className="model-warning">No available players match the current {state.positionIntent.positions.join("/")} filter. Use Clear to restore all positions.</div>}
      </section>

      {draftRecommendationResult && (
        <section className="on-clock-recommendations" aria-labelledby="on-clock-heading">
          <div className="on-clock-heading">
            <div>
              <p className="eyebrow">{currentInfo?.isMyTeam ? "On the clock" : "Planning ahead"}</p>
              <h3 id="on-clock-heading">Live Top 5</h3>
            </div>
            <a href="#/recommendations">View full ranking</a>
          </div>
          {topDraftRecommendations.length === 0 ? <div className="compact-empty-state"><p>No recommendation matches the current filter.</p></div> : <div className="on-clock-grid">
            {topDraftRecommendations.map((recommendation, index) => (
              <article key={recommendation.player.id}>
                <span className="on-clock-rank">#{index + 1}</span>
                <strong>{recommendation.player.name}</strong>
                <small>
                  {recommendation.player.yahooPositions.join(" / ") || "Eligibility missing"}
                  {" | "}{recommendation.projection.projectedFantasyPointsPerGame.toFixed(1)} FP/G
                </small>
                <small>Expected games {recommendation.expectedGamesProjection.expectedGames.toFixed(0)} · {recommendation.expectedGamesProjection.availabilityRiskLabel} · Season value {recommendation.seasonValue.availabilityAdjustedFantasyPointsEquivalent.toFixed(1)}</small>
                <small>{recommendation.marketTiming.marketRoundLow === null ? "Market unavailable" : `Market R${recommendation.marketTiming.marketRoundLow.toFixed(1)}-${recommendation.marketTiming.marketRoundHigh!.toFixed(1)}`} · {recommendation.survivalLabel}</small>
                <p className="on-clock-reasons">{(recommendation.explanations.length ? recommendation.explanations : ["Model favors the projected value at this pick."]).slice(0, 2).map((reason) => <span key={reason}>{reason}</span>)}</p>
                {recommendation.teamConcentrationWarning && <small className="team-context-inline">{recommendation.teamConcentrationWarning}</small>}
                {recommendation.expectedGamesProjection.majorInjuryComeback && <span className="injury-chip">Major-injury comeback · high uncertainty</span>}
                {recommendation.player.injuryStatus !== "Healthy" && (
                  <span className="injury-chip">
                    {recommendation.player.injuryStatus ?? "Unknown injury status"}
                  </span>
                )}
                <div className="on-clock-card-footer">
                  <span>Draft Score {recommendation.finalScore.toFixed(1)}</span>
                  <button onClick={() => selectPlayer(recommendation.player)} type="button">
                    Draft this player
                  </button>
                  <button onClick={() => markUnavailable(recommendation.player.id)} type="button">Mark unavailable</button>
                </div>
              </article>
            ))}
          </div>}
        </section>
      )}

      <div className="draft-workspace">
        <section className="panel search-panel" aria-labelledby="player-search-heading">
          <div className="panel-heading">
            <div><p className="eyebrow">Fast input</p><h3 id="player-search-heading">Select a player</h3></div>
            <span className="status-pill">{state.picks.length} / {getTotalDraftPicks(config)}</span>
          </div>
          <form className="player-search" onSubmit={handleSearchSubmit}>
            <label htmlFor="player-search">Player name</label>
            <input
              autoComplete="off"
              autoFocus
              disabled={!currentInfo}
              id="player-search"
              onChange={(event) => { setQuery(event.target.value); setHighlightedIndex(0); }}
              onKeyDown={handleSearchKeyDown}
              placeholder={currentInfo ? "Start typing a player name..." : "Draft complete"}
              ref={searchInputRef}
              type="search"
              value={query}
            />
            <p className="input-hint">Use arrow keys and Enter to draft. Escape clears.</p>
          </form>

          {query.trim() && (
            <div className="search-results" role="listbox" aria-label="Matching players">
              {availablePlayers.length > 0 ? availablePlayers.map((player, index) => (
                <div
                  aria-selected={highlightedIndex === index}
                  className={`player-result ${highlightedIndex === index ? "highlighted" : ""}`}
                  key={player.id}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  role="option"
                >
                  <span><strong>{player.name}</strong><small>{player.nbaTeam ?? "No team"} | {player.yahooPositions.join(" / ") || "Positions pending"}</small></span>
                  <span className="result-actions"><button onClick={() => selectPlayer(player)} type="button">Draft</button><button onClick={() => { markUnavailable(player.id); setMessage(`${player.name} marked unavailable.`); }} type="button">Unavailable</button></span>
                </div>
              )) : <p className="no-results">No available players match "{query}".</p>}
            </div>
          )}

          {message && <p className="draft-message" role="status">{message}</p>}
          <div className="draft-actions">
            <button disabled={state.picks.length === 0} onClick={undoLastPick} type="button">Undo Last Pick</button>
            <button className="danger-button" disabled={state.picks.length === 0} onClick={handleReset} type="button">Reset Draft</button>
            <button onClick={downloadDraft} type="button">Export Draft</button>
            <button onClick={() => importInputRef.current?.click()} type="button">Import Draft</button>
            <input accept="application/json,.json" className="visually-hidden" onChange={handleImport} ref={importInputRef} type="file" />
          </div>
        </section>

        <section className="panel history-panel" aria-labelledby="history-heading">
          <div className="panel-heading"><div><p className="eyebrow">Last 10</p><h3 id="history-heading">Recently Drafted</h3></div></div>
          {recentPicks.length === 0 ? <div className="compact-empty-state"><p>No picks recorded yet.</p></div> : (
            <ol className="pick-history">
              {recentPicks.map((pick) => (
                <li className={pick.isMyTeam ? "my-team-pick" : undefined} key={pick.overallPick}>
                  <span className="pick-number">#{pick.overallPick}</span>
                  <span className="pick-player"><strong>{playerById.get(pick.playerId)?.name ?? `Unknown player (${pick.playerId})`}</strong><small>Team {pick.teamNumber}</small></span>
                  {pick.isMyTeam && <span className="mine-label">MY TEAM</span>}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
      <DraftRepair players={players} />
    </section>
  );
}

function DraftStat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return <article className={`stat-card ${accent ? "accent" : ""}`}><span>{label}</span><strong>{value}</strong></article>;
}
