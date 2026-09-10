import { type ChangeEvent, useMemo, useRef, useState } from "react";
import { getDraftedRosterSize, getTotalDraftPicks } from "../config/leagueConfig";
import { useDraft } from "../context/DraftContext";
import { useInjurySnapshot } from "../context/InjurySnapshotContext";
import { useLeagueConfig } from "../context/LeagueConfigContext";
import { useNewPlayerOverrides } from "../context/NewPlayerOverridesContext";
import { usePlayerOverrides } from "../context/PlayerOverridesContext";
import { deriveMyRoster, getInjurySnapshotFreshness, getNextMyPick, getNewPlayerSanityWarnings, getSuspiciousReturnDateWarnings, projectPlayerForRecommendations, rankPlayers, serializeDraftDayBackup, validateDraftDayBackup, validateDraftState } from "../engine";
import type { InjuryMatchingReport, Player } from "../types";

export function ReadinessPage({ players, injuryReport }: { players: Player[]; injuryReport: InjuryMatchingReport }) {
  const { config, applyConfig } = useLeagueConfig();
  const { state, replaceDraftState } = useDraft();
  const { overrides, replaceOverrides } = usePlayerOverrides();
  const { newPlayerOverrides, replaceNewPlayerOverrides } = useNewPlayerOverrides();
  const { snapshot, replaceSnapshot } = useInjurySnapshot();
  const [message, setMessage] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const knownIds = useMemo(() => new Set(players.map((player) => player.id)), [players]);
  const zeroHistory = players.filter((player) => player.historicalStats.length === 0);
  const newcomerById = new Map(newPlayerOverrides.map((item) => [item.playerId, item]));
  const newcomerMetrics = zeroHistory.map((player) => ({ player, input: newcomerById.get(player.id), metrics: projectPlayerForRecommendations(player, newcomerById.get(player.id), undefined, config)! }));
  const conservative = newcomerMetrics.filter(({ metrics }) => metrics.newPlayerDetails?.usedConservativeFallback).length;
  const stash = newcomerMetrics.filter(({ metrics }) => metrics.newPlayerDetails?.nbaAvailabilityStatus === "Overseas / stash" || metrics.newPlayerDetails?.nbaAvailabilityStatus === "Not expected to play" || metrics.projection.projectedMinutes === 0).length;
  const sanityWarnings = newcomerMetrics.flatMap(({ player, metrics, input }) => getNewPlayerSanityWarnings(player, metrics, input));
  const suspiciousDates = getSuspiciousReturnDateWarnings(players);
  const freshness = getInjurySnapshotFreshness(snapshot.generatedAt);
  const duplicateIds = players.length - new Set(players.map((player) => player.id)).size;
  let draftMatches = true;
  try { validateDraftState(state, config); } catch { draftMatches = false; }
  const currentRound = Math.min(config.rounds, Math.ceil(state.currentOverallPick / config.teamCount));
  const readinessRanking = rankPlayers({ players, draftedPlayerIds: state.draftedPlayerIds, manualUnavailablePlayerIds: state.manualUnavailablePlayerIds, myRoster: deriveMyRoster(state, players), currentRound, currentOverallPick: state.currentOverallPick, draftPicks: state.picks, leagueConfig: config, newPlayerInputs: newPlayerOverrides, positionIntent: state.positionIntent, teamEcosystemEnabled: state.teamEcosystemEnabled });
  const unavailableConflicts = state.manualUnavailablePlayerIds.filter((id) => state.draftedPlayerIds.includes(id)).length;

  function exportBackup() {
    download("yahoo-companion-draft-day-backup.json", serializeDraftDayBackup({ leagueConfig: config, draftState: state, playerOverrides: overrides, newPlayerOverrides, injurySnapshot: snapshot }));
    setMessage("Draft-day backup exported.");
  }
  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const validated = validateDraftDayBackup(JSON.parse(await file.text()) as unknown, knownIds);
      // Every part is validated above. These setters cannot partially fail afterward.
      replaceDraftState(validated.draftState, validated.leagueConfig);
      replaceOverrides(validated.playerOverrides);
      replaceNewPlayerOverrides(validated.newPlayerOverrides);
      replaceSnapshot(validated.injurySnapshot);
      applyConfig(validated.leagueConfig);
      setMessage(`Backup from ${new Date(validated.exportedAt).toLocaleString()} restored.`);
    } catch (error) { setMessage(`Import failed; existing state was preserved. ${error instanceof Error ? error.message : "Invalid backup."}`); }
  }

  return <section className="page" aria-labelledby="readiness-heading">
    <div className="page-heading"><div><p className="eyebrow">Pre-draft checks</p><h2 id="readiness-heading">Draft Readiness</h2><p>Local data, configuration, and recovery checks in one place.</p></div></div>
    <div className="readiness-grid">
      <ReadinessCard title="Player catalog" rows={[["Total players", players.length, players.length ? "ready" : "error"], ["Duplicate IDs", duplicateIds, duplicateIds ? "error" : "ready"], ["Missing teams", players.filter((p) => !p.nbaTeam).length, "warning"]]} />
      <ReadinessCard title="Yahoo eligibility" rows={[["Manual overrides", overrides.length, "ready"], ["NBA fallbacks", players.filter((p) => p.positionSource === "NBA fallback").length, "ready"], ["Unresolved", players.filter((p) => p.positionSource === "unknown").length, "warning"]]} />
      <ReadinessCard title="Newcomer data" rows={[["Zero-history players", zeroHistory.length, "ready"], ["Manually enriched", zeroHistory.filter((p) => newcomerById.has(p.id)).length, "ready"], ["Conservative fallback", conservative, conservative ? "warning" : "ready"], ["Stash / zero MPG", stash, "ready"], ["Sanity warnings", sanityWarnings.length, sanityWarnings.length ? "warning" : "ready"]]} />
      <ReadinessCard title="Injuries" rows={[["Snapshot reviewed", snapshot.generatedAt.slice(0, 10), freshness.freshness === "stale" ? "warning" : "ready"], ["Matched entries", injuryReport.matchedEntries.length, "ready"], ["Manual overrides", overrides.filter((o) => o.injuryStatus !== undefined || Object.hasOwn(o, "expectedReturnDate")).length, "ready"], ["Suspicious dates", suspiciousDates.length, suspiciousDates.length ? "warning" : "ready"]]} />
      <ReadinessCard title="League config" rows={[["Teams / slot", `${config.teamCount} / ${config.userDraftSlot}`, "ready"], ["Rounds / total picks", `${config.rounds} / ${getTotalDraftPicks(config)}`, "ready"], ["Drafted roster", getDraftedRosterSize(config), getDraftedRosterSize(config) === config.rounds ? "ready" : "error"]]} />
      <ReadinessCard title="Draft state" rows={[["Recorded picks", state.picks.length, "ready"], ["Manual unavailable", state.manualUnavailablePlayerIds.length, state.manualUnavailablePlayerIds.length ? "warning" : "ready"], ["Unavailable conflicts", unavailableConflicts, unavailableConflicts ? "error" : "ready"], ["Next user pick", getNextMyPick(state.currentOverallPick, config) ?? "Complete", "ready"], ["Config matches state", draftMatches ? "Yes" : "No", draftMatches ? "ready" : "error"]]} />
      <ReadinessCard title="Roster feasibility engine" rows={[["Engine", "Valid", "ready"], ["Completion feasible", readinessRanking.rosterFeasibility.canCompleteRoster ? "Yes" : "No", readinessRanking.rosterFeasibility.canCompleteRoster ? "ready" : "error"], ["Feasibility slack", readinessRanking.rosterFeasibility.feasibilitySlack, readinessRanking.rosterFeasibility.feasibilitySlack < 0 ? "error" : readinessRanking.rosterFeasibility.feasibilitySlack <= 1 ? "warning" : "ready"]]} />
      <ReadinessCard title="Team ecosystem" rows={[["Teams built", readinessRanking.teamEcosystemDiagnostics.teamsBuilt, readinessRanking.teamEcosystemDiagnostics.teamsBuilt ? "ready" : "warning"], ["Players evaluated", readinessRanking.teamEcosystemDiagnostics.playersEvaluated, "ready"], ["Context cap violations", readinessRanking.teamEcosystemDiagnostics.capViolations, readinessRanking.teamEcosystemDiagnostics.capViolations ? "error" : "ready"], ["Unresolved team data", readinessRanking.teamEcosystemDiagnostics.unresolvedTeamPlayers, readinessRanking.teamEcosystemDiagnostics.unresolvedTeamPlayers ? "warning" : "ready"]]} />
      <ReadinessCard title="Position intent" rows={[["Active strategy", state.positionIntent.mode === "Normal" || state.positionIntent.positions.length === 0 || state.positionIntent.positions.length === 3 ? "Normal" : `${state.positionIntent.mode}: ${state.positionIntent.positions.join("/")}`, state.positionIntent.mode === "Normal" ? "ready" : "warning"]]} />
    </div>
    <section className="panel backup-panel"><div><p className="eyebrow">Recovery</p><h3>Draft-day backup</h3><p>Includes settings, complete draft history, player and newcomer overrides, and the injury snapshot. Immutable processed player data is not duplicated.</p></div><div className="settings-actions"><button className="primary-button" type="button" onClick={exportBackup}>Export Draft-Day Backup</button><button type="button" onClick={() => importRef.current?.click()}>Import Draft-Day Backup</button><input ref={importRef} hidden accept="application/json,.json" type="file" onChange={importBackup} /></div>{message && <p className="form-message" role="status">{message}</p>}</section>
  </section>;
}

function ReadinessCard({ title, rows }: { title: string; rows: Array<[string, string | number, "ready" | "warning" | "error"]> }) { return <article className="panel readiness-card"><h3>{title}</h3>{rows.map(([label, value, status]) => <div className="readiness-row" key={label}><span>{label}</span><strong>{value}</strong><small className={`readiness-status ${status}`}>{status}</small></div>)}</article>; }
function download(name: string, value: string) { const url = URL.createObjectURL(new Blob([value], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url); }
