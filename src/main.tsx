import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { DraftProvider } from "./context/DraftContext";
import { PlayerOverridesProvider } from "./context/PlayerOverridesContext";
import { InjurySnapshotProvider } from "./context/InjurySnapshotContext";
import { NewPlayerOverridesProvider } from "./context/NewPlayerOverridesContext";
import { LeagueConfigProvider } from "./context/LeagueConfigContext";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LeagueConfigProvider>
      <DraftProvider>
        <InjurySnapshotProvider>
          <NewPlayerOverridesProvider>
            <PlayerOverridesProvider><App /></PlayerOverridesProvider>
          </NewPlayerOverridesProvider>
        </InjurySnapshotProvider>
      </DraftProvider>
    </LeagueConfigProvider>
  </StrictMode>,
);
