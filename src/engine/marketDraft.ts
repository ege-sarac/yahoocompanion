import { DRAFT_VALUE_CONFIG } from "../config/draftValueConfig";
import type { DraftPick, LeagueConfig, MarketDataSet, MarketFormat, MarketPlayerProfile, MarketTimingProjection, MockDraftRecord, Player } from "../types";
import { getMyOverallPicks, getUserPickSchedule } from "./draftOrder";

export function createScoringFingerprint(scoring: LeagueConfig["scoring"]): string {
  return (Object.keys(scoring) as Array<keyof typeof scoring>).sort().map((key) => `${key}:${trim(scoring[key])}`).join("|");
}
export function createRosterFingerprint(config: LeagueConfig): string { return `teams:${config.teamCount}|rounds:${config.rounds}|G:${config.roster.G}|F:${config.roster.F}|C:${config.roster.C}|UTIL:${config.roster.UTIL}|BN:${config.roster.BN}`; }
export function overallPickToRoundEquivalent(overallPick: number, teamCount: number): number { return ((overallPick - 1) / teamCount) + 1; }
export function roundEquivalentToOverallPick(roundEquivalent: number, teamCount: number): number { return Math.max(1, Math.round((roundEquivalent - 1) * teamCount + 1)); }
export function normalizeDraftProgress(overallPick: number, teamCount: number, rounds: number): number { return Math.max(0, Math.min(1, (overallPick - 1) / Math.max(1, teamCount * rounds - 1))); }
export function progressToOverallPick(progress: number, config: Pick<LeagueConfig, "teamCount" | "rounds">): number { return Math.max(1, Math.min(config.teamCount * config.rounds, Math.round(Math.max(0, Math.min(1, progress)) * (config.teamCount * config.rounds - 1) + 1))); }
export function progressToRoundEquivalent(progress: number, config: Pick<LeagueConfig, "teamCount" | "rounds">): number { return overallPickToRoundEquivalent(progressToOverallPick(progress, config), config.teamCount); }

export type HistoricalConfigSource = "EMBEDDED" | "CLI_OVERRIDE" | "STRUCTURAL_INFERENCE" | "MIXED";
export interface HistoricalMockOverrides { teamCount?: number; rounds?: number }
export interface HistoricalMockResolution {
  draft: MockDraftRecord;
  configurationSource: HistoricalConfigSource;
  teamCountSource: Exclude<HistoricalConfigSource, "MIXED">;
  roundsSource: Exclude<HistoricalConfigSource, "MIXED">;
  expectedPicks: number;
  observedPicks: number;
}

export function validateMarketDataSet(value: unknown): MarketDataSet {
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.profiles)) throw new Error("Market data must be a schemaVersion 1 object with profiles.");
  const profiles = value.profiles.map(validateMarketProfile);
  if (new Set(profiles.map((profile) => profile.playerId)).size !== profiles.length) throw new Error("Market profiles contain duplicate player IDs.");
  return { schemaVersion: 1, generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : null, mockDraftCount: integer(value.mockDraftCount, 0), yahooRanksLoaded: integer(value.yahooRanksLoaded, 0), matchingScoringSamples: integer(value.matchingScoringSamples, 0), profiles, warnings: Array.isArray(value.warnings) ? value.warnings.filter((item): item is string => typeof item === "string") : [] };
}

export function validateMarketProfile(value: unknown): MarketPlayerProfile {
  if (!record(value) || typeof value.playerId !== "string" || !value.playerId.trim()) throw new Error("Every market profile requires playerId.");
  const output: MarketPlayerProfile = { playerId: value.playerId.trim() };
  for (const key of ["yahooPreRank", "yahooADP", "mockMedianPick", "mockMeanPick", "mockRoundEquivalentMedian", "mockRoundEquivalentLow", "mockRoundEquivalentHigh", "sampleCount", "externalHistoricalFantasyPointsPerGame", "externalConsensusRank", "externalRank"] as const) if (value[key] !== undefined) output[key] = finite(value[key], key);
  if (value.format !== undefined) { if (!["points", "category", "unknown"].includes(String(value.format))) throw new Error("Invalid market format."); output.format = value.format as MarketFormat; }
  for (const key of ["scoringFingerprint", "updatedAt", "source", "externalRankChangeVsPrior"] as const) if (typeof value[key] === "string") output[key] = value[key];
  for (const key of ["observedRoundEquivalents", "observedOverallPicks", "rightCensoredRoundEquivalents"] as const) if (value[key] !== undefined) { if (!Array.isArray(value[key]) || value[key].some((item) => typeof item !== "number" || !Number.isFinite(item))) throw new Error(`${key} must contain finite numbers.`); output[key] = [...value[key]] as number[]; }
  if (value.normalizedObservations !== undefined) {
    if (!Array.isArray(value.normalizedObservations) || value.normalizedObservations.some((item) => !record(item) || ![item.teamCount, item.rounds].every((entry) => typeof entry === "number" && Number.isFinite(entry)) || typeof item.rightCensored !== "boolean")) throw new Error("normalizedObservations must contain valid source-aware observations.");
    output.normalizedObservations = value.normalizedObservations.map((item) => {
      const legacy = typeof item.draftProgress === "number" && typeof item.roundEquivalent === "number";
      const absolute = item.rightCensored ? item.censorThreshold : item.overallPick;
      if (!legacy && (typeof absolute !== "number" || !Number.isFinite(absolute) || absolute < 1)) throw new Error("Market observation requires an absolute pick or censor threshold.");
      if (item.source !== undefined && !["USER_MOCK", "EXTERNAL_REFERENCE", "CURRENT_ROOM", "YAHOO_REFERENCE", "OTHER_REFERENCE"].includes(String(item.source))) throw new Error("Invalid market observation source.");
      return { overallPick: typeof item.overallPick === "number" ? item.overallPick : undefined, censorThreshold: typeof item.censorThreshold === "number" ? item.censorThreshold : undefined, teamCount: Number(item.teamCount), rounds: Number(item.rounds), rightCensored: Boolean(item.rightCensored), source: item.source as MarketPlayerProfile["normalizedObservations"] extends Array<infer T> ? T extends { source?: infer S } ? S : never : never, confidence: typeof item.confidence === "number" ? clamp01(item.confidence) : undefined, asOfDate: typeof item.asOfDate === "string" ? item.asOfDate : undefined, draftProgress: legacy ? clamp01(Number(item.draftProgress)) : undefined, roundEquivalent: typeof item.roundEquivalent === "number" ? Number(item.roundEquivalent) : undefined };
    });
  }
  return output;
}

export function parseMockDraft(value: unknown, fallbackTeamCount = 16, fallbackRounds = 15): MockDraftRecord {
  if (Array.isArray(value)) return makeMock(value, fallbackTeamCount, fallbackRounds, "unknown");
  if (!record(value)) throw new Error("Mock draft must be an object or pick array.");
  const state = record(value.draftState) ? value.draftState : value;
  if (!Array.isArray(state.picks)) throw new Error("Mock draft does not contain picks.");
  const metadata = record(value.metadata) ? value.metadata : {};
  const teamCount = validPositiveInteger(metadata.teamCount) ?? validPositiveInteger(value.teamCount) ?? fallbackTeamCount;
  const rounds = validPositiveInteger(metadata.rounds) ?? validPositiveInteger(value.rounds) ?? Math.max(fallbackRounds, Math.ceil(state.picks.length / teamCount));
  const format = ["points", "category", "unknown"].includes(String(value.format)) ? value.format as MarketFormat : "unknown";
  return { ...makeMock(state.picks, teamCount, rounds, format), scoringFingerprint: typeof metadata.scoringFingerprint === "string" ? metadata.scoringFingerprint : typeof value.scoringFingerprint === "string" ? value.scoringFingerprint : undefined, decisionLog: Array.isArray(state.decisionLog) ? state.decisionLog as MockDraftRecord["decisionLog"] : undefined };
}

/** Strict historical-import path. It never consults the active league settings. */
export function resolveHistoricalMockDraft(value: unknown, overrides: HistoricalMockOverrides = {}): HistoricalMockResolution {
  const { source, state, metadata } = extractMockSource(value);
  const values = state.picks;
  const embeddedTeamCount = embeddedPositiveInteger([metadata.teamCount, source.teamCount, state.teamCount, nestedPositiveInteger(source, "leagueConfig", "teamCount"), nestedPositiveInteger(state, "leagueConfig", "teamCount")], "team count");
  const embeddedRounds = embeddedPositiveInteger([metadata.rounds, source.rounds, state.rounds, nestedPositiveInteger(source, "leagueConfig", "rounds"), nestedPositiveInteger(state, "leagueConfig", "rounds")], "round count");
  const teamCountSource = embeddedTeamCount ? "EMBEDDED" as const : overrides.teamCount ? "CLI_OVERRIDE" as const : "STRUCTURAL_INFERENCE" as const;
  const teamCount = embeddedTeamCount ?? overrides.teamCount ?? inferTeamCount(values);
  const roundsSource = embeddedRounds ? "EMBEDDED" as const : overrides.rounds ? "CLI_OVERRIDE" as const : undefined;
  if (!roundsSource) throw new Error(`Historical round count is not stored. Re-run with --rounds=${observedRoundHint(values) ?? "<number>"}.`);
  const rounds = embeddedRounds ?? overrides.rounds!;
  if (!validPositiveInteger(teamCount) || !validPositiveInteger(rounds)) throw new Error("Historical teams and rounds must be positive integers.");
  const picks = validateHistoricalPicks(values, teamCount, rounds);
  const format = ["points", "category", "unknown"].includes(String(source.format)) ? source.format as MarketFormat : "unknown";
  const scoringFingerprint = typeof metadata.scoringFingerprint === "string" ? metadata.scoringFingerprint : typeof source.scoringFingerprint === "string" ? source.scoringFingerprint : undefined;
  const configurationSource: HistoricalConfigSource = teamCountSource === roundsSource ? teamCountSource : "MIXED";
  return { draft: { teamCount, rounds, format, picks, scoringFingerprint, metadata: metadata as Partial<MockDraftRecord["metadata"]> }, configurationSource, teamCountSource, roundsSource, expectedPicks: teamCount * rounds, observedPicks: picks.length };
}

export function createMockDraftFingerprint(draft: Pick<MockDraftRecord, "teamCount" | "rounds" | "scoringFingerprint" | "picks">): string {
  const payload = JSON.stringify({ teamCount: draft.teamCount, rounds: draft.rounds, scoringFingerprint: draft.scoringFingerprint ?? null, picks: draft.picks.map((pick) => [pick.overallPick, pick.playerId]) });
  let hash = 0x811c9dc5;
  for (let index = 0; index < payload.length; index++) hash = Math.imul(hash ^ payload.charCodeAt(index), 0x01000193);
  return `mock-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function extractMockSource(value: unknown): { source: Record<string, unknown>; state: Record<string, unknown> & { picks: unknown[] }; metadata: Record<string, unknown> } {
  if (Array.isArray(value)) return { source: {}, state: { picks: value }, metadata: {} };
  if (!record(value)) throw new Error("Mock draft must be an object or pick array.");
  const state = record(value.draftState) ? value.draftState : value;
  if (!Array.isArray(state.picks)) throw new Error("Mock draft does not contain picks.");
  return { source: value, state: state as Record<string, unknown> & { picks: unknown[] }, metadata: record(value.metadata) ? value.metadata : {} };
}

function inferTeamCount(values: unknown[]): number {
  if (!values.length || values.some((value) => !record(value))) throw new Error("Historical team count is not stored and draft structure is insufficient. Re-run with --teams=<number>.");
  const picks = values as Record<string, unknown>[];
  const candidates = [...new Set(picks.flatMap((pick) => [pick.teamNumber, pick.pickInRound]).map(validPositiveInteger).filter((value): value is number => value !== undefined))];
  const maximum = Math.max(0, ...candidates);
  if (maximum < 2 || !picks.every((pick) => validPositiveInteger(pick.overallPick) && validPositiveInteger(pick.round) && validPositiveInteger(pick.pickInRound) && validPositiveInteger(pick.teamNumber))) throw new Error("Historical team count is not stored and draft structure is insufficient. Re-run with --teams=<number>.");
  const teamNumbers = new Set(picks.map((pick) => pick.teamNumber as number));
  const pickNumbers = new Set(picks.map((pick) => pick.pickInRound as number));
  if (teamNumbers.size !== maximum || pickNumbers.size !== maximum || [...teamNumbers, ...pickNumbers].some((value) => value < 1 || value > maximum)) throw new Error("Historical team count is not stored and the team/pick ranges are inconsistent. Re-run with --teams=<number>.");
  for (let index = 0; index < picks.length; index++) {
    const pick = picks[index], overall = pick.overallPick as number, round = pick.round as number, pickInRound = pick.pickInRound as number, teamNumber = pick.teamNumber as number;
    const expectedRound = Math.ceil(overall / maximum), expectedPick = ((overall - 1) % maximum) + 1, expectedTeam = expectedRound % 2 === 0 ? maximum - expectedPick + 1 : expectedPick;
    if (overall !== index + 1 || round !== expectedRound || pickInRound !== expectedPick || teamNumber !== expectedTeam) throw new Error("Historical team count is not stored and the snake structure is inconsistent. Re-run with --teams=<number>.");
  }
  return maximum;
}

function validateHistoricalPicks(values: unknown[], teamCount: number, rounds: number): DraftPick[] {
  const expectedPicks = teamCount * rounds;
  if (values.length !== expectedPicks) throw new Error(`Draft is incomplete (${values.length}/${expectedPicks} picks); only completed drafts are market evidence.`);
  const picks = values.map((value, index) => {
    if (!record(value) || typeof value.playerId !== "string" || !value.playerId.trim()) throw new Error(`Pick ${index + 1} is missing a playerId.`);
    const overallPick = validPositiveInteger(value.overallPick), round = validPositiveInteger(value.round), pickInRound = validPositiveInteger(value.pickInRound), teamNumber = validPositiveInteger(value.teamNumber);
    if (!overallPick || !round || !pickInRound || !teamNumber) throw new Error(`Pick ${index + 1} has invalid structural metadata.`);
    const expectedRound = Math.ceil((index + 1) / teamCount), expectedPick = ((index) % teamCount) + 1, expectedTeam = expectedRound % 2 === 0 ? teamCount - expectedPick + 1 : expectedPick;
    if (overallPick !== index + 1 || round !== expectedRound || pickInRound !== expectedPick || teamNumber !== expectedTeam) throw new Error(`Pick ${index + 1} violates the expected ${teamCount}-team snake order.`);
    const pickProvenance = value.pickProvenance === "SYNTHETIC_PADDING" || value.pickProvenance === "MANUAL_EXTENSION" ? value.pickProvenance : Boolean(value.isMyTeam) ? "USER_REAL_PICK" : "OBSERVED_ROOM";
    if (pickProvenance === "SYNTHETIC_PADDING" || pickProvenance === "MANUAL_EXTENSION") throw new Error(`Pick ${index + 1} is synthetic/manual-extension data and is not eligible for market learning.`);
    return { overallPick, round, pickInRound, teamNumber, playerId: value.playerId.trim(), isMyTeam: Boolean(value.isMyTeam), pickProvenance: pickProvenance as DraftPick["pickProvenance"] };
  });
  if (new Set(picks.map((pick) => pick.playerId)).size !== picks.length) throw new Error("Draft contains duplicate player selections.");
  return picks;
}

function embeddedPositiveInteger(values: unknown[], label: string): number | undefined {
  const unique = [...new Set(values.map(validPositiveInteger).filter((value): value is number => value !== undefined))];
  if (unique.length > 1) throw new Error(`Historical embedded ${label} metadata is inconsistent.`);
  return unique[0];
}

function observedRoundHint(values: unknown[]): number | undefined {
  const rounds = values.flatMap((value) => record(value) ? [validPositiveInteger(value.round)] : []).filter((value): value is number => value !== undefined);
  return rounds.length ? Math.max(...rounds) : undefined;
}

function nestedPositiveInteger(value: Record<string, unknown>, key: string, nestedKey: string): number | undefined { return record(value[key]) ? validPositiveInteger(value[key][nestedKey]) : undefined; }

function makeMock(values: unknown[], teamCount: number, rounds: number, format: MarketFormat): MockDraftRecord {
  const picks: DraftPick[] = values.flatMap((value, index) => {
    if (!record(value) || typeof value.playerId !== "string" || !value.playerId.trim()) return [];
    const overallPick = typeof value.overallPick === "number" ? value.overallPick : index + 1;
    const round = Math.ceil(overallPick / teamCount), pickInRound = ((overallPick - 1) % teamCount) + 1;
    const reverse = round % 2 === 0;
    return [{ overallPick, round, pickInRound, teamNumber: reverse ? teamCount - pickInRound + 1 : pickInRound, playerId: value.playerId.trim(), isMyTeam: Boolean(value.isMyTeam), pickProvenance: (value.pickProvenance === "SYNTHETIC_PADDING" || value.pickProvenance === "MANUAL_EXTENSION" ? value.pickProvenance : Boolean(value.isMyTeam) ? "USER_REAL_PICK" : "OBSERVED_ROOM") as DraftPick["pickProvenance"] }];
  });
  return { teamCount, rounds, format, picks };
}

export function learnMarketProfiles(players: readonly Player[], drafts: readonly MockDraftRecord[], yahooProfiles: readonly MarketPlayerProfile[] = [], targetConfig?: LeagueConfig): MarketDataSet {
  const yahooById = new Map(yahooProfiles.map((profile) => [profile.playerId, profile]));
  const profiles: MarketPlayerProfile[] = [];
  for (const player of players) {
    const observed: number[] = [], observedOverallPicks: number[] = [], censored: number[] = [];
    const normalizedObservations: NonNullable<MarketPlayerProfile["normalizedObservations"]> = [];
    let weightedSamples = 0;
    for (const draft of drafts) {
      const match = draft.picks.find((pick) => pick.playerId === player.id);
      const formatWeight = draft.format === "points" || draft.format === "unknown" ? 1 : DRAFT_VALUE_CONFIG.market.mismatchFormatWeight;
      const scoringWeight = !targetConfig || !draft.scoringFingerprint || draft.scoringFingerprint === createScoringFingerprint(targetConfig.scoring) ? 1 : DRAFT_VALUE_CONFIG.market.mismatchScoringWeight;
      const weight = formatWeight * scoringWeight;
      if (match) {
        const roundEquivalent = overallPickToRoundEquivalent(match.overallPick, draft.teamCount);
        observed.push(roundEquivalent); observedOverallPicks.push(match.overallPick);
        normalizedObservations.push({ overallPick: match.overallPick, roundEquivalent, teamCount: draft.teamCount, rounds: draft.rounds, rightCensored: false, source: "USER_MOCK" });
      } else {
        censored.push(draft.rounds + 1);
        normalizedObservations.push({ censorThreshold: draft.teamCount * draft.rounds, roundEquivalent: draft.rounds + 1, teamCount: draft.teamCount, rounds: draft.rounds, rightCensored: true, source: "USER_MOCK" });
      }
      weightedSamples += weight;
    }
    const yahoo = yahooById.get(player.id);
    if (!observed.length && !censored.length && !yahoo) continue;
    const normalizedPickValues = normalizedObservations.filter((entry) => !entry.rightCensored).map((entry) => entry.overallPick!).filter((pick) => Number.isFinite(pick));
    const sorted = [...normalizedPickValues].sort((a, b) => a - b);
    const yahooRound = yahoo?.yahooADP && targetConfig ? overallPickToRoundEquivalent(yahoo.yahooADP, targetConfig.teamCount) : yahoo?.yahooPreRank && targetConfig ? overallPickToRoundEquivalent(yahoo.yahooPreRank, targetConfig.teamCount) : undefined;
    const prior = yahoo?.yahooADP ?? yahoo?.yahooPreRank ?? (targetConfig ? roundEquivalentToOverallPick(DRAFT_VALUE_CONFIG.market.broadPriorRound, targetConfig.teamCount) : 120);
    const empiricalMean = normalizedPickValues.length ? normalizedPickValues.reduce((sum, value) => sum + value, 0) / normalizedPickValues.length : prior;
    const hasEstimate = observed.length >= 2 || yahooRound !== undefined;
    const priorWeight = yahooRound === undefined ? DRAFT_VALUE_CONFIG.market.empiricalPriorSamples : DRAFT_VALUE_CONFIG.market.yahooPriorWeight;
    const shrunk = hasEstimate ? (empiricalMean * weightedSamples + prior * priorWeight) / Math.max(.001, weightedSamples + priorWeight) : undefined;
    profiles.push({ ...yahoo, playerId: player.id, ...(shrunk === undefined ? {} : { mockRoundEquivalentMedian: targetConfig ? overallPickToRoundEquivalent(shrunk, targetConfig.teamCount) : undefined, mockRoundEquivalentLow: targetConfig ? overallPickToRoundEquivalent(sorted.length >= 3 ? quantile(sorted, .25) : Math.max(1, shrunk - 20), targetConfig.teamCount) : undefined, mockRoundEquivalentHigh: targetConfig ? overallPickToRoundEquivalent(sorted.length >= 3 ? quantile(sorted, .75) : shrunk + 20, targetConfig.teamCount) : undefined, mockMedianPick: shrunk, mockMeanPick: empiricalMean }), sampleCount: drafts.length, format: "points", scoringFingerprint: targetConfig ? createScoringFingerprint(targetConfig.scoring) : undefined, updatedAt: new Date().toISOString(), source: yahoo ? "mock history + Yahoo prior" : "mock history observation", observedRoundEquivalents: observed, observedOverallPicks, rightCensoredRoundEquivalents: censored, normalizedObservations });
  }
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), mockDraftCount: drafts.length, yahooRanksLoaded: yahooProfiles.length, matchingScoringSamples: targetConfig ? drafts.filter((draft) => !draft.scoringFingerprint || draft.scoringFingerprint === createScoringFingerprint(targetConfig.scoring)).length : 0, profiles, warnings: [] };
}

export function calculateMarketTiming(profile: MarketPlayerProfile | undefined, config: LeagueConfig, currentPick: number, nextUserPick: number | null, modelValueRank: number, modelPoolSize: number, draftPicks: readonly DraftPick[] = [], player?: Player, playerPool: readonly Player[] = [], liveRoomSurvivalEvidence = 0, intrinsicValueRank = modelValueRank): MarketTimingProjection {
  void draftPicks; void player; void playerPool; void nextUserPick;
  if (!profile) return modelOnlyTiming(currentPick, nextUserPick, modelValueRank, modelPoolSize, liveRoomSurvivalEvidence);
  const observations = absoluteMarketObservations(profile, config);
  const exact = observations.filter((entry) => !entry.rightCensored), censored = observations.filter((entry) => entry.rightCensored);
  const schedule = getUserPickSchedule(currentPick, config).remainingUserPicks;
  if (!schedule.length) return zeroTiming(profile, modelValueRank, liveRoomSurvivalEvidence);
  const estimateValues = exact.map((entry) => entry.overallPick).sort((a, b) => a - b);
  const sample = exact.length + censored.length;
  const storedSample = Math.max(sample, profile.sampleCount ?? 0);
  const yahooAdp = profile.yahooADP ?? profile.yahooPreRank ?? null;
  const localExactEstimate = estimateValues.length ? quantile(estimateValues, .5) : null;
  // Preserve the old low-sample guard: one local observation is directional
  // evidence, not an invented ADP. It becomes a blend input only when Yahoo
  // independently supplies an external timing reference.
  const learnedLocalEstimate = exact.length >= 2
    ? localExactEstimate
    : !observations.length && storedSample >= 2
      ? profile.mockMedianPick ?? (profile.mockRoundEquivalentMedian === undefined ? null : roundEquivalentToOverallPick(profile.mockRoundEquivalentMedian, config.teamCount))
      : null;
  // Yahoo is a stable external timing reference, while completed local mocks remain the
  // stronger evidence as their direct sample grows. We never turn Yahoo ADP into a fake pick.
  const localWeight = localExactEstimate !== null ? Math.min(6, estimateValues.length * .9) : 0;
  const yahooWeight = yahooAdp === null ? 0 : DRAFT_VALUE_CONFIG.market.yahooReferenceWeight;
  const localBlendEstimate = localExactEstimate ?? learnedLocalEstimate;
  const estimate = localBlendEstimate !== null && yahooAdp !== null
    ? (localBlendEstimate * localWeight + yahooAdp * yahooWeight) / Math.max(.001, localWeight + yahooWeight)
    : learnedLocalEstimate ?? yahooAdp;
  const marketSourceGap = localBlendEstimate !== null && yahooAdp !== null ? Math.abs(localBlendEstimate - yahooAdp) : null;
  const marketSourceAgreement = marketSourceGap === null ? null : clamp01(1 - marketSourceGap / 80);
  const yahooSurvivalAt = (pick: number) => yahooAdp === null ? null : clamp01(1 / (1 + Math.exp((pick - yahooAdp) / Math.max(9, config.teamCount * .85))));
  const survivalPath = schedule.map((pick) => {
    const local = survivalAt(observations, pick, liveRoomSurvivalEvidence);
    const yahooSurvival = yahooSurvivalAt(pick);
    if (yahooSurvival === null) return { overallPick: pick, ...local };
    if (!observations.length) return { overallPick: pick, survival: yahooSurvival, evidenceCount: 1 };
    const localSurvivalWeight = Math.min(6, observations.length * .9);
    return { overallPick: pick, survival: clamp01((local.survival * localSurvivalWeight + yahooSurvival * yahooWeight) / Math.max(.001, localSurvivalWeight + yahooWeight)), evidenceCount: local.evidenceCount + 1 };
  });
  const first = survivalPath[0], second = survivalPath[1], third = survivalPath[2];
  const frontier = deriveFrontier(survivalPath);
  const low = estimateValues.length ? quantile(estimateValues, .25) : null, high = estimateValues.length ? quantile(estimateValues, .75) : null;
  const marketConfidence = clamp01(sample / DRAFT_VALUE_CONFIG.market.fullConfidenceSamples * .65 + (estimate !== null ? .12 : 0) + (yahooAdp === null ? 0 : .18) - (marketSourceAgreement === null ? 0 : (1 - marketSourceAgreement) * .18));
  const disagreement = estimateValues.length > 1 ? Math.min(.35, (estimateValues[estimateValues.length - 1] - estimateValues[0]) / 180) : 0;
  const timingDirectionConfidence = clamp01((sample + liveRoomSurvivalEvidence) / 6 * (1 - disagreement));
  const liveWaitCost = calculateLiveWaitCost(currentPick, first.overallPick, first.survival, liveRoomSurvivalEvidence, intrinsicValueRank);
  const wait = frontierWait({ exactCount: exact.length, censoredCount: censored.length, path: survivalPath, frontier, confidence: timingDirectionConfidence, liveWaitCost, intrinsicValueRank });
  const modelEdge = estimate === null ? 0 : estimate - modelValueRank;
  const targetWindow = { censoredSurvivalLowerBound: censored.length ? Math.min(...censored.map((entry) => entry.overallPick)) : null, targetWindowStart: low, targetWindowCenter: estimate, targetWindowEnd: high, targetWindowLowerBound: censored.length ? Math.min(...censored.map((entry) => entry.overallPick)) : null, userTurnsUntilTargetWindow: frontier.userTurnsBeforeFrontier };
  const label: NonNullable<MarketTimingProjection["timingLabel"]> = frontier.acquisitionFrontierPick !== null && frontier.userTurnsBeforeFrontier >= 3 && first.survival >= .62 ? "TARGET LATER" : first.survival < .42 ? "DRAFT NOW" : frontier.acquisitionFrontierPick === first.overallPick ? "WINDOW APPROACHING" : "LIKELY TO SURVIVE";
  const evidenceLevel = sample === 1 && estimate === null ? "VERY_LOW" as const : sample ? marketConfidence < .35 ? "LOW" as const : "MEDIUM" as const : "NONE" as const;
  const edgeEscape = clamp01((DRAFT_VALUE_CONFIG.market.modelEdgeFullStrengthRanks - intrinsicValueRank + 1) / DRAFT_VALUE_CONFIG.market.modelEdgeFullStrengthRanks) * DRAFT_VALUE_CONFIG.market.maxConvictionReachRounds;
  const reachCost = estimate !== null ? Math.max(0, (estimate - currentPick) / Math.max(1, config.teamCount) - edgeEscape) * .1 : 0;
  return { yahooAdp, mockMeanPick: profile.mockMeanPick ?? localBlendEstimate, combinedMarketPickEstimate: estimate, marketSourceGap, marketSourceAgreement, externalHistoricalFantasyPointsPerGame: profile.externalHistoricalFantasyPointsPerGame ?? null, marketPickEstimate: estimate, marketRoundLow: low === null ? null : overallPickToRoundEquivalent(low, config.teamCount), marketRoundHigh: high === null ? null : overallPickToRoundEquivalent(high, config.teamCount), marketConfidence, marketCostRank: estimate, modelValueRank, valueLabel: modelEdge >= 35 ? "SLEEPER" : modelEdge >= 18 ? "MODEL VALUE" : modelEdge <= -20 ? "OVERPRICED" : estimate === null ? "UNKNOWN" : "FAIR", survivalEstimate: Math.round(first.survival * 100), survivalConfidence: first.evidenceCount ? timingDirectionConfidence : .2, survivalSource: yahooAdp !== null && observations.length ? "BLENDED_MARKET" : yahooAdp !== null ? "YAHOO_ADP" : estimate !== null ? "MARKET_HISTORY" : "MODEL_ONLY", survivalLabel: survivalLabel(first.survival, timingDirectionConfidence), draftNowUrgency: frontier.acquisitionFrontierPick === first.overallPick && estimate !== null ? Math.min(2, (1 - first.survival) * 3) : 0, waitValue: wait.historicalWait, reachCost, marketEvidenceLabel: observationLabel(profile, evidenceLevel), marketEvidenceLevel: evidenceLevel, conditionalSurvival: true, liveRoomSurvivalEvidence, liveRoomConfidence: liveRoomConfidence(liveRoomSurvivalEvidence), liveWaitCost, marketPrecisionConfidence: marketConfidence, timingDirectionConfidence, survivalNextTurn: first.survival, survivalTwoTurns: second?.survival ?? 0, survivalThirdTurn: third?.survival ?? 0, waitOpportunityCost: wait.total, timingLabel: label, timingBlend: 1, ...targetWindow, ...wait, futureUserPickSurvival: survivalPath, lastSafeUserPick: frontier.lastSafeUserPick, acquisitionFrontierPick: frontier.acquisitionFrontierPick, userTurnsBeforeFrontier: frontier.userTurnsBeforeFrontier };
}

type AbsoluteObservation = { overallPick: number; rightCensored: boolean; source: string };
function absoluteMarketObservations(profile: MarketPlayerProfile, target: LeagueConfig): AbsoluteObservation[] {
  if (profile.normalizedObservations?.length) return profile.normalizedObservations.flatMap((entry) => {
    const legacyPick = entry.draftProgress === undefined ? undefined : Math.round(entry.draftProgress * Math.max(1, entry.teamCount * entry.rounds - 1) + 1);
    const overallPick = entry.rightCensored ? entry.censorThreshold ?? legacyPick : entry.overallPick ?? legacyPick;
    return overallPick && overallPick > 0 ? [{ overallPick, rightCensored: entry.rightCensored, source: entry.source ?? "USER_MOCK" }] : [];
  });
  return [
    ...(profile.observedOverallPicks ?? profile.observedRoundEquivalents?.map((round) => roundEquivalentToOverallPick(round, target.teamCount)) ?? []).map((overallPick) => ({ overallPick, rightCensored: false, source: "USER_MOCK" })),
    ...(profile.rightCensoredRoundEquivalents ?? []).map((round) => ({ overallPick: roundEquivalentToOverallPick(Math.max(1, round - 1), target.teamCount), rightCensored: true, source: "USER_MOCK" })),
  ];
}
function survivalAt(observations: readonly AbsoluteObservation[], pick: number, liveEvidence: number): { survival: number; evidenceCount: number } {
  const informative = observations.filter((entry) => !entry.rightCensored || entry.overallPick >= pick);
  if (!informative.length) return { survival: liveEvidence ? clamp01(.5 + liveEvidence * .08) : .5, evidenceCount: 0 };
  const survived = informative.filter((entry) => entry.overallPick >= pick).length;
  return { survival: clamp01((survived + 1.5 + liveEvidence * .85) / (informative.length + 3 + liveEvidence * .85)), evidenceCount: informative.length };
}
function deriveFrontier(path: Array<{ overallPick: number; survival: number; evidenceCount: number }>): { lastSafeUserPick: number | null; acquisitionFrontierPick: number | null; userTurnsBeforeFrontier: number } {
  const safe = path.filter((entry) => entry.evidenceCount > 0 && entry.survival >= DRAFT_VALUE_CONFIG.market.acquisitionSafetyThreshold);
  const lastSafeUserPick = safe.length ? safe[safe.length - 1].overallPick : null;
  let acquisitionFrontierPick: number | null = null;
  for (let index = 0; index < path.length - 1; index++) {
    const current = path[index], next = path[index + 1];
    if (current.evidenceCount > 0 && current.survival >= DRAFT_VALUE_CONFIG.market.acquisitionSafetyThreshold && (next.evidenceCount === 0 || next.survival < DRAFT_VALUE_CONFIG.market.acquisitionSafetyThreshold || current.survival - next.survival >= DRAFT_VALUE_CONFIG.market.frontierDangerDrop)) { acquisitionFrontierPick = current.overallPick; break; }
  }
  acquisitionFrontierPick ??= lastSafeUserPick;
  return { lastSafeUserPick, acquisitionFrontierPick, userTurnsBeforeFrontier: acquisitionFrontierPick === null ? 0 : path.findIndex((entry) => entry.overallPick === acquisitionFrontierPick) + 1 };
}
function frontierWait(input: { exactCount: number; censoredCount: number; path: Array<{ overallPick: number; survival: number; evidenceCount: number }>; frontier: ReturnType<typeof deriveFrontier>; confidence: number; liveWaitCost: number; intrinsicValueRank: number }): Pick<MarketTimingProjection, "censorDerivedWait" | "exactMarketDerivedWait" | "liveRoomDerivedWait" | "multiTurnTargetDistanceWait" | "alternativeUrgencyWait"> & { historicalWait: number; total: number } {
  const max = DRAFT_VALUE_CONFIG.market.maximumWaitOpportunityCost;
  const first = input.path[0];
  const survivalStrength = clamp01((first.survival - .5) / .5);
  const distance = clamp01((input.frontier.userTurnsBeforeFrontier - 1) / 3);
  const exactMarketDerivedWait = input.exactCount ? max * .55 * survivalStrength * input.confidence : 0;
  const censorDerivedWait = input.censoredCount ? max * .48 * survivalStrength * input.confidence * Math.min(1, input.censoredCount / 3) : 0;
  const multiTurnTargetDistanceWait = max * .4 * distance * survivalStrength * input.confidence;
  const alternativeUrgencyWait = 0;
  const escape = input.intrinsicValueRank <= DRAFT_VALUE_CONFIG.market.liveWait.eliteRankCutoff ? DRAFT_VALUE_CONFIG.market.liveWait.eliteRankEscape : 0;
  const historicalWait = Math.min(input.exactCount + input.censoredCount <= 1 ? 2 : max, (exactMarketDerivedWait + censorDerivedWait + multiTurnTargetDistanceWait) * (1 - escape));
  return { censorDerivedWait, exactMarketDerivedWait, liveRoomDerivedWait: input.liveWaitCost, multiTurnTargetDistanceWait, alternativeUrgencyWait, historicalWait, total: Math.min(max, historicalWait + input.liveWaitCost) };
}
function zeroTiming(profile: MarketPlayerProfile, rank: number, liveEvidence: number): MarketTimingProjection {
  return { marketPickEstimate: null, marketRoundLow: null, marketRoundHigh: null, marketConfidence: 0, marketCostRank: null, modelValueRank: rank, valueLabel: "UNKNOWN", survivalEstimate: 0, survivalConfidence: 0, survivalSource: "MODEL_ONLY", survivalLabel: "No later user pick", draftNowUrgency: 0, waitValue: 0, reachCost: 0, marketEvidenceLabel: observationLabel(profile, "NONE"), marketEvidenceLevel: "NONE", conditionalSurvival: true, liveRoomSurvivalEvidence: liveEvidence, liveRoomConfidence: 0, liveWaitCost: 0, marketPrecisionConfidence: 0, timingDirectionConfidence: 0, survivalNextTurn: 0, survivalTwoTurns: 0, survivalThirdTurn: 0, waitOpportunityCost: 0, timingLabel: "DRAFT NOW", timingBlend: 0, censoredSurvivalLowerBound: null, targetWindowStart: null, targetWindowCenter: null, targetWindowEnd: null, targetWindowLowerBound: null, userTurnsUntilTargetWindow: 0, censorDerivedWait: 0, exactMarketDerivedWait: 0, liveRoomDerivedWait: 0, multiTurnTargetDistanceWait: 0, alternativeUrgencyWait: 0, futureUserPickSurvival: [], lastSafeUserPick: null, acquisitionFrontierPick: null, userTurnsBeforeFrontier: 0 };
}

function modelOnlyTiming(currentPick: number, nextPick: number | null, rank: number, _pool: number, liveRoomSurvivalEvidence = 0): MarketTimingProjection {
  if (nextPick === null) return { marketPickEstimate: null, marketRoundLow: null, marketRoundHigh: null, marketConfidence: 0, marketCostRank: null, modelValueRank: rank, valueLabel: "UNKNOWN", survivalEstimate: 0, survivalConfidence: .15, survivalSource: "MODEL_ONLY", survivalLabel: "No later user pick", draftNowUrgency: 0, waitValue: 0, reachCost: 0, marketEvidenceLabel: "No market evidence", marketEvidenceLevel: "NONE", conditionalSurvival: true, liveRoomSurvivalEvidence, liveRoomConfidence: liveRoomConfidence(liveRoomSurvivalEvidence), liveWaitCost: 0, marketPrecisionConfidence: 0, timingDirectionConfidence: 0, survivalNextTurn: 0, survivalTwoTurns: 0, waitOpportunityCost: 0, timingLabel: "DRAFT NOW" };
  const scale = Math.max(6, (nextPick - currentPick) * .55);
  let survival = clamp01(1 / (1 + Math.exp(-(rank - (nextPick - currentPick)) / scale)));
  if (liveRoomSurvivalEvidence) survival = Math.max(survival, Math.min(.9, .68 + liveRoomSurvivalEvidence * .08));
  const liveWaitCost = calculateLiveWaitCost(currentPick, nextPick, survival, liveRoomSurvivalEvidence, rank);
  const waitOpportunityCost = Math.min(DRAFT_VALUE_CONFIG.market.maximumWaitOpportunityCost, liveWaitCost + Math.max(0, survival - .75) * 4);
  return { marketPickEstimate: null, marketRoundLow: null, marketRoundHigh: null, marketConfidence: 0, marketCostRank: null, modelValueRank: rank, valueLabel: "UNKNOWN", survivalEstimate: Math.round(survival * 100), survivalConfidence: Math.max(.2, liveRoomConfidence(liveRoomSurvivalEvidence)), survivalSource: "MODEL_ONLY", survivalLabel: survivalLabel(survival, .2), draftNowUrgency: (1 - survival) * 3, waitValue: Math.max(0, waitOpportunityCost - liveWaitCost), reachCost: 0, marketEvidenceLabel: "No market evidence", marketEvidenceLevel: "NONE", conditionalSurvival: true, liveRoomSurvivalEvidence, liveRoomConfidence: liveRoomConfidence(liveRoomSurvivalEvidence), liveWaitCost, marketPrecisionConfidence: 0, timingDirectionConfidence: liveRoomConfidence(liveRoomSurvivalEvidence), survivalNextTurn: survival, survivalTwoTurns: Math.max(0, survival - .12), waitOpportunityCost, timingLabel: timingLabel(survival, waitOpportunityCost, nextPick), timingBlend: smoothTimingBlend(currentPick / Math.max(currentPick + Math.max(1, nextPick - currentPick), 1)) };
}
function deriveTargetWindow(observations: readonly { progress: number; rightCensored: boolean }[], config: LeagueConfig, currentPick: number, blendedRound: number | undefined): Pick<MarketTimingProjection, "censoredSurvivalLowerBound" | "targetWindowStart" | "targetWindowCenter" | "targetWindowEnd" | "targetWindowLowerBound" | "userTurnsUntilTargetWindow"> {
  const exact = observations.filter((entry) => !entry.rightCensored).map((entry) => entry.progress).sort((left, right) => left - right);
  const censored = observations.filter((entry) => entry.rightCensored).map((entry) => entry.progress).sort((left, right) => left - right);
  const fromProgress = (progress: number | undefined) => progress === undefined ? null : progressToOverallPick(progress, config);
  const startProgress = exact.length ? quantile(exact, .25) : blendedRound === undefined ? undefined : normalizeDraftProgress(roundEquivalentToOverallPick(blendedRound, config.teamCount), config.teamCount, config.rounds);
  const centerProgress = exact.length ? quantile(exact, .5) : blendedRound === undefined ? undefined : normalizeDraftProgress(roundEquivalentToOverallPick(blendedRound, config.teamCount), config.teamCount, config.rounds);
  const endProgress = exact.length ? quantile(exact, .75) : blendedRound === undefined ? undefined : normalizeDraftProgress(roundEquivalentToOverallPick(blendedRound, config.teamCount), config.teamCount, config.rounds);
  const lowerBoundProgress = censored.length ? censored[0] : undefined;
  const targetPick = fromProgress(startProgress ?? lowerBoundProgress);
  const userTurnsUntilTargetWindow = targetPick === null
    ? null
    : getMyOverallPicks(config).filter((pick) => pick > currentPick && pick <= targetPick).length;
  return { censoredSurvivalLowerBound: lowerBoundProgress ?? null, targetWindowStart: fromProgress(startProgress), targetWindowCenter: fromProgress(centerProgress), targetWindowEnd: fromProgress(endProgress), targetWindowLowerBound: fromProgress(lowerBoundProgress), userTurnsUntilTargetWindow };
}
function calculateWaitBreakdown(input: { exactCount: number; censoredCount: number; survivalNextTurn: number; survivalTwoTurns: number; timingDirectionConfidence: number; timingBlend: number; userTurnsUntilTargetWindow: number | null; liveRoomDerivedWait: number; intrinsicValueRank: number }): Pick<MarketTimingProjection, "censorDerivedWait" | "exactMarketDerivedWait" | "liveRoomDerivedWait" | "multiTurnTargetDistanceWait" | "alternativeUrgencyWait"> & { historicalWait: number; total: number } {
  const maximum = DRAFT_VALUE_CONFIG.market.maximumWaitOpportunityCost;
  const survival = Math.min(input.survivalNextTurn, input.survivalTwoTurns || input.survivalNextTurn);
  const survivalStrength = clamp01((survival - .55) / .45);
  const directionStrength = .3 + input.timingDirectionConfidence * .7;
  const turns = input.userTurnsUntilTargetWindow ?? 0;
  const distanceStrength = clamp01((turns - 1) / 3);
  const exactMarketDerivedWait = input.exactCount ? maximum * .62 * survivalStrength * directionStrength : 0;
  const censorDerivedWait = input.censoredCount ? maximum * .58 * survivalStrength * directionStrength * Math.min(1, input.censoredCount / 3) : 0;
  const multiTurnTargetDistanceWait = (input.exactCount || input.censoredCount) && turns > 1 ? maximum * .32 * survivalStrength * directionStrength * distanceStrength : 0;
  const alternativeUrgencyWait = 0;
  const modelEdgeEscape = input.intrinsicValueRank <= DRAFT_VALUE_CONFIG.market.liveWait.eliteRankCutoff
    ? DRAFT_VALUE_CONFIG.market.liveWait.eliteRankEscape
    : 0;
  const historicalWait = Math.min(maximum, (exactMarketDerivedWait + censorDerivedWait + multiTurnTargetDistanceWait + alternativeUrgencyWait) * input.timingBlend * (1 - modelEdgeEscape));
  const total = Math.min(maximum, historicalWait + input.liveRoomDerivedWait);
  return { censorDerivedWait, exactMarketDerivedWait, liveRoomDerivedWait: input.liveRoomDerivedWait, multiTurnTargetDistanceWait, alternativeUrgencyWait, historicalWait, total };
}
function normalizedMarketObservations(profile: MarketPlayerProfile, target: LeagueConfig): Array<{ progress: number; rightCensored: boolean }> {
  if (profile.normalizedObservations?.length) return profile.normalizedObservations.map((entry) => ({ progress: clamp01(entry.draftProgress ?? 0), rightCensored: entry.rightCensored }));
  // Legacy profiles did not preserve source dimensions. Their round-equivalent is
  // still reusable as an explicitly lower-confidence, target-config approximation.
  return [
    ...(profile.observedRoundEquivalents ?? []).map((round) => ({ progress: clamp01((round - 1) / Math.max(1, target.rounds - 1)), rightCensored: false })),
    ...(profile.rightCensoredRoundEquivalents ?? []).map((round) => ({ progress: clamp01((round - 1) / Math.max(1, target.rounds - 1)), rightCensored: true })),
  ];
}
function shrunkSurvival(observations: readonly { progress: number; rightCensored: boolean }[], threshold: number, liveEvidence: number, centerRound?: number, currentRound?: number, precision = 0, rounds = 15): number {
  const eligible = observations.filter((entry) => entry.rightCensored || entry.progress >= 0);
  if (eligible.length) {
    const survived = eligible.filter((entry) => entry.progress >= threshold).length;
    // Beta(1.5, 1.5): transparent conservative shrinkage for small samples.
    return clamp01((survived + 1.5 + liveEvidence * .85) / (eligible.length + 3 + liveEvidence * .85));
  }
  if (centerRound !== undefined && currentRound !== undefined) {
    const targetRound = 1 + threshold * Math.max(1, rounds - 1);
    const spread = 1.1 + (1 - precision) * 2.5;
    return clamp01(1 / (1 + Math.exp(-(centerRound - targetRound) / spread)));
  }
  return liveEvidence ? clamp01((1.5 + liveEvidence * .85) / (3 + liveEvidence * .85)) : .5;
}
function smoothTimingBlend(progress: number): number { return .15 + .85 * clamp01((clamp01(progress) - .35) / .25) ** .8; }
function timingLabel(survival: number, wait: number, nextPick: number | null): "DRAFT NOW" | "WINDOW APPROACHING" | "LIKELY TO SURVIVE" | "TARGET LATER" { if (nextPick === null || survival < .38) return "DRAFT NOW"; if (wait >= 7 && survival >= .78) return "TARGET LATER"; return survival >= .62 ? "LIKELY TO SURVIVE" : "WINDOW APPROACHING"; }
function calculateLiveWaitCost(currentPick: number, nextPick: number | null, survival: number, evidence: number, rank: number): number {
  if (nextPick === null || evidence <= 0 || survival < DRAFT_VALUE_CONFIG.market.liveWait.minimumSurvivalEvidence) return 0;
  const config = DRAFT_VALUE_CONFIG.market.liveWait;
  const turnStrength = Math.min(1, evidence / config.fullEvidenceTurns);
  const windowStrength = Math.min(1, Math.max(0, nextPick - currentPick - 1) / config.fullWindowPicks);
  const survivalStrength = Math.min(1, (survival - config.minimumSurvivalEvidence) / (1 - config.minimumSurvivalEvidence));
  const eliteEscape = rank <= config.eliteRankCutoff ? 1 - config.eliteRankEscape * (config.eliteRankCutoff - rank + 1) / config.eliteRankCutoff : 1;
  return Math.min(config.maximumPenalty, config.maximumPenalty * turnStrength * windowStrength * survivalStrength * eliteEscape);
}
function liveRoomConfidence(evidence: number): number { return Math.min(.9, evidence / DRAFT_VALUE_CONFIG.market.liveWait.fullEvidenceTurns * .85); }
function observationLabel(profile: MarketPlayerProfile, level: MarketTimingProjection["marketEvidenceLevel"]): string {
  const exactCount = profile.normalizedObservations?.filter((entry) => !entry.rightCensored).length ?? profile.observedRoundEquivalents?.length ?? 0;
  const censoredCount = profile.normalizedObservations?.filter((entry) => entry.rightCensored).length ?? profile.rightCensoredRoundEquivalents?.length ?? 0;
  const pick = profile.observedOverallPicks?.[0];
  if (exactCount === 0 && censoredCount > 0) return `Undrafted in ${censoredCount} tracked mock${censoredCount === 1 ? "" : "s"}`;
  if (exactCount === 1 && censoredCount > 0) return `1 late pick + ${censoredCount} undrafted observation${censoredCount === 1 ? "" : "s"}`;
  if (pick !== undefined && exactCount === 1) return `Picked #${pick} once (${level.replace("_", " ")})`;
  if (exactCount === 1 && profile.observedRoundEquivalents?.[0] !== undefined) return `Picked around R${profile.observedRoundEquivalents[0].toFixed(1)} once (${level.replace("_", " ")})`;
  return level === "NONE" ? "No market evidence" : `${profile.sampleCount ?? 0} market observations (${level.replace("_", " ")})`;
}
function lowSampleSurvivalLabel(value: number): string { return value >= .7 ? "Likely to survive (very low confidence)" : value <= .35 ? "May not survive (very low confidence)" : "Uncertain (very low confidence)"; }
function calculateRoomPaceAdjustment(picks: readonly DraftPick[], player: Player | undefined, playerPool: readonly Player[], config: LeagueConfig): number {
  if (!player || picks.length < DRAFT_VALUE_CONFIG.market.minimumRoomAdaptationPicks || !player.yahooPositions.length) return 0;
  const recent = picks.slice(-Math.min(24, picks.length));
  const byId = new Map(playerPool.map((candidate) => [candidate.id, candidate]));
  const expectedRate = playerPool.filter((candidate) => candidate.yahooPositions.some((position) => player.yahooPositions.includes(position))).length / Math.max(1, playerPool.length);
  const actualRate = recent.filter((pick) => byId.get(pick.playerId)?.yahooPositions.some((position) => player.yahooPositions.includes(position))).length / recent.length;
  const evidence = Math.min(1, (recent.length - DRAFT_VALUE_CONFIG.market.minimumRoomAdaptationPicks + 1) / 20);
  return Math.max(-DRAFT_VALUE_CONFIG.market.maximumRoomPaceRounds, Math.min(DRAFT_VALUE_CONFIG.market.maximumRoomPaceRounds, -(actualRate - expectedRate) * config.rounds * .35 * evidence));
}
function survivalLabel(value: number, confidenceValue: number): string { if (confidenceValue < .35) return value >= .65 ? "May survive (low confidence)" : value <= .35 ? "May not survive (low confidence)" : "Uncertain (low confidence)"; return value >= .8 ? "Very likely to survive" : value >= .62 ? "Likely to survive" : value >= .42 ? "Toss-up" : value >= .22 ? "Unlikely to survive" : "Very unlikely to survive"; }
function confidence(samples: number): number { return clamp01(samples / DRAFT_VALUE_CONFIG.market.fullConfidenceSamples); }
function quantile(values: number[], p: number): number { return values[Math.floor((values.length - 1) * p)]; }
function trim(value: number): string { return Number(value.toFixed(4)).toString(); }
function finite(value: unknown, label: string): number { if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative finite number.`); return value; }
function integer(value: unknown, fallback: number): number { return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback; }
function validPositiveInteger(value: unknown): number | undefined { return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function clamp01(value: number): number { return Math.min(1, Math.max(0, value)); }

// Retained exported-compatible legacy helpers keep older serialized traces readable;
// all new timing goes through absoluteMarketObservations/survivalAt above.
void [deriveTargetWindow, calculateWaitBreakdown, normalizedMarketObservations, shrunkSurvival, lowSampleSurvivalLabel, calculateRoomPaceAdjustment, confidence];
