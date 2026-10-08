/**
 * Display-only ADP round convention requested for draft-day market labels.
 * #165 in a 16-team room is shown as approximately Round 11.3.
 * This is display-only; market timing remains on absolute overall picks.
 */
export function approximateRoundFromPick(overallPick: number | null | undefined, teamCount: number): number | null {
  if (!Number.isFinite(overallPick) || !Number.isFinite(teamCount) || !overallPick || teamCount <= 0) return null;
  return 1 + ((overallPick - 1) / teamCount);
}

export function formatYahooAdp(overallPick: number | null | undefined, teamCount: number): string {
  const round = approximateRoundFromPick(overallPick, teamCount);
  return round === null ? "CADP —" : `CADP #${overallPick!.toFixed(1)} · ~R${round.toFixed(1)}`;
}
