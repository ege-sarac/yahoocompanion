import { type FormEvent, useEffect, useState } from "react";
import { getDraftedRosterSize, getTotalDraftPicks, validateLeagueConfig } from "../config/leagueConfig";
import { useDraft } from "../context/DraftContext";
import { useLeagueConfig } from "../context/LeagueConfigContext";
import type { LeagueConfig } from "../types";

export function SettingsPage() {
  const { config, applyConfig, restoreDefaults } = useLeagueConfig();
  const { state, resetDraft } = useDraft();
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

  const setRoot = (key: "teamCount" | "userDraftSlot" | "rounds", value: number) => setDraft((current) => ({ ...current, [key]: value }));
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
      {message && <p className="form-message" role="status">{message}</p>}
      <div className="settings-actions"><button className="primary-button" type="submit">Save and apply</button><button type="button" onClick={restore}>Restore YahooCompanion defaults</button></div>
    </form>
  </section>;
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) { return <fieldset className="settings-group"><legend>{title}</legend><div className="settings-grid">{children}</div></fieldset>; }
function NumberField({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (value: number) => void; step?: number }) { return <label>{label}<input type="number" step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>; }
