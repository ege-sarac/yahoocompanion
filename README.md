# YahooCompanion

YahooCompanion is a local-only React + TypeScript fantasy basketball snake-draft assistant. It has no backend, Yahoo authentication, paid API, or runtime scraping. NBA data is generated locally; projections, recommendations, settings, manual overrides, and draft state run in the browser.

The default league is 16-team H2H Points, draft slot 10, 15 rounds, and G3/F2/C2/UTIL3/BN5. IL and IL+ default to zero and never count as drafted roster spots. All of these values and every scoring multiplier can be changed on **Settings**.

## Requirements and commands

- Node.js 20.19+ (Node.js 22 LTS recommended)
- npm 10+
- Python 3.11 or 3.12 only for the optional NBA data pipeline

PowerShell may block `npm.ps1`; the Windows-safe commands are:

```powershell
cd C:\dev\Projects\YahooCompanion
npm.cmd install
npm.cmd run dev
```

Vite normally prints `http://localhost:5173`. Verification commands:

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run players:validate
npm.cmd run newcomers:validate
npm.cmd run injuries:validate
npm.cmd run rank:players
npm.cmd run readiness:validate
npm.cmd run draft:replay -- data/manual/replay-smoke-draft.json
npm.cmd run simulate:draft -- --runs=20 --seed=20260910
```

## Draft-day workflow

- **Draft** provides keyboard-first player search, manual pick entry, undo, confirmed draft reset, recent history, current team on the clock, and an on-clock Top 5.
- **Recommendations** compares exactly the current Top 5 with base and low–high FP/G and MPG, injury and availability risk, roster fit, scarcity, opportunity, confidence, tier/run context, and a heuristic survival estimate.
- **My Roster** assigns restrictive G/F/C slots first with deterministic matching, then UTIL and BN. Multi-position players may satisfy either compatible slot; bench slots do not create position needs.
- **Player Data** combines search/filtering, fast G/F/C editing, injury overrides, projection details, and expandable newcomer details. Focus a row and press G, F, or C to toggle a position.
- **Settings** edits and persists the authoritative LeagueConfig. A structural change during an active draft requires explicit confirmation and a draft reset.
- **Readiness** reports catalog, eligibility, newcomer, injury, config, and draft-state checks and provides full backup/restore.

Reset Draft removes picks only. It does not erase League Settings, player/Yahoo overrides, newcomer inputs, or the injury snapshot. Restoring league defaults also preserves manual data. Existing localStorage keys are versioned; invalid legacy values are warned about and copied to an `:unmigrated` recovery key rather than being silently discarded.

## Position Intent, feasibility, and team context

The Draft and Recommendations pages expose G/F/C multi-select controls. **Normal** ignores manual intent. **Prefer** uses a capped adjustment while retaining exceptional non-matching value. **Filter** shows only matching eligibility and never silently falls back. Selecting no positions, or all three, means all positions. Intent clears after the user's completed pick by default; Settings can preserve it.

The feasibility engine reuses deterministic restrictive-slot matching. It reports open G/F/C slots and `feasibilitySlack = remainingUserPicks - minimumPicksNeededForRestrictiveSlots`, then simulates every candidate. At critical slack, impossible candidates are warned and can be left out of the main Top 5; manual drafting remains allowed. UTIL and BN create no positional pressure, and unknown eligibility remains neutral.

The Team Ecosystem is a conservative heuristic projection adjustment, not an official NBA usage forecast. A base pass builds scoring, creation, rebounding, rim-protection, and G/F/C-minute profiles. A second, non-recursive pass compares normalized teammate supply with league team baselines while excluding the evaluated player. Stat-specific changes are capped near ±4% for secure veterans, ±6% for uncertain veterans, and ±8% for newcomers. It does not alter draft state and is not double-counted as another recommendation bonus.

Draft Repair replaces only the player on an existing pick while preserving its snake metadata. Duplicate replacements are rejected. Mark Unavailable removes a player without inventing a pick; availability can be restored. Legacy JSON missing Prompt #8 fields migrates to conservative defaults.

Replay an exported draft with `npm.cmd run draft:replay -- <path-to-json>`. The deterministic simulator runs with `npm.cmd run simulate:draft`. Both are offline diagnostics and never tune production weights automatically.

## League and scoring architecture

`src/config/leagueConfig.ts` contains the only defaults and validates the runtime `LeagueConfig`. The config drives snake order, total picks, next/previous user picks, progress, fantasy scoring, roster assignment, fit, scarcity, and UI summaries. Default scoring is:

```text
PTS + 1.4*OREB + 1.2*DREB + 1.5*AST + 2*STL + 2*BLK - TO + 5*DD + 5*TD
```

Changing scoring immediately recalculates veteran and newcomer fantasy projections. Changing roster settings immediately recalculates assignment, fit, and scarcity. Team count, user slot, and rounds feed generic snake math; defaults are not hardcoded elsewhere.

## Projection and recommendation model

Veterans with NBA history use recency- and sample-weighted NBA per-minute production, projected minutes, conservative DD/TD estimates, historical availability, a separate current-injury adjustment, and low/base/high ranges. Newcomers with zero NBA history use the separate translation model. Neither path creates fake historical records.

Recommendation weights interpolate continuously between these anchors based on completed picks and configured total draft length:

| Component | Early | Middle | Late |
| --- | ---: | ---: | ---: |
| Projected production | 62% | 47% | 36% |
| Availability | 13% | 11% | 10% |
| Roster fit | 2% | 8% | 14% |
| Scarcity | 4% | 8% | 10% |
| Opportunity | 3.5% | 7% | 10% |
| Breakout/upside | 1.5% | 4.5% | 8% |
| Flexibility | 1% | 2% | 2.5% |
| Confidence | 4% | 5% | 3.5% |
| Survival urgency | 5% | 4% | 3% |
| Recent position run | 1.5% | 1.5% | 1% |
| Tier drop-off | 2% | 2% | 2% |

Production remains the largest signal at every stage. Scarcity looks at usable remaining quality and drop-off, upcoming selections, progress, and open restrictive slots—not merely player count. Recent G/F/C runs use fractional credit for multi-position players. Tier urgency compares nearby candidates in the same broad position pool. The survival score estimates whether a player may last through the intervening picks; it is a deterministic heuristic, not a calibrated probability.

Historical availability and current injury state are separate, overlap-reduced, and capped so they cannot create an absurd double penalty. Injured players remain draftable and visible.

## Newcomer inputs

`data/manual/newPlayerOverrides.json` contains repository newcomer inputs. The browser stores its separately editable copy under `yahoo-companion:new-player-overrides:v1`. Supported optional data includes classification, age, draft year/round/pick, previous team/school and league, prior stat line, NBA availability, expected MPG low/base/high, role, Summer League line, provenance, and notes.

Minutes precedence is: explicit non-playing status, manual low/base/high range, legacy manual base MPG, role range, evidence heuristic, then conservative class fallback. `Overseas / stash` and `Not expected to play` legitimately project 0 NBA MPG and zero NBA production; zero is not raised to six. Old V3 arrays and `{ schemaVersion, overrides }` envelopes still import. Imports validate known IDs, uniqueness, enums, finite ranges, draft consistency, and `low <= base <= high` before replacing existing data.

Draft capital primarily supplies opportunity/role evidence and decays after the draft year. Older returning NBA veterans receive no rookie youth bonus. Optional Summer League production has a deliberately small capped weight. Newcomer confidence is capped at 0.66 and projection ranges widen when evidence is weaker.

## Data precedence and CLI parity

Position eligibility precedence:

```text
manual Yahoo override > broad NBA position fallback > unknown
```

NBA fallback values are visibly labeled and never presented as verified Yahoo positions. Unknown eligibility remains neutral. Current injury precedence is:

```text
manual player override > dated injury snapshot > generated/default value
```

`npm.cmd run rank:players` loads the same processed player data and repository newcomer inputs. It optionally loads `data/manual/playerOverrides.json`, then reports manual, fallback, and unknown position counts. Browser localStorage overrides remain authoritative in the UI and are never overwritten by the repository seed.

## Backup and restore

Use **Readiness → Export Draft-Day Backup** before a mock or live draft. The versioned JSON includes:

- LeagueConfig
- full draft history and derived IDs
- manual unavailable IDs, active position intent, and draft-strategy preferences
- player/Yahoo and manual injury overrides
- newcomer overrides
- current injury snapshot
- schema version, export time, and app version

Immutable `data/processed/players.json` is intentionally omitted. Import validates every section first and only then commits the set, so invalid input preserves the current state. Individual draft and override import/export controls remain available.

## NBA data pipeline

The five fictional records in `src/data/samplePlayers.ts` are test fixtures only. The app requires `data/processed/players.json` for real draft use.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r scripts\nba_data\requirements.txt
.\.venv\Scripts\python.exe scripts\nba_data\fetch_nba_data.py
.\.venv\Scripts\python.exe scripts\nba_data\process_nba_data.py
npm.cmd run players:validate
```

The master catalog unions official current-season `CommonAllPlayers` and all `CommonTeamRoster` results, then joins three completed seasons by NBA player ID. Historical-only players never expand the current catalog. Restart Vite after regenerating processed data.

## Source map

- `src/context/LeagueConfigContext.tsx`: versioned runtime league settings.
- `src/context/DraftContext.tsx`: draft persistence, import/export, undo, and reset.
- `src/context/*OverridesContext.tsx`: separately persisted manual player and newcomer data.
- `src/context/InjurySnapshotContext.tsx`: dated current-injury snapshot.
- `src/engine/draftOrder.ts`, `draftState.ts`: generic snake and draft state logic.
- `src/engine/fantasyPoints.ts`: dynamic points scoring.
- `src/engine/projectionModel.ts`, `newPlayerProjection.ts`: veteran/newcomer projections and ranges.
- `src/engine/rosterAssignment.ts`, `rosterFit.ts`, `scarcity.ts`: dynamic roster construction and pool pressure.
- `src/engine/rosterFeasibility.ts`: completion slack, candidate simulation, and urgency.
- `src/engine/teamEcosystem.ts`: team role competition/vacuum, security, caps, and stat-channel context.
- `src/engine/draftReplay.ts`: pure imperfect-draft replay diagnostics.
- `src/engine/draftSignals.ts`, `recommendationEngine.ts`: runs, survival, tiers, smooth weights, and Top 5 ranking.
- `src/engine/draftDayBackup.ts`: versioned full backup validation/serialization.
- `scripts/validate*.ts`: offline catalog, newcomer, injury, and readiness checks.
