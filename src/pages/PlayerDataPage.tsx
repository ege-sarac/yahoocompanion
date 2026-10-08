import {
  type ChangeEvent,
  type KeyboardEvent,
  useMemo,
  useRef,
  useState,
} from "react";

import { usePlayerOverrides } from "../context/PlayerOverridesContext";
import { useInjurySnapshot } from "../context/InjurySnapshotContext";
import { useNewPlayerOverrides } from "../context/NewPlayerOverridesContext";
import { useLeagueConfig } from "../context/LeagueConfigContext";
import { useDraft } from "../context/DraftContext";
import { INJURY_SNAPSHOT_CONFIG } from "../config/injurySnapshotConfig";
import type { PlayerDataSource } from "../data/playerLoader";
import {
  ALLOWED_INJURY_STATUSES,
  ALLOWED_YAHOO_POSITIONS,
  getInjurySnapshotFreshness,
  calculateNewPlayerMetadataCompleteness,
  classifyNewPlayer,
  matchesPlayerName,
  NEW_PLAYER_CLASSES,
  NEW_PLAYER_PREVIOUS_LEAGUES,
  NEW_PLAYER_ROLE_EXPECTATIONS,
  NBA_AVAILABILITY_STATUSES,
  playerToOverride,
  projectPlayerForRecommendations,
  buildTeamEcosystem,
  applyRoleIntelligence,
  applyCurrentRoleOverride,
  applyDraftValueProjection,
  applyYahooProjectionBaseline,
  approximateRoundFromPick,
} from "../engine";
import currentRoleOverridesJson from "../../data/manual/currentRoleOverrides.json";
import type {
  InjuryStatus,
  InjuryMatchingReport,
  NewPlayerClass,
  NbaAvailabilityStatus,
  NewPlayerPreviousLeague,
  NewPlayerProjectionInput,
  NewPlayerRoleExpectation,
  Player,
  PlayerOverride,
  ProjectionMetrics,
  YahooPosition,
  TeamContextSummary,
  PlayerRoleDataSet,
  RoleContextSummary,
  PlayerRoleMetrics,
  CurrentRoleOverride,
  MarketDataSet,
  MarketPlayerProfile,
  YahooDefaultProjectionDataSet,
} from "../types";

interface PlayerDataPageProps {
  players: Player[];
  dataSource: PlayerDataSource;
  injuryReport: InjuryMatchingReport;
  newPlayerInputs: readonly NewPlayerProjectionInput[];
  roleData?: PlayerRoleDataSet;
  marketData?: MarketDataSet;
  yahooDefaultProjections?: YahooDefaultProjectionDataSet;
}

type EligibilityFilter = "all" | "missing" | "complete";
type InjuryFilter = "all" | "unset" | InjuryStatus;
type TopLimit = 0 | 100 | 200 | 300;

interface PlayerRow {
  player: Player;
  projectedFantasyPointsPerGame: number | null;
  historicalAvailabilityRisk: number | null;
  metrics: ProjectionMetrics | null;
  baseMetrics: ProjectionMetrics | null;
  teamContext?: TeamContextSummary;
  roleContext?: RoleContextSummary;
  marketProfile?: MarketPlayerProfile;
}

export function PlayerDataPage({
  players,
  dataSource,
  injuryReport,
  newPlayerInputs,
  roleData,
  marketData,
  yahooDefaultProjections,
}: PlayerDataPageProps) {
  const { config } = useLeagueConfig();
  const { state: draftState } = useDraft();
  const { overrides, saveOverride, exportOverrides, importOverrides } =
    usePlayerOverrides();
  const { snapshot, importSnapshot, exportSnapshot } = useInjurySnapshot();
  const {
    saveNewPlayerOverride,
    exportNewPlayerOverrides,
    importNewPlayerOverrides,
  } = useNewPlayerOverrides();
  const [search, setSearch] = useState("");
  const [team, setTeam] = useState("all");
  const [eligibilityFilter, setEligibilityFilter] =
    useState<EligibilityFilter>("all");
  const [injuryFilter, setInjuryFilter] = useState<InjuryFilter>("all");
  const [topLimit, setTopLimit] = useState<TopLimit>(0);
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [watchlistText, setWatchlistText] = useState(() => localStorage.getItem("yahooCompanion.scoutingWatchlist") ?? "");
  const importInputRef = useRef<HTMLInputElement>(null);
  const injuryImportInputRef = useRef<HTMLInputElement>(null);
  const newPlayerImportInputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());

  const sortedRows = useMemo<PlayerRow[]>(
    () => {
      const records = new Map((roleData?.players ?? []).map((record) => [record.playerId, record]));
      const marketByPlayerId = new Map((marketData?.profiles ?? []).map((profile) => [profile.playerId, profile]));
      const yahooProjectionByPlayerId = new Map((yahooDefaultProjections?.entries ?? []).map((entry) => [entry.playerId, entry]));
      const latestRole = new Map<string, PlayerRoleMetrics>();
      const referenceSeason = players.flatMap((player) => player.historicalStats.map((season) => season.season)).sort((a, b) => b.localeCompare(a))[0];
      const configuredOverrides = Array.isArray(currentRoleOverridesJson.entries) ? currentRoleOverridesJson.entries as CurrentRoleOverride[] : [];
      for (const record of roleData?.players ?? []) { const latest = record.seasons.slice().sort((a, b) => b.season.localeCompare(a.season))[0]; if (latest) latestRole.set(record.playerId, latest); }
      const baseRows = players.map((player) => {
          const currentOverride = configuredOverrides.find((entry) => entry.playerId === player.id || entry.playerName.toLocaleLowerCase() === player.name.toLocaleLowerCase());
          const resolvedPlayer = currentOverride?.currentHealthStatus ? { ...player, currentHealthStatus: currentOverride.currentHealthStatus } : player;
          const projected = projectPlayerForRecommendations(
            resolvedPlayer,
            newPlayerInputs.find((input) => input.playerId === player.id),
            undefined,
            config,
          );
          const yahooBaseline = projected ? applyYahooProjectionBaseline(resolvedPlayer, projected, yahooProjectionByPlayerId.get(player.id), config) : undefined;
          const roleAdjusted = yahooBaseline ? applyRoleIntelligence(resolvedPlayer, yahooBaseline, records.get(player.id), config) : undefined;
          const currentRoleAdjusted = roleAdjusted ? applyCurrentRoleOverride(resolvedPlayer, roleAdjusted.metrics, configuredOverrides) : undefined;
          return {
            player: resolvedPlayer,
            metrics: currentRoleAdjusted ? applyDraftValueProjection(resolvedPlayer, currentRoleAdjusted, records.get(player.id), config, referenceSeason) : null,
            roleContext: roleAdjusted?.summary,
          };
        });
      const context = draftState.teamEcosystemEnabled ? buildTeamEcosystem(baseRows.flatMap((row) => row.metrics ? [{ player: row.player, metrics: row.metrics }] : []), config, latestRole) : null;
      return baseRows.map(({ player, metrics: baseMetrics, roleContext }) => {
          const metrics = context?.metricsByPlayerId.get(player.id) ?? baseMetrics;
          return {
            player,
            projectedFantasyPointsPerGame: metrics?.projection.projectedFantasyPointsPerGame ?? null,
            historicalAvailabilityRisk:
              metrics?.historicalAvailabilityRisk ?? null,
            metrics,
            baseMetrics,
            teamContext: context?.contextsByPlayerId.get(player.id),
            roleContext,
            marketProfile: marketByPlayerId.get(player.id),
          };
        })
        .sort(
          (left, right) =>
            (right.projectedFantasyPointsPerGame ?? -1) -
              (left.projectedFantasyPointsPerGame ?? -1) ||
            left.player.name.localeCompare(right.player.name),
        );
    },
    [config, draftState.teamEcosystemEnabled, marketData, newPlayerInputs, players, roleData, yahooDefaultProjections],
  );
  const scopedRows = useMemo(
    () => (topLimit === 0 ? sortedRows : sortedRows.slice(0, topLimit)),
    [sortedRows, topLimit],
  );
  const filteredRows = useMemo(
    () =>
      scopedRows.filter(({ player }) => {
        const matchesSearch =
          !search.trim() || matchesPlayerName(player.name, search);
        const matchesTeam = team === "all" || player.nbaTeam === team;
        const matchesEligibility =
          eligibilityFilter === "all" ||
          (eligibilityFilter === "missing"
            ? player.yahooPositions.length === 0
            : player.yahooPositions.length > 0);
        const matchesInjury =
          injuryFilter === "all" ||
          (injuryFilter === "unset"
            ? player.injuryStatus === null || player.injuryStatus === "Unknown"
            : player.injuryStatus === injuryFilter);
        return (
          matchesSearch &&
          matchesTeam &&
          matchesEligibility &&
          matchesInjury
        );
      }),
    [eligibilityFilter, injuryFilter, scopedRows, search, team],
  );
  const watchlistRows = useMemo(() => {
    const names = watchlistText.split(/[\n,]/).map((name) => name.trim().toLocaleLowerCase()).filter(Boolean);
    return names.map((name) => sortedRows.find((row) => row.player.name.toLocaleLowerCase() === name) ?? { player: { id: `unmatched-${name}`, name, nbaTeam: null, yahooPositions: [], age: null, injuryStatus: null, expectedReturnDate: null, historicalStats: [], projections: null, injuryRisk: null, opportunityScore: null, breakoutScore: null }, projectedFantasyPointsPerGame: null, historicalAvailabilityRisk: null, metrics: null, baseMetrics: null });
  }, [sortedRows, watchlistText]);
  function saveWatchlist(value: string) { setWatchlistText(value); localStorage.setItem("yahooCompanion.scoutingWatchlist", value); }
  const teams = useMemo(
    () =>
      [...new Set(players.map((player) => player.nbaTeam).filter(Boolean))].sort(
        (left, right) => left!.localeCompare(right!),
      ) as string[],
    [players],
  );
  const totalCompleted = players.filter(
    (player) => player.yahooPositions.length > 0,
  ).length;
  const scopeCompleted = scopedRows.filter(
    ({ player }) => player.yahooPositions.length > 0,
  ).length;
  const snapshotFreshness = getInjurySnapshotFreshness(snapshot.generatedAt);
  const majorInjuryCount = injuryReport.matchedEntries.filter((match) => {
    if (
      !INJURY_SNAPSHOT_CONFIG.majorInjuryStatuses.includes(match.entry.status)
    ) {
      return false;
    }
    const player = players.find((candidate) => candidate.id === match.playerId);
    const metrics = player
      ? projectPlayerForRecommendations(
          player,
          newPlayerInputs.find((input) => input.playerId === player.id),
          undefined,
          config,
        )
      : null;
    return (
      (metrics?.projection.projectedFantasyPointsPerGame ?? 0) >=
      INJURY_SNAPSHOT_CONFIG.majorFantasyRelevantMinimumFpG
    );
  }).length;

  function savePlayerChange(
    player: Player,
    changes: Partial<Omit<PlayerOverride, "playerId">>,
  ) {
    const existing = overrides.find(
      (override) => override.playerId === player.id,
    );
    saveOverride({
      ...(existing ?? playerToOverride(player)),
      ...changes,
      playerId: player.id,
    });
    setMessage(null);
  }

  function togglePosition(player: Player, position: YahooPosition) {
    const positions = player.yahooPositions.includes(position)
      ? player.yahooPositions.filter((value) => value !== position)
      : ALLOWED_YAHOO_POSITIONS.filter(
          (value) =>
            value === position || player.yahooPositions.includes(value),
        );
    savePlayerChange(player, { yahooPositions: positions });
    setActivePlayerId(player.id);
  }

  function handleRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement>,
    player: Player,
  ) {
    const target = event.target as HTMLElement;
    if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(target.tagName)) {
      return;
    }
    const position = event.key.toUpperCase();
    if (ALLOWED_YAHOO_POSITIONS.includes(position as YahooPosition)) {
      event.preventDefault();
      togglePosition(player, position as YahooPosition);
    }
  }

  function focusNextMissing() {
    if (eligibilityFilter === "complete") {
      setMessage("The current filter only shows players with eligibility.");
      return;
    }
    const navigationRows = scopedRows.filter(({ player }) => {
      const matchesSearch =
        !search.trim() || matchesPlayerName(player.name, search);
      const matchesTeam = team === "all" || player.nbaTeam === team;
      const matchesInjury =
        injuryFilter === "all" ||
        (injuryFilter === "unset"
          ? player.injuryStatus === null || player.injuryStatus === "Unknown"
          : player.injuryStatus === injuryFilter);
      return matchesSearch && matchesTeam && matchesInjury;
    });
    const currentIndex = navigationRows.findIndex(
      ({ player }) => player.id === activePlayerId,
    );
    const orderedRows = [
      ...navigationRows.slice(currentIndex + 1),
      ...navigationRows.slice(0, currentIndex + 1),
    ];
    const nextRow = orderedRows.find(
      ({ player }) => player.yahooPositions.length === 0,
    );
    if (!nextRow) {
      setMessage("No players with missing eligibility remain in this view.");
      return;
    }

    const next = nextRow.player;
    setActivePlayerId(next.id);
    const row = rowRefs.current.get(next.id);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function downloadJson(contents: string, filename: string) {
    const blob = new Blob([contents], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function handleExport() {
    downloadJson(exportOverrides(), "yahoo-companion-player-overrides.json");
    setMessage(`Exported ${overrides.length} player overrides.`);
  }

  function handleExampleDownload() {
    const firstPlayerId = players[0]?.id ?? "123";
    const example: PlayerOverride[] = [
      {
        playerId: firstPlayerId,
        yahooPositions: ["F", "C"],
        injuryStatus: "Healthy",
        expectedReturnDate: null,
        notes: "Example only",
      },
    ];
    downloadJson(
      JSON.stringify(example, null, 2),
      "yahoo-companion-player-overrides-example.json",
    );
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      importOverrides(parsed, new Set(players.map((player) => player.id)));
      setMessage(`Imported and validated ${file.name}.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Import failed: ${error.message} Existing overrides were kept.`
          : "Import failed. Existing overrides were kept.",
      );
    } finally {
      event.target.value = "";
    }
  }

  async function handleInjurySnapshotImport(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const report = importSnapshot(parsed, players);
      setMessage(
        `Imported injury snapshot: ${report.matchedEntries.length} matched, ${report.unmatchedEntries.length} unmatched.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Injury snapshot import failed: ${error.message} Existing snapshot was kept.`
          : "Injury snapshot import failed. Existing snapshot was kept.",
      );
    } finally {
      event.target.value = "";
    }
  }

  function handleInjurySnapshotExport() {
    downloadJson(
      exportSnapshot(),
      `yahoo-companion-current-injuries-${snapshot.generatedAt.slice(0, 10)}.json`,
    );
    setMessage(`Exported injury snapshot with ${snapshot.entries.length} entries.`);
  }

  function saveNewPlayerChange(
    player: Player,
    changes: Partial<Omit<NewPlayerProjectionInput, "playerId">>,
  ) {
    const existing = newPlayerInputs.find(
      (input) => input.playerId === player.id,
    );
    try {
      saveNewPlayerOverride({
        ...(existing ?? { playerId: player.id, classification: classifyNewPlayer(player).classification }),
        ...changes,
        playerId: player.id,
      });
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invalid newcomer value.");
    }
  }

  function handleNewPlayerExport() {
    downloadJson(
      exportNewPlayerOverrides(),
      "yahoo-companion-new-player-overrides.json",
    );
    setMessage(`Exported ${newPlayerInputs.length} new-player overrides.`);
  }

  async function handleNewPlayerImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      importNewPlayerOverrides(
        JSON.parse(await file.text()) as unknown,
        new Set(players.map((player) => player.id)),
      );
      setMessage(`Imported and validated ${file.name}.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `New-player import failed: ${error.message} Existing data was kept.`
          : "New-player import failed. Existing data was kept.",
      );
    } finally {
      event.target.value = "";
    }
  }

  const scopeLabel = topLimit === 0 ? "All players" : `Top ${topLimit}`;

  return (
    <section className="page" aria-labelledby="player-data-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Manual inputs</p>
          <h2 id="player-data-heading">Player Data</h2>
          <p>Manage broad Yahoo eligibility and current injury information.</p>
        </div>
        <span className={`data-badge ${dataSource}`}>
          {dataSource === "processed" ? `${players.length} NBA players` : "Data unavailable"}
        </span>
      </div>

      <section className="injury-snapshot-dashboard" aria-labelledby="injury-snapshot-heading">
        <div className="snapshot-heading-row">
          <div>
            <p className="eyebrow">Current injury data</p>
            <h3 id="injury-snapshot-heading">Injury Snapshot</h3>
          </div>
          <span className={`freshness-badge ${snapshotFreshness.freshness}`}>
            {snapshotFreshness.freshness}
            {snapshotFreshness.ageDays !== null
              ? ` · ${Math.floor(snapshotFreshness.ageDays)}d old`
              : ""}
          </span>
        </div>
        <div className="snapshot-stat-grid">
          <div><span>Snapshot generated</span><strong>{formatDateTime(snapshot.generatedAt)}</strong></div>
          <div><span>Players in snapshot</span><strong>{snapshot.entries.length}</strong></div>
          <div><span>Successfully matched</span><strong>{injuryReport.matchedEntries.length}</strong></div>
          <div><span>Unmatched</span><strong>{injuryReport.unmatchedEntries.length}</strong></div>
          <div><span>Major relevant injuries</span><strong>{majorInjuryCount}</strong></div>
        </div>
        {snapshotFreshness.freshness === "stale" && (
          <p className="snapshot-stale-warning">
            This snapshot is more than {INJURY_SNAPSHOT_CONFIG.staleAfterDays} days old. It remains active, but review or refresh it before drafting.
          </p>
        )}
        {(injuryReport.unmatchedEntries.length > 0 || injuryReport.duplicateMatches.length > 0 || injuryReport.conflictingEntries.length > 0) && (
          <details className="snapshot-report-details">
            <summary>View matching report</summary>
            {injuryReport.unmatchedEntries.map((entry) => <p key={`unmatched-${entry.entryIndex}`}>Unmatched: {entry.playerName} — {entry.reason}</p>)}
            {injuryReport.duplicateMatches.map((entry) => <p key={`duplicate-${entry.playerId}`}>Duplicate: {entry.playerName} (entries {entry.entryIndexes.map((index) => index + 1).join(", ")})</p>)}
            {injuryReport.conflictingEntries.map((entry, index) => <p key={`conflict-${index}`}>Conflict: {entry.playerName} — {entry.reason}</p>)}
          </details>
        )}
        <div className="snapshot-actions">
          <button onClick={() => injuryImportInputRef.current?.click()} type="button">Import Injury Snapshot</button>
          <button onClick={handleInjurySnapshotExport} type="button">Export Current Injury Snapshot</button>
          <input accept="application/json,.json" className="visually-hidden" onChange={handleInjurySnapshotImport} ref={injuryImportInputRef} type="file" />
        </div>
      </section>

      <section className="panel" aria-labelledby="scouting-watchlist-heading">
        <div className="panel-heading"><div><p className="eyebrow">Visibility only</p><h3 id="scouting-watchlist-heading">Scouting Watchlist</h3></div></div>
        <label>Paste player names (one per line or comma-separated)<textarea value={watchlistText} onChange={(event) => saveWatchlist(event.target.value)} rows={3} /></label>
        {watchlistRows.length > 0 && <div className="recommendations-table-wrap"><table className="recommendations-table"><thead><tr><th>Player</th><th>Status</th><th>FP/G</th><th>Expected GP</th><th>MPG</th><th>LOW / BASE / HIGH</th><th>Risk</th></tr></thead><tbody>{watchlistRows.map((row) => {
          const drafted = draftState.picks.find((pick) => pick.playerId === row.player.id);
          return <tr key={row.player.id}><td>{row.player.name}<small>{row.player.nbaTeam ?? "Unmatched"} · {row.player.yahooPositions.join("/") || "—"}</small></td><td>{drafted ? `Drafted #${drafted.overallPick} · R${drafted.round}` : row.metrics ? "Available" : "Unmatched"}</td><td>{row.projectedFantasyPointsPerGame?.toFixed(1) ?? "—"}</td><td>{row.metrics?.expectedGamesProjection?.expectedGames.toFixed(1) ?? "—"}</td><td>{row.metrics?.projection.projectedMinutes.toFixed(1) ?? "—"}</td><td>{row.metrics ? `${row.metrics.projection.projectedFantasyPointsPerGameLow?.toFixed(1) ?? "—"} / ${row.metrics.projection.projectedFantasyPointsPerGame.toFixed(1)} / ${row.metrics.projection.projectedFantasyPointsPerGameHigh?.toFixed(1) ?? "—"}` : "—"}</td><td>{row.metrics?.expectedGamesProjection?.availabilityRiskLabel ?? "—"}</td></tr>;
        })}</tbody></table></div>}
      </section>

      <div className="eligibility-progress">
        <div>
          <span>Yahoo eligibility completed</span>
          <strong>{totalCompleted} / {players.length}</strong>
        </div>
        <div>
          <span>{scopeLabel}</span>
          <strong>{scopeCompleted} / {scopedRows.length} completed</strong>
        </div>
        <div className="progress-track" aria-hidden="true">
          <span
            style={{
              width: `${players.length ? (totalCompleted / players.length) * 100 : 0}%`,
            }}
          />
        </div>
      </div>

      <section className="panel player-data-controls" aria-label="Player filters">
        <div className="filter-grid">
          <label>
            Player name
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search first or last name"
              type="search"
              value={search}
            />
          </label>
          <label>
            NBA team
            <select onChange={(event) => setTeam(event.target.value)} value={team}>
              <option value="all">All teams</option>
              {teams.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>
            Eligibility
            <select
              onChange={(event) => setEligibilityFilter(event.target.value as EligibilityFilter)}
              value={eligibilityFilter}
            >
              <option value="all">All</option>
              <option value="missing">Missing only</option>
              <option value="complete">Has eligibility</option>
            </select>
          </label>
          <label>
            Injury status
            <select
              onChange={(event) => setInjuryFilter(event.target.value as InjuryFilter)}
              value={injuryFilter}
            >
              <option value="all">All statuses</option>
              <option value="unset">Not entered</option>
              {ALLOWED_INJURY_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <label>
            Player pool
            <select
              onChange={(event) => setTopLimit(Number(event.target.value) as TopLimit)}
              value={topLimit}
            >
              <option value={0}>All</option>
              <option value={100}>Top 100</option>
              <option value={200}>Top 200</option>
              <option value={300}>Top 300</option>
            </select>
          </label>
        </div>
        <div className="player-data-actions">
          <button
            className={eligibilityFilter === "missing" ? "active" : undefined}
            onClick={() => setEligibilityFilter(eligibilityFilter === "missing" ? "all" : "missing")}
            type="button"
          >
            Missing Yahoo eligibility only
          </button>
          <button onClick={focusNextMissing} type="button">Next Missing</button>
          <button onClick={handleExport} type="button">Export Player Overrides</button>
          <button onClick={() => importInputRef.current?.click()} type="button">Import Player Overrides</button>
          <button onClick={handleExampleDownload} type="button">Download Example Override JSON</button>
          <button onClick={handleNewPlayerExport} type="button">Export New Player Overrides</button>
          <button onClick={() => newPlayerImportInputRef.current?.click()} type="button">Import New Player Overrides</button>
          <input
            accept="application/json,.json"
            className="visually-hidden"
            onChange={handleImport}
            ref={importInputRef}
            type="file"
          />
          <input
            accept="application/json,.json"
            className="visually-hidden"
            onChange={handleNewPlayerImport}
            ref={newPlayerImportInputRef}
            type="file"
          />
        </div>
        {message && <p className="draft-message" role="status">{message}</p>}
      </section>

      <p className="table-summary">
        Showing {filteredRows.length} players. Focus a row and press G, F, or C to toggle eligibility.
      </p>

      {filteredRows.some(({ player }) => player.historicalStats.length === 0) && (
        <section className="panel newcomer-editors" aria-labelledby="newcomer-editors-heading">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Zero-history inputs</p>
              <h3 id="newcomer-editors-heading">Rookie / New Player Projection Inputs</h3>
            </div>
            <span className="status-pill">
              {filteredRows.filter(({ player }) => player.historicalStats.length === 0).length} in view
            </span>
          </div>
          <p className="newcomer-help">
            Optional inputs refine a conservative projection. Empty fields never become fabricated history.
          </p>
          <div className="newcomer-editor-list">
            {filteredRows
              .filter(({ player }) => player.historicalStats.length === 0)
              .map(({ player }) => {
                const input = newPlayerInputs.find((entry) => entry.playerId === player.id);
                return (
                  <NewPlayerEditor
                    input={input}
                    key={player.id}
                    onChange={(changes) => saveNewPlayerChange(player, changes)}
                    player={player}
                  />
                );
              })}
          </div>
        </section>
      )}

      <section className="panel player-data-panel">
        <div className="player-data-table-wrap">
          <table className="player-data-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Team</th>
                <th>Yahoo positions</th>
                <th>Current injury</th>
                <th>Injury description</th>
                <th>Expected return</th>
                <th>Return confidence</th>
                <th>Source</th>
                <th>Last reviewed</th>
                <th>Notes</th>
                <th>Availability risk</th>
                <th>Projection source</th>
                <th>Projected MPG</th>
                <th>Projected FP/G</th>
                <th>Mock mean pick</th>
                <th>Yahoo ADP</th>
                <th>Historical FP/G</th>
                <th>Internal FP/G</th>
                <th>Yahoo adjusted FP/G</th>
                <th>Projection gap</th>
                <th>Production source</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(({ player, historicalAvailabilityRisk, projectedFantasyPointsPerGame, metrics, teamContext, roleContext, marketProfile }) => (
                <tr
                  className={activePlayerId === player.id ? "active-row" : undefined}
                  key={player.id}
                  onClick={() => setActivePlayerId(player.id)}
                  onFocus={() => setActivePlayerId(player.id)}
                  onKeyDown={(event) => handleRowKeyDown(event, player)}
                  ref={(element) => {
                    if (element) rowRefs.current.set(player.id, element);
                    else rowRefs.current.delete(player.id);
                  }}
                  tabIndex={0}
                >
                  <td>
                    <strong>{player.name}</strong>
                    {player.historicalStats.length === 0 && (
                      <span className="no-history-badge">NO NBA HISTORY</span>
                    )}
                    {player.historicalStats.length > 0 && (
                      <details className="player-history-details">
                        <summary>Recent NBA seasons</summary>
                        {player.historicalStats.slice().sort((a, b) => b.season.localeCompare(a.season)).slice(0, 3).map((season) => (
                          <small key={season.season}>{season.season}: {season.gamesPlayed} G · {season.minutesPerGame.toFixed(1)} MPG · {season.points.toFixed(1)} PTS · {(season.offensiveRebounds + season.defensiveRebounds).toFixed(1)} REB · {season.assists.toFixed(1)} AST</small>
                        ))}
                      </details>
                    )}
                  </td>
                  <td>{player.nbaTeam ?? "—"}</td>
                  <td>
                    <div className="position-toggles" aria-label={`Yahoo positions for ${player.name}`}>
                      {ALLOWED_YAHOO_POSITIONS.map((position) => (
                        <button
                          aria-pressed={player.yahooPositions.includes(position)}
                          className={player.yahooPositions.includes(position) ? "selected" : undefined}
                          key={position}
                          onClick={() => togglePosition(player, position)}
                          type="button"
                        >
                          {position}
                        </button>
                      ))}
                    </div>
                    <small className="injury-origin">{player.positionSource ?? "unknown"}</small>
                  </td>
                  <td>
                    <select
                      aria-label={`Injury status for ${player.name}`}
                      onChange={(event) => savePlayerChange(player, { injuryStatus: event.target.value as InjuryStatus })}
                      value={player.injuryStatus ?? "Unknown"}
                    >
                      {ALLOWED_INJURY_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                    <span className={`injury-origin ${player.currentInjurySource ?? "default"}`}>
                      {player.currentInjurySource === "manual"
                        ? "Manual override"
                        : player.currentInjurySource === "snapshot"
                          ? "Injury snapshot"
                          : "Default unknown"}
                    </span>
                  </td>
                  <td>{player.injuryDescription ?? "-"}</td>
                  <td>
                    <input
                      aria-label={`Expected return date for ${player.name}`}
                      onChange={(event) => savePlayerChange(player, { expectedReturnDate: event.target.value || null })}
                      type="date"
                      value={player.expectedReturnDate ?? ""}
                    />
                    {player.expectedReturnText && <small className="return-text">{player.expectedReturnText}</small>}
                  </td>
                  <td>{player.returnConfidence ?? "unknown"}</td>
                  <td>
                    {player.injurySource?.sourceUrl ? (
                      <a href={player.injurySource.sourceUrl} rel="noreferrer" target="_blank">{player.injurySource.sourceName}</a>
                    ) : (player.injurySource?.sourceName ?? "-")}
                  </td>
                  <td>{player.injurySource ? formatDateTime(player.injurySource.fetchedOrReviewedAt) : "-"}</td>
                  <td>
                    <input
                      aria-label={`Notes for ${player.name}`}
                      onChange={(event) => savePlayerChange(player, { notes: event.target.value })}
                      placeholder="Optional notes"
                      type="text"
                      value={player.notes ?? ""}
                    />
                  </td>
                  <td>{historicalAvailabilityRisk === null ? "—" : `${Math.round(historicalAvailabilityRisk * 100)}%`}</td>
                  <td>{metrics?.projectionSource ?? "—"}</td>
                  <td>{metrics ? <>{metrics.projection.projectedMinutes.toFixed(1)}<small className="return-text">{formatRange(metrics.projection.projectedMinutesLow, metrics.projection.projectedMinutesHigh)}</small></> : "—"}</td>
                  <td>{projectedFantasyPointsPerGame === null ? "—" : <>{projectedFantasyPointsPerGame.toFixed(1)}<small className="return-text">{formatRange(metrics?.projection.projectedFantasyPointsPerGameLow, metrics?.projection.projectedFantasyPointsPerGameHigh)}</small>{roleContext?.usagePctBaseline !== undefined && <small className="return-text">USG {roleContext.usagePctBaseline.toFixed(1)}% · {roleContext.lateSeasonRegime?.replaceAll("_", " ")}</small>}{roleContext && Math.abs(roleContext.adjustmentPercent) >= .001 && <small className="return-text">Role {roleContext.adjustmentPercent >= 0 ? "+" : ""}{Math.round(roleContext.adjustmentPercent * 100)}% · confidence {Math.round((roleContext.regimeConfidence ?? 0) * 100)}%</small>}{teamContext && Math.abs(teamContext.adjustmentPercent) >= .001 && <small className="return-text">Team context {teamContext.label} ({teamContext.adjustmentPercent >= 0 ? "+" : ""}{Math.round(teamContext.adjustmentPercent * 100)}%) · usage load {teamContext.teamUsageLoad.toFixed(2)}</small>}</>}</td>
                  <td>{formatPickAndRound(marketProfile?.mockMeanPick, config.teamCount)}</td>
                  <td>{formatPickAndRound(marketProfile?.yahooADP, config.teamCount)}</td>
                  <td>{marketProfile?.externalHistoricalFantasyPointsPerGame?.toFixed(1) ?? "—"}</td>
                  <td>{metrics?.yahooProjectionComparison?.internalComparableFantasyPPG.toFixed(1) ?? "—"}</td>
                  <td>{metrics?.yahooProjectionComparison?.leagueAdjustedYahooFantasyPPG?.toFixed(1) ?? "—"}</td>
                  <td>{metrics?.yahooProjectionComparison?.projectionGap === undefined ? "—" : `${metrics.yahooProjectionComparison.projectionGap >= 0 ? "+" : ""}${metrics.yahooProjectionComparison.projectionGap.toFixed(1)}`}</td>
                  <td>{metrics?.yahooProjectionComparison?.sourceSelected === "YAHOO_EXTERNAL" ? `Yahoo External · fallback gap ${config.externalProjectionFallbackThreshold.toFixed(1)}` : `Internal · fallback gap ${config.externalProjectionFallbackThreshold.toFixed(1)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function formatDateTime(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleDateString()
    : "Invalid date";
}

function formatPickAndRound(pick: number | undefined, teamCount: number): string {
  const round = approximateRoundFromPick(pick, teamCount);
  return pick === undefined || round === null ? "—" : `${pick.toFixed(1)} (R${round.toFixed(1)})`;
}

interface NewPlayerEditorProps {
  player: Player;
  input?: NewPlayerProjectionInput;
  onChange: (
    changes: Partial<Omit<NewPlayerProjectionInput, "playerId">>,
  ) => void;
}

function NewPlayerEditor({ player, input, onChange }: NewPlayerEditorProps) {
  const { config } = useLeagueConfig();
  const inferred = classifyNewPlayer(player, input);
  const completeness = calculateNewPlayerMetadataCompleteness(input);
  const metrics = projectPlayerForRecommendations(player, input, undefined, config);
  const numericFields: ReadonlyArray<{
    key: keyof NewPlayerProjectionInput;
    label: string;
    step?: number;
  }> = [
    { key: "age", label: "Age", step: 1 },
    { key: "nbaDraftYear", label: "Draft year", step: 1 },
    { key: "nbaDraftRound", label: "Draft round", step: 1 },
    { key: "nbaDraftPick", label: "Draft pick", step: 1 },
    { key: "previousGames", label: "Previous games", step: 1 },
    { key: "previousMinutesPerGame", label: "Previous MPG" },
    { key: "previousPointsPerGame", label: "Previous PPG" },
    { key: "previousOffensiveReboundsPerGame", label: "Previous OREB" },
    { key: "previousDefensiveReboundsPerGame", label: "Previous DREB" },
    { key: "previousAssistsPerGame", label: "Previous AST" },
    { key: "previousStealsPerGame", label: "Previous STL" },
    { key: "previousBlocksPerGame", label: "Previous BLK" },
    { key: "previousTurnoversPerGame", label: "Previous TO" },
    { key: "expectedNbaMinutes", label: "Expected NBA MPG" },
    { key: "expectedNbaMinutesLow", label: "Expected MPG low" },
    { key: "expectedNbaMinutesBase", label: "Expected MPG base" },
    { key: "expectedNbaMinutesHigh", label: "Expected MPG high" },
    { key: "summerLeagueGames", label: "Summer League games", step: 1 },
    { key: "summerLeagueMinutesPerGame", label: "Summer League MPG" },
    { key: "summerLeaguePointsPerGame", label: "Summer League PTS" },
    { key: "summerLeagueReboundsPerGame", label: "Summer League REB" },
    { key: "summerLeagueAssistsPerGame", label: "Summer League AST" },
    { key: "summerLeagueStealsPerGame", label: "Summer League STL" },
    { key: "summerLeagueBlocksPerGame", label: "Summer League BLK" },
    { key: "summerLeagueTurnoversPerGame", label: "Summer League TO" },
  ];
  function updateNumericField(key: keyof NewPlayerProjectionInput, raw: string) {
    const value = raw === "" ? null : Number(raw);
    if (key === "expectedNbaMinutesLow" || key === "expectedNbaMinutesBase" || key === "expectedNbaMinutesHigh") {
      if (value === null) {
        onChange({ expectedNbaMinutesLow: null, expectedNbaMinutesBase: null, expectedNbaMinutesHigh: null });
        return;
      }
      const base = input?.expectedNbaMinutesBase ?? input?.expectedNbaMinutes ?? metrics?.projection.projectedMinutes ?? 0;
      onChange({
        expectedNbaMinutesLow: key === "expectedNbaMinutesLow" ? value : (input?.expectedNbaMinutesLow ?? Math.max(0, base - 3)),
        expectedNbaMinutesBase: key === "expectedNbaMinutesBase" ? value : base,
        expectedNbaMinutesHigh: key === "expectedNbaMinutesHigh" ? value : (input?.expectedNbaMinutesHigh ?? Math.min(48, base + 3)),
      });
      return;
    }
    onChange({ [key]: value });
  }

  return (
    <details className="newcomer-editor">
      <summary>
        <span>
          <strong>{player.name}</strong>
          <small>
            {player.nbaTeam ?? "No team"} · Official experience {player.nbaExperience ?? "unknown"}
          </small>
        </span>
        <span className="newcomer-summary-meta">
          <span className="classification-badge">{inferred.classification}</span>
          <small>{Math.round(completeness * 100)}% metadata</small>
        </span>
      </summary>
      <div className="newcomer-classification-note">
        Classification confidence: {inferred.confidence} — {inferred.basis}
      </div>
      {completeness < 0.35 && (
        <p className="newcomer-missing-warning">
          Limited metadata: the model will use a conservative fallback with low confidence.
        </p>
      )}
      <div className="newcomer-projection-summary">
        <span>Eligibility <strong>{player.yahooPositions.join(" / ") || "Unknown"}</strong><small>{player.positionSource ?? "unknown"}</small></span>
        <span>NBA availability <strong>{input?.nbaAvailabilityStatus ?? "Unknown"}</strong></span>
        <span>Projected MPG <strong>{metrics?.projection.projectedMinutes.toFixed(1) ?? "-"}</strong><small>{formatRange(metrics?.projection.projectedMinutesLow, metrics?.projection.projectedMinutesHigh)}</small></span>
        <span>Projected FP/G <strong>{metrics?.projection.projectedFantasyPointsPerGame.toFixed(1) ?? "-"}</strong><small>{formatRange(metrics?.projection.projectedFantasyPointsPerGameLow, metrics?.projection.projectedFantasyPointsPerGameHigh)}</small></span>
        <span>Current injury <strong>{player.injuryStatus ?? "Unknown"}</strong></span>
        <span>Confidence <strong>{metrics ? `${Math.round(metrics.modelConfidence * 100)}%` : "-"}</strong></span>
      </div>
      <div className="newcomer-input-grid">
        <label>
          Classification
          <select
            onChange={(event) => onChange({ classification: event.target.value as NewPlayerClass })}
            value={input?.classification ?? inferred.classification}
          >
            {NEW_PLAYER_CLASSES.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label>
          Previous league
          <select
            onChange={(event) => onChange({ previousLeague: event.target.value as NewPlayerPreviousLeague })}
            value={input?.previousLeague ?? "Unknown"}
          >
            {NEW_PLAYER_PREVIOUS_LEAGUES.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label>
          Role expectation
          <select
            onChange={(event) => onChange({ roleExpectation: event.target.value as NewPlayerRoleExpectation })}
            value={input?.roleExpectation ?? "Unclear"}
          >
            {NEW_PLAYER_ROLE_EXPECTATIONS.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label>
          NBA availability
          <select onChange={(event) => onChange({ nbaAvailabilityStatus: event.target.value as NbaAvailabilityStatus })} value={input?.nbaAvailabilityStatus ?? "Unknown"}>
            {NBA_AVAILABILITY_STATUSES.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label>
          Previous team / school
          <input onChange={(event) => onChange({ previousTeamOrSchool: event.target.value || null })} placeholder="Optional" type="text" value={input?.previousTeamOrSchool ?? ""} />
        </label>
        {numericFields.map(({ key, label, step }) => (
          <label key={key}>
            {label}
            <input
              min="0"
              onChange={(event) => updateNumericField(key, event.target.value)}
              placeholder={key === "age" && player.age !== null ? String(player.age) : "Optional"}
              step={step ?? 0.1}
              type="number"
              value={typeof input?.[key] === "number" ? String(input[key]) : ""}
            />
          </label>
        ))}
        <label className="newcomer-notes-field">
          Notes
          <input
            onChange={(event) => onChange({ notes: event.target.value || null })}
            placeholder="Optional context"
            type="text"
            value={input?.notes ?? ""}
          />
        </label>
        <label>
          Source name
          <input onChange={(event) => onChange({ source: { ...input?.source, sourceName: event.target.value || null } })} placeholder="Optional" value={input?.source?.sourceName ?? ""} />
        </label>
        <label>
          Source URL
          <input onChange={(event) => onChange({ source: { ...input?.source, sourceUrl: event.target.value || null } })} placeholder="Optional" value={input?.source?.sourceUrl ?? ""} />
        </label>
      </div>
    </details>
  );
}

function formatRange(low?: number, high?: number): string {
  return low === undefined || high === undefined ? "Range unavailable" : `${low.toFixed(1)}–${high.toFixed(1)}`;
}
