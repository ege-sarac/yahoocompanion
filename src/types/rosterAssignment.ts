import type { RosterSlot } from "./league";
import type { YahooPosition } from "./player";

export interface RosterAssignmentEntry {
  playerId: string;
  slot: RosterSlot;
  slotIndex: number;
}

export interface RosterAssignmentResult {
  assignments: RosterAssignmentEntry[];
  unassignedPlayerIds: string[];
  isLegal: boolean;
  insufficientPositions: YahooPosition[];
  explanation: string;
}
