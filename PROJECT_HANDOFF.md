# YahooCompanion Project Handoff

Last updated: 2026-10-06

Read this before modifying the project. Update its date and the affected sections after every material architecture, data-contract, or workflow change.

## Product and boundaries

YahooCompanion is a Windows-local fantasy basketball snake-draft assistant. Stack: React 19, TypeScript, Vite, Node/TypeScript scripts, and an optional local Python NBA-data pipeline. It has no backend, database server, authentication, Yahoo API, paid API, runtime scraping, or deployment configuration.

The browser uses versioned `localStorage` for draft state and editable manual data. Repository JSON files are generated or seed/manual data. Do not assume a repository seed overwrites a user’s browser-local changes.

The active default is a configurable 16-team H2H points league, slot 10, 15 rounds, roster G3/F2/C2/UTIL3/BN5. IL/IL+ never count as drafted slots. Do not scatter those numbers: `src/config/leagueConfig.ts` is authoritative.

Hard rules:

- No player-name conditionals in TypeScript.
- No generic youth, rookie, veteran, or center boosts/penalties.
- Market data determines timing only, never basketball projections.
- Watchlist and visibility tools must never alter Draft Score.
- Preserve the dirty working tree; do not reset/clean/delete unrelated user data.

## Windows commands

Use `npm.cmd`, not `npm`, because PowerShell may block `npm.ps1`.

```powershell
cd C:\dev\Projects\YahooCompanion
npm.cmd install
npm.cmd run dev
npm.cmd test
npm.cmd run build
npm.cmd run injuries:validate
npm.cmd run readiness:validate
npm.cmd run market:validate
npm.cmd run performance:benchmark
```

Node 20.19+ is required. Node 22 LTS is preferred. Python 3.11/3.12 is required only for the optional NBA data pipeline.

## Pages

- **Draft**: manual pick entry/search, current snake pick, Live Top, More Options, Production Watch after 45% progress, undo/reset, trace export, and draft import/export.
- **Recommendations**: complete current ranking table.
- **My Roster**: deterministic restrictive-position-first slot assignment.
- **Player Data**: player search/filtering, Yahoo eligibility edits, injury snapshot controls, newcomer details, projection information, and local Scouting Watchlist.
- **Settings**: runtime `LeagueConfig`, display depth, and draft preferences.
- **Readiness**: catalog/manual data/injury/role/config/backup diagnostics.

## Key source locations

### Context and UI

- `src/App.tsx`: top-level data loading and page composition.
- `src/context/LeagueConfigContext.tsx`: persisted runtime configuration.
- `src/context/DraftContext.tsx`: persisted draft state and actions.
- `src/context/InjurySnapshotContext.tsx`: dated injury snapshot.
- `src/pages/DraftPage.tsx`: on-clock UI, More Options, Production Watch.
- `src/pages/RecommendationsPage.tsx`: full ranking.
- `src/pages/PlayerDataPage.tsx`: catalog UI, watchlist, injury and manual data UI.

### Draft core

- `src/engine/draftOrder.ts`: generic snake math and remaining user-pick schedule.
- `src/engine/draftState.ts`: picks, export/import, undo, availability.
- `src/engine/draftReplay.ts`: deterministic replay diagnostics.
- `src/engine/fantasyPoints.ts`: active scoring calculation.

### Projection and ranking core

- `src/engine/recommendationEngine.ts`: current authoritative recommendation pipeline.
- `src/engine/projectionModel.ts`: veteran production projection.
- `src/engine/newPlayerProjection.ts`: zero-NBA-history newcomer path.
- `src/engine/expectedGames.ts`: availability model and structured health adjustments.
- `src/engine/draftValueProjection.ts`: Expected Games/career/draft-value projection context.
- `src/engine/roleProjection.ts`: historical role/regime adjustment.
- `src/engine/currentRoleOverrides.ts`: manual role freshness handling.
- `src/engine/teamMinutesBudget.ts`, `teamEcosystem.ts`: team minute/resource passes.
- `src/engine/roleOutcomes.ts`: LOW/BASE/HIGH scenarios.
- `src/engine/seasonValue.ts`: replacement and season VORP.

### Market and diagnostics

- `src/engine/marketDraft.ts`: absolute-pick market observations, survival, wait, and acquisition frontier.
- `src/engine/recommendationTrace.ts`: trace serialization.
- `scripts/draftReplay.ts`, `scripts/auditDraft.ts`, `scripts/auditMarket.ts`: offline diagnostics.

## League rules and snake math

Default slot-10 picks in 16 teams/15 rounds are:

```text
10, 23, 42, 55, 74, 87, 106, 119, 138, 151, 170, 183, 202, 215, 234
```

Never hardcode this. Use `getMyOverallPicks(config)` or `getUserPickSchedule(currentPick, config)`.

Scoring is dynamic but default points scoring is:

```text
PTS + 1.4*OREB + 1.2*DREB + 1.5*AST + 2*STL + 2*BLK - TO + 5*DD + 5*TD
```

## Concepts that must stay separate

### Intrinsic basketball value

FP/G, healthy-game minutes, Expected Games, scenarios, replacement level, season VORP, role, and injury/availability are basketball/data outputs.

### Pick-now and target-later value

Live recommendation scoring decides the best use of the current user pick. A player can be excellent intrinsically yet be a rational wait/target-later choice.

### Market timing

Market answers when to acquire a player. It cannot change FP/G, Expected Games, VORP, role, or per-minute skill.

### Visibility-only tools

Scouting Watchlist and Production Watch are intentionally score-neutral.

## Processed and manual data

### Generated/processed

- `data/processed/players.json`: player catalog used in browser.
- `data/processed/playerRoleHistory.json`: processed role/regime artifact.
- `data/processed/marketProfiles.json`: learned local market profiles.

### Manual data

- `data/manual/currentInjuries.json`: dated structured injury snapshot.
- `data/manual/currentRoleOverrides.json`: manual fresh role/current-health evidence.
- `data/manual/newPlayerOverrides.json`: newcomer/manual projection inputs.
- `data/manual/playerOverrides.json`: repository player/Yahoo seed overrides, if present.
- `data/manual/mockDraftHistory/`: historical completed mocks. Treat with provenance caution.
- `data/manual/yahooMarket.json`: imported Yahoo/consensus reference envelope. It contains source metadata and matched player timing/reference fields; it is not mock-draft history.

### Current untracked/user data

Do not delete or overwrite these merely because they are untracked or modified:

- `data/manual/currentInjuries.json` and its backup files.
- mocks under `data/manual/mockDraftHistory/`.
- `yahoo_companion_selected_players_mock_adp.xlsx`.

## Injury and availability model

`src/types/injurySnapshot.ts` defines snapshot fields; `src/engine/injurySnapshot.ts` validates/matches/merges them.

Structured optional fields:

```text
currentHealthStatus:
HEALTHY_CLEARED, FULL_PARTICIPATION, RETURNING_SOON, RETURN_RAMP,
LIMITED, INJURED, OUT_LONG_TERM, UNKNOWN

availabilityClass:
DAY_TO_DAY, OPENING_WEEKS, FIRST_QUARTER, MIDSEASON, LATE_SEASON,
MOST_OF_SEASON, FULL_SEASON, RETURN_RAMP, UNKNOWN

expectedGamesLowOverride, expectedGamesBaseOverride, expectedGamesHighOverride
```

No natural-language injury parsing for game projections. Text is explanation only.

`HEALTHY_CLEARED` / `FULL_PARTICIPATION` remove unresolved current-injury penalties but preserve historical durability evidence. `expectedGames.ts` exposes historical durability baseline, current-health adjustment, timeline adjustment, return-ramp adjustment, and final expected games.

## Current role overrides

`data/manual/currentRoleOverrides.json` is local manual data. Types: `src/types/currentRoleOverride.ts`; application: `src/engine/currentRoleOverrides.ts`.

Generic fields include player ID/name/team, source date, confidence, current health status, role context, rotation tier, starter evidence, role-security/sustainability/depth overrides, explicit minute overrides, and notes.

Rules:

- Only explicit manual minute fields may directly set/adjust minutes.
- Descriptive contexts such as `EXPECTED_STARTER` or `FRONTCOURT_DEPTH` must not invent MPG values.
- Overrides adjust current role evidence, not historical per-minute skill.
- Freshness decays through `roleOverrideFreshness`.
- Current file has data-only sample research entries for Keegan Murray, Nikola Vucevic, and Devin Vassell. Never replicate them as code rules.

## Projection consistency caveat

Player Data was updated to use the same current-role override and draft-value stages as ranking. This resolved the material stale-health/current-role mismatch.

It still does not run the complete recommendation-only Team Minutes Budget and Team Ecosystem reconciliation pass. Therefore crowded-team FP/G can differ slightly between Player Data and a live recommendation. The correct future fix is one shared canonical projection-universe resolver extracted from `recommendationEngine.ts`; do not duplicate further projection math in UI code.

## Late-round ranking model

10.6 V2 added late-round, production-sensitive terms to the existing recommendation engine. It begins smoothly at ~42% draft progress and reaches full strength around ~72%; it is zero early.

Key exposed fields on `PlayerRecommendation`:

```text
projectedSurplusPerGame, baseSurplusPerGame, lowSurplusPerGame, highSurplusPerGame
lateProductionQuality, riskAdjustedProduction, durabilityEfficiency
requiredRiskPremium, stashCapacity, stashBurden, rosterAvailabilityLoad
highVsBaseGain, ceilingMagnitude, ceilingCredibility, lateUpsideValue
lateValueClassification, lateRoundDominanceAdjustment, pickNowQualityFloorAdjustment
```

Position context is reduced late for non-critical candidates so it cannot casually reverse a clear production advantage. Critical legal roster feasibility remains meaningful. Do not broadly retune late-value weights merely to move named players; diagnose role, health, minutes, availability, roster feasibility, and timing first.

## Market timing and acquisition frontier

`marketDraft.ts` uses **absolute overall pick** as the cross-league coordinate.

- A source-draft exact pick #174 remains approximately #174 in another league size. It is not progress-rescaled.
- Undrafted in a 14-team/13-round source draft is right-censored only through #182. It says nothing about #202+.
- Source-aware observations can be `USER_MOCK`, `EXTERNAL_REFERENCE`, `CURRENT_ROOM`, `YAHOO_REFERENCE`, or `OTHER_REFERENCE`.

The market engine provides survival by user pick, `lastSafeUserPick`, `acquisitionFrontierPick`, `userTurnsBeforeFrontier`, timing labels, and bounded wait components. Final user pick must have zero timing/wait/urgency.

## Yahoo default production projections

`npm.cmd run projections:yahoo-import -- "C:\path\to\yahoo-default-projections.csv"` validates and matches Yahoo's default stat projection CSV, writing `data/processed/yahooDefaultProjections.json` for browser O(1) lookup. `npm.cmd run projections:yahoo-report` provides default-config coverage and override diagnostics.

`src/engine/yahooProjection.ts` is applied at the healthy/base production stage, before role intelligence, fresh current-role overrides, Expected Games/injury handling, team minutes, and ecosystem context. It recalculates Yahoo FP/G with the active `LeagueConfig.scoring` through `calculateFantasyPoints`; raw `Slot FPPG` is diagnostic only. Yahoo total rebounds are split by weighted recent player OREB share, falling back to the existing internal projection ratio; unavailable splits do not override. Existing generic projected DD/TD counts are reused, never reverse-engineered.

`LeagueConfig.externalProjectionFallbackThreshold` controls the deterministic symmetric fallback gap. It defaults to **1.5 FP/G**, is validated as a finite value from 0 to 10, and is editable in **Settings → External projection fallback** (step 0.1). The exact rule is `abs(internalComparable - leagueAdjustedYahoo) > configuredThreshold` (not `>=`): equality retains internal; a larger gap selects the Yahoo stat-line baseline. Saved configurations from before this setting safely receive the default, and invalid persisted values are repaired to 1.5 without discarding the rest of the saved profile. Fresh role, injury, availability, minutes, and team context continue after that selection. Yahoo GP remains a diagnostic field, not Expected Games. Player Data exposes final/internal/Yahoo-adjusted FP/G, the source, and the active fallback gap; recommendation traces retain the actual threshold used.

## Availability semantics and consistency audit

`availabilityRiskLabel` is the visible season-availability severity, calculated only from final Expected Games: 70–79 `STABLE`, 59–69 `MODERATE`, and below 59 `HIGH RISK`. Its color is therefore aligned to the displayed Expected Games number. It does not represent range uncertainty, rookie status, unknown injury metadata, or projection confidence. Those are separate: `availabilityConfidence` captures sample/range/current-health certainty, while `modelConfidence` captures production-model confidence. `Unknown` injury status has no direct missed-games penalty; it only widens availability uncertainty and applies a small Expected Games reduction when history is independently fragile.

Run `npm.cmd run projection:audit` after a projection-data or ranking-pipeline change. It checks expected-games/risk semantic consistency, LOW/BASE/HIGH order, strict Yahoo selection against the configured fallback gap, and non-finite final values. It reports warnings rather than changing player data. To audit an exported league-settings JSON instead of the default configuration, pass its path: `npm.cmd run projection:audit -- C:\path\to\league-settings.json`.

Last audit (2026-10-06): 588 recommendations, 196 Yahoo baselines, and 0 consistency warnings. `projections:yahoo-report` found 304 within tolerance, 131 upward external overrides, 65 downward overrides, and 88 without a usable Yahoo projection (including unmatched/no-history cases).

### Yahoo ADP market reference (implemented 2026-10-06)

`scripts/importYahooReference.ts` imports a Yahoo consensus CSV into the validated envelope at `data/manual/yahooMarket.json`, then rebuilds only the derived `data/processed/marketProfiles.json`. It does **not** add an external CSV to mock history and does not run market-learning on synthetic data.

The supported supplied CSV headers are:

```text
Rank, Player, Pos, Team, vs '25, Yahoo ADP, '25-26 FPPG, Avg rank
```

Matching is ID-first when an ID exists, otherwise accent/punctuation/suffix-insensitive normalized exact name matching. The import fails on unknown, ambiguous, invalid, or duplicate player mappings; do not manually “best guess” an unresolved player.

Run this after replacing the external reference file:

```powershell
npm.cmd run market:yahoo-import -- "C:\Users\Ege Sarac\Downloads\consensus-rankings-points (3).csv"
npm.cmd run market:yahoo-validate
npm.cmd run market:validate
```

The imported fields are deliberately separated:

- `yahooADP` / `yahooPreRank`: external acquisition-timing evidence only.
- `mockMeanPick`: local completed-mock timing evidence only.
- `externalHistoricalFantasyPointsPerGame`, `externalConsensusRank`, `externalRank`, and `externalRankChangeVsPrior`: diagnostic/reference fields only.

`calculateMarketTiming` uses a smooth Yahoo survival curve and reliability-aware source blend. One weak local exact pick is pulled materially toward Yahoo; repeated exact local observations earn more weight. Large source gaps lower market confidence. Yahoo never changes FP/G, Expected Games, scenarios, VORP, role, availability, or base Draft Score. Right-censored source drafts remain censored at their actual final observed pick. At the final user pick, all timing/wait values still become zero.

`MarketTimingProjection` and full recommendation traces retain `yahooAdp`, local/mock estimate, combined timing estimate, source gap/agreement, and external historical FP/G diagnostics so a later audit can identify why an acquisition recommendation was made.

UI conventions:

- Player Data has independent **Mock mean pick**, **Yahoo ADP**, and **Historical FP/G** columns.
- Draft Live Top, More Options, and Production Watch show a bold compact `CADP #<pick> · ~R<round>` next to the player name; missing values show `CADP —`.
- Recommendations adds a Yahoo ADP column.
- `src/engine/marketDisplay.ts` is the shared display helper. Its continuous approximate round is one-indexed: `1 + ((pick - 1) / activeLeagueConfig.teamCount)`; e.g. #1.7 in 16 teams is `~R1.0` and #165 is `~R11.3`. Use `Math.ceil(pick / teamCount)` for an integer round. This was display-only: `marketDraft.ts` already uses absolute overall picks and its own one-indexed internal round equivalent.
- Availability is visually scanable without changing any model output: `src/components/availabilityRisk.ts` maps `STABLE` to positive/green, `MODERATE` to warning/amber, `HIGH RISK` to danger/red, and unknown labels to neutral/muted. Expected Games and its risk label share that semantic class in Live Top, More Options, Production Watch, and the Recommendations table. This is display-only and has no recommendation-scoring effect.

`DraftPick.pickProvenance` values:

```text
OBSERVED_ROOM, USER_REAL_PICK, SYNTHETIC_PADDING, MANUAL_EXTENSION
```

All remove availability. Synthetic/manual extension picks must not become live-room evidence or market-learning data.

## Scouting Watchlist and Production Watch

### Scouting Watchlist

Player Data supports a locally persisted text watchlist, stored under `yahooCompanion.scoutingWatchlist`. Names can be pasted one per line or comma-separated. It displays resolved player identity, draft status/pick, FP/G, Expected Games, MPG, projection range, and availability risk. It has zero Draft Score impact.

Current limitation: it does not yet show current overall rank, full LOW/BASE/HIGH scenario values, or acquisition frontier. If extending it, consume the canonical recommendation result instead of creating a separate rank calculation.

### Production Watch

Draft page shows up to three available, non-visible players with highest projected FP/G after 45% progress. It displays actual rank, FP/G, Expected Games, risk, and timing. It does not alter order, Top 5, or score.

## Replays and diagnostics

```powershell
npm.cmd run draft:replay -- C:\path\to\draft-export.json
npm.cmd run draft:audit -- C:\path\to\draft-export.json
npm.cmd run market:audit -- C:\path\to\completed-mock.json
```

Replays are diagnostic only. Do not run `market:learn` on a diagnostic mock unless the user explicitly confirms it is a genuine completed historical draft intended for market learning.

`availableAtDecision` exists so a player already drafted/unavailable is not falsely diagnosed as a missed recommendation.

Requested diagnostic exports named `yahoo-companion-draft-2026-10-04-225518.json` and `yahoo-companion-draft-2026-10-05-155330.json` were not found in the repository during prior work. Do not claim they were replayed.

## NBA data pipeline

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r scripts\nba_data\requirements.txt
.\.venv\Scripts\python.exe scripts\nba_data\fetch_nba_data.py
.\.venv\Scripts\python.exe scripts\nba_data\process_nba_data.py
npm.cmd run players:validate

npm.cmd run roles:fetch
npm.cmd run roles:process
npm.cmd run roles:validate
npm.cmd run projection:compare
npm.cmd run projection:backtest
```

The browser stays offline. Network use is restricted to explicit local Python fetch commands.

## Last known verification

After the Yahoo reference implementation, the latest successful run reported:

```text
npm.cmd test                         247 tests passed
npm.cmd run build                    passed
npm.cmd run injuries:validate        20 matched, 0 unmatched
npm.cmd run readiness:validate       passed
npm.cmd run market:yahoo-validate    200 matched entries; 171 with ADP
npm.cmd run market:validate          588 profiles, 6 mocks, 200 Yahoo ranks
npm.cmd run performance:benchmark    repeated ranking mean about 43.1 ms; search about 0.8 ms
```

Search typing must never cause full rank recalculation. Keep ranking cached/memoized for unchanged inputs.

## Future-agent discipline

1. Read this handoff, README, relevant types/config, and affected tests first.
2. Use `rg` for search and `apply_patch` for edits.
3. Use `npm.cmd` on Windows.
4. Do not destructive-reset the dirty tree.
5. Add focused tests for engine/data-contract changes and run build plus appropriate validators.
6. Keep market, role/current-health, injury availability, and visibility/watchlist inputs separate.
7. Reuse/centralize resolved projection data rather than copy formulas between UI paths.

## Requested-but-not-yet-complete items

1. Extract a shared canonical projection-universe resolver to fully align Player Data and live recommendations.
2. Add validated current-role override import/export/matching-report UI, similar to injury snapshot tooling.
3. Extend Watchlist with actual rank, full scenario values, frontier, and score-derived “Why not Top 5.”
4. Expand replay CLI output with late-value and outside-Top-10 visibility diagnostics.
