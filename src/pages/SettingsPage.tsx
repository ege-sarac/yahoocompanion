import { type FormEvent, useEffect, useState } from "react";
import { getDraftedRosterSize, getTotalDraftPicks, validateLeagueConfig } from "../config/leagueConfig";
import { useDraft } from "../context/DraftContext";
import { useLeagueConfig } from "../context/LeagueConfigContext";
import type { LeagueConfig } from "../types";

export function SettingsPage() {
  const { config, applyConfig, restoreDefaults } = useLeagueConfig();
  const { state, resetDraft, updatePreferences } = useDraft();
  const [draft, setDraft] = useState<LeagueConfig>(() => structuredClone(config));
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => setDraft(structuredClone(config)), [config]);

  function save(event: FormEvent) {
    event.preventDefault();
    try {
      const validated = validateLeagueConfig(draft);
      const structuralChange = validated.teamCount !== config.teamCount || validated.userDraftSlot !== config.userDraftSlot || validated.rounds !== config.rounds;
      if (structuralChange && state.picks.length > 0) {
        const confirmed = window.confirm("Team count, slot, or rounds changed. Reset the active draft and apply these settings? Player/newcomer/injury overrides will be preserved.");
        if (!confirmed) { setMessage("Settings were not changed; draft history was preserved."); return; }
        resetDraft();
      }
      applyConfig(validated);
      setMessage("League settings saved locally.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid league settings."); }
  }

  function restore() {
    if (state.picks.length > 0 && !window.confirm("Restore defaults and reset the active draft? Manual player data will be preserved.")) return;
    if (state.picks.length > 0) resetDraft();
    restoreDefaults();
    setMessage("YahooCompanion defaults restored.");
  }

  const setRoot = (key: "teamCount" | "userDraftSlot" | "rounds" | "externalProjectionFallbackThreshold", value: number) => setDraft((current) => ({ ...current, [key]: value }));
  return <section className="page settings-page" aria-labelledby="settings-heading">
    <div className="page-heading"><div><p className="eyebrow">Local league profile</p><h2 id="settings-heading">League Settings</h2><p>Every draft, projection, roster, and recommendation calculation uses this profile.</p></div></div>
    {state.picks.length > 0 && <div className="model-warning">An active draft has {state.picks.length} picks. Structural draft changes require an explicit reset; scoring and roster-fit changes can be applied safely.</div>}
    <form className="panel settings-form" onSubmit={save}>
      <SettingsGroup title="Draft">
        <NumberField label="Teams" value={draft.teamCount} onChange={(v) => setRoot("teamCount", v)} />
        <NumberField label="My draft slot" value={draft.userDraftSlot} onChange={(v) => setRoot("userDraftSlot", v)} />
        <NumberField label="Rounds" value={draft.rounds} onChange={(v) => setRoot("rounds", v)} />
      </SettingsGroup>
      <SettingsGroup title="Drafted roster">
        {(["G", "F", "C", "UTIL", "BN", "IL", "ILPlus"] as const).map((key) => <NumberField key={key} label={key === "ILPlus" ? "IL+ (display only)" : key === "IL" ? "IL (display only)" : key} value={draft.roster[key]} onChange={(value) => setDraft((current) => ({ ...current, roster: { ...current.roster, [key]: value } }))} />)}
        <p className="settings-summary">Drafted slots: {getDraftedRosterSize(draft)} · Total picks: {getTotalDraftPicks(draft)}. IL/IL+ do not count toward drafted slots.</p>
      </SettingsGroup>
      <SettingsGroup title="H2H points scoring">
        {(Object.keys(draft.scoring) as Array<keyof LeagueConfig["scoring"]>).map((key) => <NumberField key={key} label={key} step={0.1} value={draft.scoring[key]} onChange={(value) => setDraft((current) => ({ ...current, scoring: { ...current.scoring, [key]: value } }))} />)}
      </SettingsGroup>
      <SettingsGroup title="External projection fallback">
        <NumberField label="External Projection Fallback Gap (FP/G)" min={0} max={10} step={0.1} value={draft.externalProjectionFallbackThreshold} onChange={(value) => setRoot("externalProjectionFallbackThreshold", value)} />
        <p className="settings-summary">When the app's FP/G projection differs from the external projection by more than this amount, use the external production baseline. Lower values select external projections more often.</p>
      </SettingsGroup>
      <fieldset className="settings-group"><legend>Draft strategy</legend><div className="settings-checks">
        <label><input checked={state.keepPositionPreferenceAfterMyPick} onChange={(event) => updatePreferences({ keepPositionPreferenceAfterMyPick: event.target.checked })} type="checkbox" /> Keep position preference after my pick</label>
        <label><input checked={state.teamEcosystemEnabled} onChange={(event) => updatePreferences({ teamEcosystemEnabled: event.target.checked })} type="checkbox" /> Team ecosystem adjustments</label>
        <label><input checked={state.showTeamContextDetails} onChange={(event) => updatePreferences({ showTeamContextDetails: event.target.checked })} type="checkbox" /> Show team-context details</label>
        <label><input checked={state.decisionLoggingEnabled} onChange={(event) => updatePreferences({ decisionLoggingEnabled: event.target.checked })} type="checkbox" /> Include compact recommendation snapshots in future draft exports</label>
        <label><input checked={state.recommendationTraceEnabled} onChange={(event) => updatePreferences({ recommendationTraceEnabled: event.target.checked })} type="checkbox" /> Record forensic recommendation trace</label>
        <label>Trace granularity<select value={state.recommendationTraceGranularity} onChange={(event) => updatePreferences({ recommendationTraceGranularity: event.target.value as typeof state.recommendationTraceGranularity })}><option value="USER_TURNS">User turns</option><option value="EVERY_RECORDED_PICK">Every recorded pick</option></select></label>
        <label>Team diversification<select value={state.teamDiversificationMode} onChange={(event) => updatePreferences({ teamDiversificationMode: event.target.value as typeof state.teamDiversificationMode })}><option>Off</option><option>Strong soft cap</option><option>Strict</option></select></label>
        <label>Preferred max from one NBA team<input min={1} max={15} type="number" value={state.preferredMaxSameTeam} onChange={(event) => updatePreferences({ preferredMaxSameTeam: Math.max(1, Math.min(15, Number(event.target.value) || 1)) })} /></label>
      </div></fieldset>
      <fieldset className="settings-group"><legend>Recommendation display</legend><div className="settings-grid">
        <NumberField label="Primary recommendations" value={state.recommendationDisplay.primaryCount} onChange={(value) => updatePreferences({ recommendationDisplay: { ...state.recommendationDisplay, primaryCount: value } })} />
        <NumberField label="Expanded total" value={state.recommendationDisplay.expandedTotalCount} onChange={(value) => updatePreferences({ recommendationDisplay: { ...state.recommendationDisplay, expandedTotalCount: value } })} />
        <label>Expand by<select value={state.recommendationDisplay.expansionMode} onChange={(event) => updatePreferences({ recommendationDisplay: { ...state.recommendationDisplay, expansionMode: event.target.value as typeof state.recommendationDisplay.expansionMode } })}><option value="DRAFT_PROGRESS">Draft progress</option><option value="ROUND">Round</option></select></label>
        <NumberField label="Expand at progress" step={.05} value={state.recommendationDisplay.expandAtProgress} onChange={(value) => updatePreferences({ recommendationDisplay: { ...state.recommendationDisplay, expandAtProgress: value } })} />
        <NumberField label="Expand at round" value={state.recommendationDisplay.expandAtRound} onChange={(value) => updatePreferences({ recommendationDisplay: { ...state.recommendationDisplay, expandAtRound: value } })} />
      </div><p className="settings-summary">Default: Top 5, then 9 total recommendations at 60% draft progress. Values are safely bounded and saved locally.</p></fieldset>
      {message && <p className="form-message" role="status">{message}</p>}
      <div className="settings-actions"><button className="primary-button" type="submit">Save and apply</button><button type="button" onClick={restore}>Restore YahooCompanion defaults</button></div>
    </form>
  </section>;
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) { return <fieldset className="settings-group"><legend>{title}</legend><div className="settings-grid">{children}</div></fieldset>; }
function NumberField({ label, value, onChange, step = 1, min, max }: { label: string; value: number; onChange: (value: number) => void; step?: number; min?: number; max?: number }) { return <label>{label}<input type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>; }
