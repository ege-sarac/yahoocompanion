import { DRAFT_VALUE_CONFIG } from "../config/draftValueConfig";
import type { DraftPick, LeagueConfig, MarketDataSet, MarketFormat, MarketPlayerProfile, MarketTimingProjection, MockDraftRecord, Player } from "../types";

export function createScoringFingerprint(scoring: LeagueConfig["scoring"]): string {
  return (Object.keys(scoring) as Array<keyof typeof scoring>).sort().map((key) => `${key}:${trim(scoring[key])}`).join("|");
}
export function createRosterFingerprint(config: LeagueConfig): string { return `teams:${config.teamCount}|rounds:${config.rounds}|G:${config.roster.G}|F:${config.roster.F}|C:${config.roster.C}|UTIL:${config.roster.UTIL}|BN:${config.roster.BN}`; }
export function overallPickToRoundEquivalent(overallPick: number, teamCount: number): number { return ((overallPick - 1) / teamCount) + 1; }
export function roundEquivalentToOverallPick(roundEquivalent: number, teamCount: number): number { return Math.max(1, Math.round((roundEquivalent - 1) * teamCount + 1)); }

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
  for (const key of ["yahooPreRank", "yahooADP", "mockMedianPick", "mockMeanPick", "mockRoundEquivalentMedian", "mockRoundEquivalentLow", "mockRoundEquivalentHigh", "sampleCount"] as const) if (value[key] !== undefined) output[key] = finite(value[key], key);
  if (value.format !== undefined) { if (!["points", "category", "unknown"].includes(String(value.format))) throw new Error("Invalid market format."); output.format = value.format as MarketFormat; }
  for (const key of ["scoringFingerprint", "updatedAt", "source"] as const) if (typeof value[key] === "string") output[key] = value[key];
  for (const key of ["observedRoundEquivalents", "rightCensoredRoundEquivalents"] as const) if (value[key] !== undefined) { if (!Array.isArray(value[key]) || value[key].some((item) => typeof item !== "number" || !Number.isFinite(item))) throw new Error(`${key} must contain finite numbers.`); output[key] = [...value[key]] as number[]; }
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
    return { overallPick, round, pickInRound, teamNumber, playerId: value.playerId.trim(), isMyTeam: Boolean(value.isMyTeam) };
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
    return [{ overallPick, round, pickInRound, teamNumber: reverse ? teamCount - pickInRound + 1 : pickInRound, playerId: value.playerId.trim(), isMyTeam: Boolean(value.isMyTeam) }];
  });
  return { teamCount, rounds, format, picks };
}

export function learnMarketProfiles(players: readonly Player[], drafts: readonly MockDraftRecord[], yahooProfiles: readonly MarketPlayerProfile[] = [], targetConfig?: LeagueConfig): MarketDataSet {
  const yahooById = new Map(yahooProfiles.map((profile) => [profile.playerId, profile]));
  const profiles: MarketPlayerProfile[] = [];
  for (const player of players) {
    const observed: number[] = [], censored: number[] = [];
    let weightedSamples = 0;
    for (const draft of drafts) {
      const match = draft.picks.find((pick) => pick.playerId === player.id);
      const formatWeight = draft.format === "points" || draft.format === "unknown" ? 1 : DRAFT_VALUE_CONFIG.market.mismatchFormatWeight;
      const scoringWeight = !targetConfig || !draft.scoringFingerprint || draft.scoringFingerprint === createScoringFingerprint(targetConfig.scoring) ? 1 : DRAFT_VALUE_CONFIG.market.mismatchScoringWeight;
      const weight = formatWeight * scoringWeight;
      if (match) observed.push(overallPickToRoundEquivalent(match.overallPick, draft.teamCount));
      else censored.push(draft.rounds + 1);
      weightedSamples += weight;
    }
    const yahoo = yahooById.get(player.id);
    if (!observed.length && !censored.length && !yahoo) continue;
    const sorted = [...observed].sort((a, b) => a - b);
    const yahooRound = yahoo?.yahooADP && targetConfig ? overallPickToRoundEquivalent(yahoo.yahooADP, targetConfig.teamCount) : yahoo?.yahooPreRank && targetConfig ? overallPickToRoundEquivalent(yahoo.yahooPreRank, targetConfig.teamCount) : undefined;
    const prior = yahooRound ?? DRAFT_VALUE_CONFIG.market.broadPriorRound;
    const empiricalMean = observed.length ? observed.reduce((sum, value) => sum + value, 0) / observed.length : prior;
    const priorWeight = yahooRound === undefined ? DRAFT_VALUE_CONFIG.market.empiricalPriorSamples : DRAFT_VALUE_CONFIG.market.yahooPriorWeight;
    const shrunk = (empiricalMean * weightedSamples + prior * priorWeight) / Math.max(.001, weightedSamples + priorWeight);
    profiles.push({ ...yahoo, playerId: player.id, mockRoundEquivalentMedian: shrunk, mockRoundEquivalentLow: sorted.length >= 3 ? quantile(sorted, .25) : Math.max(1, shrunk - DRAFT_VALUE_CONFIG.market.broadPriorSpreadRounds * (1 - confidence(weightedSamples)) * .5), mockRoundEquivalentHigh: sorted.length >= 3 ? quantile(sorted, .75) : shrunk + DRAFT_VALUE_CONFIG.market.broadPriorSpreadRounds * (1 - confidence(weightedSamples)) * .5, mockMedianPick: targetConfig ? roundEquivalentToOverallPick(shrunk, targetConfig.teamCount) : undefined, mockMeanPick: targetConfig ? roundEquivalentToOverallPick(empiricalMean, targetConfig.teamCount) : undefined, sampleCount: drafts.length, format: "points", scoringFingerprint: targetConfig ? createScoringFingerprint(targetConfig.scoring) : undefined, updatedAt: new Date().toISOString(), source: yahoo ? "mock history + Yahoo prior" : "mock history", observedRoundEquivalents: observed, rightCensoredRoundEquivalents: censored });
  }
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), mockDraftCount: drafts.length, yahooRanksLoaded: yahooProfiles.length, matchingScoringSamples: targetConfig ? drafts.filter((draft) => !draft.scoringFingerprint || draft.scoringFingerprint === createScoringFingerprint(targetConfig.scoring)).length : 0, profiles, warnings: [] };
}

export function calculateMarketTiming(profile: MarketPlayerProfile | undefined, config: LeagueConfig, currentPick: number, nextUserPick: number | null, modelValueRank: number, modelPoolSize: number, draftPicks: readonly DraftPick[] = [], player?: Player, playerPool: readonly Player[] = []): MarketTimingProjection {
  if (!profile) return modelOnlyTiming(currentPick, nextUserPick, modelValueRank, modelPoolSize);
  const mockRound = profile.mockRoundEquivalentMedian;
  const yahooPick = profile.yahooADP ?? profile.yahooPreRank;
  const yahooRound = yahooPick ? overallPickToRoundEquivalent(yahooPick, config.teamCount) : undefined;
  const sample = profile.sampleCount ?? profile.observedRoundEquivalents?.length ?? 0;
  const marketConfidence = clamp01((sample / DRAFT_VALUE_CONFIG.market.fullConfidenceSamples) * .75 + (yahooRound ? .2 : 0));
  const blendedRound = mockRound !== undefined && yahooRound !== undefined ? mockRound * (.55 + marketConfidence * .25) + yahooRound * (.45 - marketConfidence * .25) : mockRound ?? yahooRound!;
  const roomAdjustment = calculateRoomPaceAdjustment(draftPicks, player, playerPool, config);
  const adjustedRound = Math.max(1, blendedRound + roomAdjustment);
  const estimate = roundEquivalentToOverallPick(adjustedRound, config.teamCount);
  const nextRound = nextUserPick === null ? null : overallPickToRoundEquivalent(nextUserPick, config.teamCount);
  const survivalEstimate = nextRound === null ? 0 : empiricalSurvival(profile, nextRound, adjustedRound, marketConfidence);
  const survivalSource = mockRound !== undefined && yahooRound !== undefined ? "BLENDED_MARKET" as const : mockRound !== undefined ? "MARKET_HISTORY" as const : "YAHOO_ADP" as const;
  const survivalConfidence = clamp01(marketConfidence * (profile.observedRoundEquivalents?.length ? 1 : .72));
  const currentRound = overallPickToRoundEquivalent(currentPick, config.teamCount);
  const roundsEarly = adjustedRound - currentRound;
  const modelEdge = estimate - modelValueRank;
  const escapeRounds = DRAFT_VALUE_CONFIG.market.maxConvictionReachRounds * clamp01(modelEdge / DRAFT_VALUE_CONFIG.market.modelEdgeFullStrengthRanks) * marketConfidence;
  const effectiveEarly = Math.max(0, roundsEarly - escapeRounds);
  const reachCost = Math.min(DRAFT_VALUE_CONFIG.market.maximumReachPenalty, effectiveEarly / Math.max(1, DRAFT_VALUE_CONFIG.market.maxConvictionReachRounds) * DRAFT_VALUE_CONFIG.market.maximumReachPenalty);
  const waitValue = survivalEstimate >= DRAFT_VALUE_CONFIG.market.waitLikelyThreshold ? Math.min(DRAFT_VALUE_CONFIG.market.maximumWaitPenalty, (survivalEstimate - DRAFT_VALUE_CONFIG.market.waitLikelyThreshold) / (1 - DRAFT_VALUE_CONFIG.market.waitLikelyThreshold) * DRAFT_VALUE_CONFIG.market.maximumWaitPenalty) : 0;
  const urgency = survivalEstimate <= DRAFT_VALUE_CONFIG.market.urgencyLikelyThreshold ? Math.min(DRAFT_VALUE_CONFIG.market.maximumUrgencyBonus, (DRAFT_VALUE_CONFIG.market.urgencyLikelyThreshold - survivalEstimate) / DRAFT_VALUE_CONFIG.market.urgencyLikelyThreshold * DRAFT_VALUE_CONFIG.market.maximumUrgencyBonus) : 0;
  return { marketPickEstimate: estimate, marketRoundLow: profile.mockRoundEquivalentLow ?? Math.max(1, adjustedRound - 1.5), marketRoundHigh: profile.mockRoundEquivalentHigh ?? adjustedRound + 1.5, marketConfidence, marketCostRank: estimate, modelValueRank, valueLabel: modelEdge >= 35 ? "SLEEPER" : modelEdge >= 18 ? "MODEL VALUE" : modelEdge <= -20 ? "OVERPRICED" : "FAIR", survivalEstimate: Math.round(survivalEstimate * 100), survivalConfidence, survivalSource, survivalLabel: survivalLabel(survivalEstimate, survivalConfidence), draftNowUrgency: urgency, waitValue, reachCost };
}

function modelOnlyTiming(currentPick: number, nextPick: number | null, rank: number, _pool: number): MarketTimingProjection {
  if (nextPick === null) return { marketPickEstimate: null, marketRoundLow: null, marketRoundHigh: null, marketConfidence: 0, marketCostRank: null, modelValueRank: rank, valueLabel: "UNKNOWN", survivalEstimate: 0, survivalConfidence: .15, survivalSource: "MODEL_ONLY", survivalLabel: "No later user pick", draftNowUrgency: 0, waitValue: 0, reachCost: 0 };
  const scale = Math.max(6, (nextPick - currentPick) * .55);
  const survival = clamp01(1 / (1 + Math.exp(-(rank - (nextPick - currentPick)) / scale)));
  return { marketPickEstimate: null, marketRoundLow: null, marketRoundHigh: null, marketConfidence: 0, marketCostRank: null, modelValueRank: rank, valueLabel: "UNKNOWN", survivalEstimate: Math.round(survival * 100), survivalConfidence: .2, survivalSource: "MODEL_ONLY", survivalLabel: survivalLabel(survival, .2), draftNowUrgency: (1 - survival) * 3, waitValue: 0, reachCost: 0 };
}
function empiricalSurvival(profile: MarketPlayerProfile, nextRound: number, center: number, confidenceValue: number): number {
  const observed = profile.observedRoundEquivalents ?? [], censored = profile.rightCensoredRoundEquivalents ?? [];
  if (observed.length + censored.length >= 3) { const survived = observed.filter((pick) => pick >= nextRound).length + censored.filter((end) => end >= nextRound).length; return clamp01((survived + 1) / (observed.length + censored.length + 2)); }
  const spread = 1.1 + (1 - confidenceValue) * 2.5;
  return clamp01(1 / (1 + Math.exp(-(center - nextRound) / spread)));
}
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
