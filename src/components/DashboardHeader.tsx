import { getDraftedRosterSize } from "../config/leagueConfig";
import { useLeagueConfig } from "../context/LeagueConfigContext";

export function DashboardHeader() {
  const { config } = useLeagueConfig();
  return (
    <header className="dashboard-header">
      <div>
        <p className="eyebrow">Local draft room</p>
        <h1>YahooCompanion</h1>
      </div>
      <div className="league-summary" aria-label="League settings">
        <span>{config.teamCount}-team H2H Points</span>
        <span>Draft slot {config.userDraftSlot}</span>
        <span>{getDraftedRosterSize(config)}-player roster</span>
      </div>
    </header>
  );
}
