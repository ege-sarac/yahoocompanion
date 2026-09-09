import { useEffect, useMemo, useState } from "react";

import { AppLayout } from "./components/AppLayout";
import type { PageId } from "./components/Navigation";
import { usePlayerData } from "./data/playerLoader";
import { usePlayerOverrides } from "./context/PlayerOverridesContext";
import { useInjurySnapshot } from "./context/InjurySnapshotContext";
import { useNewPlayerOverrides } from "./context/NewPlayerOverridesContext";
import {
  matchInjurySnapshot,
  applyNbaPositionFallbacks,
  mergeInjurySnapshot,
  mergePlayerOverrides,
} from "./engine";
import { DraftPage } from "./pages/DraftPage";
import { MyRosterPage } from "./pages/MyRosterPage";
import { RecommendationsPage } from "./pages/RecommendationsPage";
import { PlayerDataPage } from "./pages/PlayerDataPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ReadinessPage } from "./pages/ReadinessPage";

function pageFromHash(): PageId {
  const page = window.location.hash.replace("#/", "");

  if (
    page === "recommendations" ||
    page === "roster" ||
    page === "player-data" || page === "settings" || page === "readiness"
  ) {
    return page;
  }

  return "draft";
}

export default function App() {
  const [activePage, setActivePage] = useState<PageId>(pageFromHash);
  const playerData = usePlayerData();
  const { overrides } = usePlayerOverrides();
  const { snapshot } = useInjurySnapshot();
  const { newPlayerOverrides } = useNewPlayerOverrides();
  const injuryReport = useMemo(
    () => matchInjurySnapshot(snapshot, playerData.players),
    [playerData.players, snapshot],
  );
  const playersWithSnapshot = useMemo(
    () => mergeInjurySnapshot(applyNbaPositionFallbacks(playerData.players), injuryReport),
    [injuryReport, playerData.players],
  );
  const players = useMemo(
    () => mergePlayerOverrides(playersWithSnapshot, overrides),
    [overrides, playersWithSnapshot],
  );

  useEffect(() => {
    const handleHashChange = () => setActivePage(pageFromHash());
    window.addEventListener("hashchange", handleHashChange);

    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const page = {
    draft: (
      <DraftPage
        players={players}
        dataSource={playerData.source}
        newPlayerInputs={newPlayerOverrides}
      />
    ),
    recommendations: (
      <RecommendationsPage
        players={players}
        dataSource={playerData.source}
        newPlayerInputs={newPlayerOverrides}
      />
    ),
    roster: (
      <MyRosterPage players={players} newPlayerInputs={newPlayerOverrides} />
    ),
    "player-data": (
      <PlayerDataPage
        players={players}
        dataSource={playerData.source}
        injuryReport={injuryReport}
        newPlayerInputs={newPlayerOverrides}
      />
    ),
    settings: <SettingsPage />,
    readiness: <ReadinessPage players={players} injuryReport={injuryReport} />,
  }[activePage];

  return <AppLayout activePage={activePage}>{page}</AppLayout>;
}
