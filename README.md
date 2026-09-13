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
npm.cmd run roles:validate
npm.cmd run projection:compare
npm.cmd run projection:backtest
npm.cmd run availability:validate
npm.cmd run market:validate
npm.cmd run draftvalue:diagnose
npm.cmd run market:audit -- data/manual/replay-smoke-draft.json
npm.cmd run draft:audit -- data/manual/replay-smoke-draft.json
npm.cmd run draft:replay -- data/manual/replay-smoke-draft.json
npm.cmd run simulate:draft -- --runs=20 --seed=20260913
```

## Draft-day workflow

- **Draft** provides keyboard-first player search, manual pick entry, undo, confirmed draft reset, recent history, current team on the clock, and an on-clock Top 5.
- **Recommendations** compares the current best five picks now. Raw FP/G stays visible beside expected games, season VORP/equivalent, market cost, market-aware survival, role security, and Draft Score.
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

## Projection and draft-value model

Veterans with NBA history use recency- and sample-weighted NBA per-minute production, projected minutes, conservative DD/TD estimates, historical availability, a separate current-injury adjustment, and low/base/high ranges. Newcomers with zero NBA history use the separate translation model. Neither path creates fake historical records. Raw active-game ability, availability-adjusted season value, market cost, and pick-now value remain separate.

Recommendation weights interpolate continuously between these anchors based on completed picks and configured total draft length:

| Component | Early | Middle | Late |
| --- | ---: | ---: | ---: |
| Season VORP value | 78% | 68% | 54% |
| Availability reliability | 5% | 3.5% | 1.5% |
| Opportunity | 4% | 8% | 13% |
| Breakout/upside | 2% | 8% | 20% |
| Skill confidence | 10.9% | 12.2% | 11% |
| Legacy roster-fit tie-break | 0.1% | 0.3% | 0.5% |

Season VORP remains the largest signal at every stage. Replacement FP/G is recomputed from the active pool, eligibility, team count, and roster boundary. `seasonVORP = (projected FP/G - replacement FP/G) * expected games`; the displayed season equivalent adds `seasonVORP / 82` back to replacement and is never labeled projected FP/G.

Expected games use normalized 58/27/15 recency weights, shrinkage toward a 68-game prior, repeated-low-season evidence, bounded career-stage durability, current injury/return evidence, and wider ranges when current health is unknown. A separate major-comeback route prevents a nearly missed season from inheriting a prior healthy workload at full strength. Current injury primarily changes expected games; active-game FP/G remains separately inspectable.

Career stage is bounded (`PRIME`, `LATE_PRIME`, `AGING`, `LATE_CAREER`, `EXTREME_LATE_CAREER`). Structural decline requires multiple signals across minutes, FP/minute, usage, starter/current-team role, or sustained role loss; age alone does not trigger it. Skill confidence describes demonstrated ability, while current-role security emphasizes current-team continuity, current stint, starter/minute stability, career trend, and range width.

Automatic fit, feasibility, need, scarcity, tier drop, recent runs, flexibility, and market depletion feed one position-context composite. Its contribution is capped at 5 points early and 13 late; only critical legal feasibility can use the larger override. An empty early roster therefore reports LOW G/F/C urgency. Availability is already embedded in season VORP, so the old independent component is only a small range/confidence reliability term.

## Local market timing and decision audits

Market data never changes basketball stats or raw FP/G. Optional profiles live in `data/processed/marketProfiles.json`; with no profile, low-confidence `MODEL_ONLY` survival is used. Completed mocks live in `data/manual/mockDraftHistory/`, normalize as `roundEquivalent = ((overallPick - 1) / teamCount) + 1`, and retain right-censored undrafted observations. Low samples shrink toward optional Yahoo pre-rank/ADP or a broad prior. Points/scoring-matched mocks receive full weight; category or mismatched samples are secondary evidence.

```powershell
npm.cmd run market:mock-import -- C:\path\to\completed-mock.json
npm.cmd run market:import -- C:\path\to\yahoo-rank-or-adp.csv
npm.cmd run market:learn
npm.cmd run market:validate
npm.cmd run market:audit -- C:\path\to\completed-mock.json
npm.cmd run draft:audit -- C:\path\to\draft-export.json
```

Yahoo import accepts `playerId,playerName,rank,adp,sourceDate`. NBA ID wins; without it, only one exact normalized-name match is accepted. Imports validate fully before atomic replacement. Reliable market history drives survival, with a bounded live-room positional pace adjustment. Pick-now scoring adds urgency when a player may disappear, wait/reach cost when selecting far ahead of market, and a capped one-to-two-round model-edge escape.

Future Draft exports use a version-2 envelope with team count, rounds, slot, scoring/roster fingerprints, creation time, and compact user-pick decision snapshots. A snapshot is written only immediately before a user selection, never on search input or render. Legacy bare exports and version-1 backups remain importable.

## Role intelligence and regimes

USG% estimates the share of a team's possession-ending offensive actions used by a player while on court: field-goal attempts, possession-ending free throws, and turnovers. It does not measure all creation, passing, touches, ball dominance, or rebounding. YahooCompanion therefore keeps separate scoring/possession, creation, rebounding, rim-protection, ball-handling, projected-minute, and positional-minute role channels. Usage never directly adds to a recommendation score. It changes relevant projected basketball stats (principally points and turnovers); the active `LeagueConfig` scoring is applied afterward.

Team Usage Budget normalizes each current NBA roster to 240 team player-minutes. Team Minutes Budget separately performs a constrained 240-minute allocation: a protected top rotation changes little, known current-team roles remain conservative, and uncertain depth/new-team roles absorb more pressure.

```text
normalizedMPG_i = projectedMPG_i * 240 / sum(projectedMPG_team)
teamUsageLoad = SUM((normalizedMPG_i / 48) * expectedUSG_i)
```

Loads within 0.95-1.05 are left alone. Above that band, low-security roles absorb more of a capped compression; below it, only players with scoring, creation, or strong newcomer evidence share a capped vacuum. Current-role security is distinct from skill confidence and weights continuity, current-team starter/minute evidence, stability, career trend, and range width. Usage-budget effects are capped at -6%/+4%. Pace is a minute-weighted current-team estimate, regressed toward 100, and can move counting-stat opportunities by at most 2%.

The LateSeasonRegime engine uses team chronology rather than a player's personal appearance count. It characterizes full-season, first two-thirds, team games 55+, post-All-Star, post-deadline, current-team stint, and last 20/10/5 windows. These overlapping windows detect one regime; they are not stacked. Minutes, usage, FGA/36, assists/36, rebounds/36, team stint, efficiency, sample, role-signal agreement, current-team continuity, teammate-absence dependency, return ramps, and final-week volatility produce a bounded regime influence of at most 28%. Hot-shooting and final-week-only spikes are capped at 4%; tiny samples cannot dominate a long history.

The offline participation matrix compares a player with and without at most three important same-role teammates. Roughly five games in each state are required for an unshrunk signal; smaller splits are heavily regressed. This is an *absence-dependent signal*, not causal attribution. A teammate who remains on the current roster reduces persistence; a sustained post-trade role is more relevant only when the player remains on that team. A long game gap followed by rising minutes is treated as a return ramp rather than a permanent role loss.

Team diversification is separate from NBA team-role competition. Settings offers **Off**, **Strong soft cap** (default), and **Strict**, with a preferred maximum of two players from one NBA team. The soft cap penalizes a third player and strongly discourages a fourth while retaining a genuinely elite-value escape hatch. Strict removes over-cap players from the main Top 5 when reasonable alternatives exist, but never changes availability or prevents manual drafting. My Roster shows represented NBA teams and highlights over-cap exposure.

Role instability can widen projection ranges; a supported current-team regime can modestly narrow them. Availability and current injury risk remain separate. When advanced, tracking, or game-log data is absent, the exact Prompt #8.2 path remains active. Missing tracking values are never invented, and derived proxies are never labeled official USG%.

The backtest predicts 2025-26 using only information available through 2024-25, then evaluates FP/G MAE, expected-games MAE, season-VORP MAE, availability rank correlation, median error, RMSE, Spearman rank correlation, Top-50/Top-100 recall, role and career cohorts, ablations, and confidence buckets. It is diagnostic and does not optimize or rewrite weights. These are projection heuristics, not guarantees.

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

Optional role refresh (network is used only by the explicit Python fetch; the browser remains offline):

```powershell
npm.cmd run roles:fetch
npm.cmd run roles:process
npm.cmd run roles:validate
npm.cmd run projection:compare
npm.cmd run projection:backtest
npm.cmd run rank:players -- --role-debug
npm.cmd run performance:benchmark
```

Raw official responses remain under `data/raw`. `roles:process` precomputes regimes and teammate-dependency splits and emits the compact `data/processed/playerRoleHistory.json`; raw game rows and the participation matrix are intentionally omitted from the browser artifact.

The master catalog unions official current-season `CommonAllPlayers` and all `CommonTeamRoster` results, then joins three completed seasons by NBA player ID. Historical-only players never expand the current catalog. Restart Vite after regenerating processed data.

## Source map

- `src/context/LeagueConfigContext.tsx`: versioned runtime league settings.
- `src/context/DraftContext.tsx`: draft persistence, import/export, undo, and reset.
- `src/context/*OverridesContext.tsx`: separately persisted manual player and newcomer data.
- `src/context/InjurySnapshotContext.tsx`: dated current-injury snapshot.
- `src/engine/draftOrder.ts`, `draftState.ts`: generic snake and draft state logic.
- `src/engine/fantasyPoints.ts`: dynamic points scoring.
- `src/engine/projectionModel.ts`, `newPlayerProjection.ts`: veteran/newcomer projections and ranges.
- `src/engine/expectedGames.ts`, `careerStage.ts`, `draftValueProjection.ts`: availability, career trend, comeback routing, and calibrated projection context.
- `src/engine/seasonValue.ts`, `teamMinutesBudget.ts`, `roleSecurity.ts`: replacement, season VORP, 240-minute reconciliation, and split skill/role confidence.
- `src/engine/marketDraft.ts`, `positionContext.ts`, `decisionLog.ts`: market timing/survival, bounded position context, and compact decision snapshots.
- `src/engine/rosterAssignment.ts`, `rosterFit.ts`, `scarcity.ts`: dynamic roster construction and pool pressure.
- `src/engine/rosterFeasibility.ts`: completion slack, candidate simulation, and urgency.
- `src/engine/teamEcosystem.ts`: team role competition/vacuum, security, caps, and stat-channel context.
- `src/engine/lateSeasonRegime.ts`, `roleProjection.ts`: precomputed regime interpretation and scoring-aware stat-channel adjustments.
- `src/engine/draftReplay.ts`: pure imperfect-draft replay diagnostics.
- `src/engine/draftSignals.ts`, `recommendationEngine.ts`: runs, survival, tiers, smooth weights, and Top 5 ranking.
- `src/engine/draftDayBackup.ts`: versioned full backup validation/serialization.
- `scripts/processRoles.ts`, `scripts/validateRoles.ts`: compact role artifact and offline provenance/range checks.
- `scripts/projectionBacktest.ts`, `compareRoleProjections.ts`: leakage-safe diagnostics and before/after reports.
- `scripts/importMarket.ts`, `importMockDraft.ts`, `learnMarket.ts`, `auditMarket.ts`, `auditDraft.ts`: atomic local market ingestion and decision diagnostics.
- `scripts/validate*.ts`: offline catalog, newcomer, injury, and readiness checks.
