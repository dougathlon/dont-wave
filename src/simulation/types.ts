export type DontWavePhase =
  | "briefing"
  | "ready"
  | "green"
  | "reveal"
  | "hunt"
  | "report"
  | "descent"
  | "crossing-ready"
  | "crossing-green"
  | "crossing-red"
  | "death"
  | "complete";

export type OperatorId = "player" | "left" | "right";
export type SideOperatorId = Exclude<OperatorId, "player">;

export type CreatureStatus = "active" | "safe" | "removed";
export type CreaturePose = "idle" | "moving" | "still" | "waving" | "zapped" | "safe";

/** Cosmetic data only. No visual field changes movement, outcomes, hitboxes, or eligibility. */
export interface CreatureVisualDefinition {
  readonly bodyShape: "bean" | "gourd" | "orb" | "slug";
  readonly bodyColor: number;
  readonly accentColor: number;
  readonly eyeCount: 1 | 2 | 3;
  readonly eyeScale: number;
  readonly earStyle: "antennae" | "droop" | "fan" | "horns";
  readonly marking: "belly" | "freckles" | "stripe" | "patch";
  readonly widthScale: number;
  readonly heightScale: number;
  readonly lean: number;
  readonly leftHanded: boolean;
}

export interface CreatureDefinition {
  readonly id: string;
  readonly name: string;
  readonly visual: CreatureVisualDefinition;
}

export interface CreatureRuntimeState extends CreatureDefinition {
  readonly status: CreatureStatus;
  readonly pose: CreaturePose;
  readonly progress: number;
  readonly zappedBy?: OperatorId;
}

export type TurnOutcome = "still" | "waving";

export interface TurnAddress {
  readonly round: number;
  readonly turn: number;
}

export interface TurnRecordProvenance {
  readonly kind: "classical-demo";
  readonly provider: string;
  readonly modelId: "dw-prepared-turn-v3";
  readonly preparedBeforePlay: true;
  readonly bindingMethod: "stable-creature-id";
  readonly integrity: string;
}

export interface TurnRecord {
  readonly schemaVersion: 3;
  readonly id: string;
  readonly bankId: string;
  readonly address: TurnAddress;
  readonly outcomes: Readonly<Record<string, TurnOutcome>>;
  readonly provenance: TurnRecordProvenance;
}

export interface ZapEvent {
  readonly operator: OperatorId;
  readonly creatureId: string;
  readonly huntElapsedMs: number;
  readonly scoreDelta: number;
}

export interface TurnSummary {
  readonly recordId: string;
  readonly bankId: string;
  readonly address: TurnAddress;
  readonly provenance: TurnRecordProvenance;
  readonly greenElapsedMs: number;
  readonly forcedRed: boolean;
  readonly wavingIds: readonly string[];
  readonly stillIds: readonly string[];
  readonly safeIds: readonly string[];
  readonly escapedThisTurn: number;
  readonly unresolvedWavingIds: readonly string[];
  readonly zaps: readonly ZapEvent[];
}

export interface PopulationCounts {
  readonly total: number;
  readonly active: number;
  readonly safe: number;
  readonly removed: number;
  readonly survivors: number;
}

export interface DontWaveState {
  readonly seed: number;
  readonly bankId: string;
  readonly phase: DontWavePhase;
  readonly paused: boolean;
  readonly round: number;
  readonly totalRounds: number;
  readonly turn: number;
  readonly turnsPerRound: number;
  readonly greenElapsedMs: number;
  readonly phaseElapsedMs: number;
  readonly huntRemainingMs: number;
  readonly sideOperatorStartsAtMs: number;
  readonly canTriggerRed: boolean;
  readonly creatures: readonly CreatureRuntimeState[];
  readonly currentRecord: TurnRecord | null;
  readonly revealedWavingIds: readonly string[];
  readonly revealedStillIds: readonly string[];
  readonly revealedSafeIds: readonly string[];
  readonly turnZaps: readonly ZapEvent[];
  readonly forcedRed: boolean;
  readonly history: readonly TurnSummary[];
  readonly counts: PopulationCounts;
  readonly playerScore: number;
  readonly playerHits: number;
  readonly playerMisses: number;
  readonly operatorHits: number;
  readonly leftOperatorHits: number;
  readonly rightOperatorHits: number;
  readonly turnPlayerHits: number;
  readonly turnLeftOperatorHits: number;
  readonly turnRightOperatorHits: number;
  readonly revealedWavers: number;
  readonly wavingRemaining: number;
  readonly turnSafeAtStart: number;
  readonly turnEscaped: number;
  readonly playerProgress: number;
  readonly playerMoving: boolean;
  readonly playerStoppedAtRed: boolean;
  readonly statusMessage: string;
}

export type ZapCreatureResult =
  | {
      readonly accepted: true;
      readonly event: ZapEvent;
    }
  | {
      readonly accepted: false;
      readonly reason: "not-hunting" | "paused" | "unknown-creature" | "not-waving" | "already-zapped";
    };

export interface TurnBank {
  readonly schemaVersion: 3;
  readonly modelId: "dw-prepared-turn-v3";
  readonly bankId: string;
  readonly seed: number;
  readonly creatureIds: readonly string[];
  getRecord(address: TurnAddress): TurnRecord;
  consume(address: TurnAddress): TurnRecord;
  resetConsumption(): void;
  consumedCount(): number;
  recordCount(): number;
}
