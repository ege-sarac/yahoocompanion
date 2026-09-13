import { useDraft } from "../context/DraftContext";
import type { PositionNeedUrgency, RosterFeasibility, YahooPosition } from "../types";

const POSITIONS: YahooPosition[] = ["G", "F", "C"];

export function PositionIntentControls({ urgency, filterWarning, compact = false, feasibility }: { urgency?: Record<YahooPosition, PositionNeedUrgency>; filterWarning?: boolean; compact?: boolean; feasibility?: RosterFeasibility }) {
  const { state, setPositionIntent } = useDraft();
  const intent = state.positionIntent;
  function toggle(position: YahooPosition) {
    const positions = intent.positions.includes(position) ? intent.positions.filter((value) => value !== position) : [...intent.positions, position];
    setPositionIntent({ ...intent, positions });
  }
  function clear() { setPositionIntent({ mode: "Normal", positions: [] }); }
  return <div className={`position-intent ${compact ? "compact" : ""}`} aria-label="Position intent controls">
    <div className="position-control-row"><strong>Position intent</strong>{POSITIONS.map((position) => { const selected = intent.positions.includes(position); return <button aria-label={`${position} position ${selected ? "selected" : "not selected"}`} aria-pressed={selected} className={selected ? "active" : ""} key={position} onClick={() => toggle(position)} type="button">{position}{selected && <span aria-hidden="true" className="selected-mark">✓</span>}</button>; })}<button className="clear-intent" disabled={intent.mode === "Normal" && intent.positions.length === 0} onClick={clear} type="button">Clear</button></div>
    <div className="position-control-row"><span>Mode</span>{(["Normal", "Prefer", "Filter"] as const).map((mode) => { const selected = intent.mode === mode; return <button aria-label={`${mode} mode ${selected ? "selected" : "not selected"}`} aria-pressed={selected} className={selected ? "active" : ""} key={mode} onClick={() => setPositionIntent({ ...intent, mode })} type="button">{mode}{selected && <span aria-hidden="true" className="selected-mark">✓</span>}</button>; })}</div>
    {urgency && <div className="urgency-row"><span>Roster need</span>{POSITIONS.map((position) => <span aria-label={`${position} roster need ${urgency[position].label.toLowerCase()}`} className={`urgency-chip ${urgency[position].label.toLowerCase()}`} key={position}>{position} {urgency[position].label}</span>)}{feasibility && <span className="feasibility-inline">Slack <strong>{feasibility.feasibilitySlack}</strong> · Required <strong>{feasibility.minimumPicksNeededForRestrictiveSlots}</strong></span>}</div>}
    {urgency && intent.mode !== "Normal" && intent.positions.length > 0 && intent.positions.length < 3 && POSITIONS.some((position) => urgency[position].label === "CRITICAL" && !intent.positions.includes(position)) && <p className="intent-warning">A critical roster need conflicts with the active {intent.positions.join("/")} {intent.mode.toLowerCase()}.</p>}
    {filterWarning && <p className="intent-warning">This filter excludes every roster-feasible candidate. <button onClick={clear} type="button">Show roster-feasible options</button></p>}
  </div>;
}
