import type { InjuryStatus, YahooPosition } from "./player";

export interface PlayerOverride {
  playerId: string;
  yahooPositions: YahooPosition[];
  injuryStatus?: InjuryStatus;
  expectedReturnDate?: string | null;
  notes: string;
}
