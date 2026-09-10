import { useMemo, useState } from "react";
import { useDraft } from "../context/DraftContext";
import { matchesPlayerName } from "../engine";
import type { Player } from "../types";

export function DraftRepair({ players }: { players: readonly Player[] }) {
  const { state, replacePick, restoreAvailability } = useDraft();
  const [editingPick, setEditingPick] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const knownIds = useMemo(() => new Set(players.map((player) => player.id)), [players]);
  const manuallyUnavailable = players.filter((player) => state.manualUnavailablePlayerIds.includes(player.id));
  const results = query.trim() ? players.filter((player) => matchesPlayerName(player.name, query) && (!state.draftedPlayerIds.includes(player.id) || state.picks.find((pick) => pick.overallPick === editingPick)?.playerId === player.id)).slice(0, 8) : [];
  function replace(player: Player) { try { replacePick(editingPick!, player.id, knownIds); setMessage(`Pick #${editingPick} now records ${player.name}.`); setEditingPick(null); setQuery(""); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to replace pick."); } }
  return <section className="panel draft-repair" aria-labelledby="repair-heading">
    <div className="panel-heading"><div><p className="eyebrow">Corrections</p><h3 id="repair-heading">Draft Repair</h3></div><span className="status-pill">Drafted {state.draftedPlayerIds.length} · Manual {state.manualUnavailablePlayerIds.length} · Available {Math.max(0, players.length - new Set([...state.draftedPlayerIds, ...state.manualUnavailablePlayerIds]).size)}</span></div>
    {state.manualUnavailablePlayerIds.length > 0 && <p className="input-hint">{state.manualUnavailablePlayerIds.length} player(s) are unavailable without an assigned pick.</p>}
    {editingPick !== null && <div className="repair-editor"><label>Replace player at pick #{editingPick}<input autoFocus onChange={(event) => setQuery(event.target.value)} placeholder="Search replacement player" type="search" value={query} /></label>{results.map((player) => <button key={player.id} onClick={() => replace(player)} type="button">{player.name} · {player.yahooPositions.join("/") || "Unknown"}</button>)}<button onClick={() => { setEditingPick(null); setQuery(""); }} type="button">Cancel</button></div>}
    <ol className="repair-history">{[...state.picks].reverse().map((pick) => <li key={pick.overallPick}><span>#{pick.overallPick} {players.find((player) => player.id === pick.playerId)?.name ?? pick.playerId}</span><button onClick={() => { setEditingPick(pick.overallPick); setQuery(""); }} type="button">Edit / replace</button></li>)}</ol>
    {manuallyUnavailable.length > 0 && <details><summary>Restore manually unavailable players</summary><div className="restore-list">{manuallyUnavailable.map((player) => <button key={player.id} onClick={() => restoreAvailability(player.id)} type="button">Restore {player.name}</button>)}</div></details>}
    {message && <p className="form-message" role="status">{message}</p>}
  </section>;
}
