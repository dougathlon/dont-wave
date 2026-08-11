export type DontWavePhase =
  | "briefing"
  | "ready"
  | "green"
  | "reveal"
  | "hunt"
  | "rivals"
  | "interturn"
  | "round-break"
  | "final-standings"
  | "descent"
  | "crossing-ready"
  | "crossing-green"
  | "crossing-red"
  | "death"
  | "complete";

export type OperatorId = "player" | "left" | "right";
export type RivalId = Exclude<OperatorId, "player">;
export type ContestantStatus = "active" | "evaporated" | "crossed";
export type ContestantPose = "idle" | "walking" | "still" | "waving";

/** Visual variation never changes speed, outcome eligibility, score, or hitbox size. */
export interface ContestantVisual {
  readonly skinColor: number;
  readonly suitColor: number;
  readonly accentColor: number;
  readonly headScale: number;
  readonly torsoWidth: number;
  readonly torsoHeight: number;
  readonly eyeCount: 1 | 2 | 3;
  readonly armLength: number;
  readonly waveHand: "left" | "right";
  readonly gaitPhase: number;
}

export interface ContestantDefinition {
  readonly id: string;
  readonly slot: number;
  readonly x: number;
  readonly startZ: number;
  readonly visual: ContestantVisual;
}

export interface ContestantState extends ContestantDefinition {
  readonly z: number;
  readonly status: ContestantStatus;
  readonly pose: ContestantPose;
  readonly removedBy?: OperatorId;
  readonly removalReason?: "correct" | "wrong";
}

export interface TurnAddress {
  readonly round: number;
  readonly turn: number;
}

export interface TurnRecordProvenance {
  readonly kind: "classical-demo";
  readonly provider: string;
  readonly modelId: "dw-prepared-turn-v5";
  readonly preparedBeforePlay: true;
  readonly bindingMethod: "stable-contestant-priority";
  readonly integrity: string;
}

export interface TurnRecord {
  readonly schemaVersion: 5;
  readonly id: string;
  readonly bankId: string;
  readonly address: TurnAddress;
  readonly priority: readonly string[];
  readonly provenance: TurnRecordProvenance;
}

export type ShotOutcome = "correct" | "wrong" | "empty";

export interface ShotEvent {
  readonly id: number;
  readonly operator: OperatorId;
  readonly targetId: string | null;
  readonly outcome: ShotOutcome;
  readonly phaseElapsedMs: number;
  readonly scoreDelta: number;
}

export interface TurnSummary {
  readonly address: TurnAddress;
  readonly recordId: string;
  readonly forcedRed: boolean;
  readonly greenElapsedMs: number;
  readonly ammoAtRed: number;
  readonly revealedWavers: number;
  readonly playerCorrect: number;
  readonly playerWrong: number;
  readonly leftHits: number;
  readonly rightHits: number;
  readonly unresolvedWavers: number;
  readonly crossedThisTurn: number;
}

export interface PopulationCounts {
  readonly total: number;
  readonly active: number;
  readonly evaporated: number;
  readonly crossed: number;
}

export interface DontWaveState {
  readonly seed: number;
  readonly phase: DontWavePhase;
  readonly round: number;
  readonly totalRounds: number;
  readonly turn: number;
  readonly turnsPerRound: number;
  readonly crowdRevision: number;
  readonly phaseElapsedMs: number;
  readonly greenElapsedMs: number;
  readonly canCallRed: boolean;
  readonly forcedRed: boolean;
  readonly ammo: number;
  readonly ammoAtRed: number;
  readonly maxAmmo: number;
  readonly chargeProgress: number;
  readonly huntRemainingMs: number;
  readonly contestants: readonly ContestantState[];
  readonly currentRecord: TurnRecord | null;
  readonly turnStartCrossed: number;
  readonly revealedWavers: number;
  readonly revealedStills: number;
  readonly wavingRemaining: number;
  readonly rivalShotsUsedLeft: number;
  readonly rivalShotsUsedRight: number;
  readonly turnPlayerCorrect: number;
  readonly turnPlayerWrong: number;
  readonly turnLeftHits: number;
  readonly turnRightHits: number;
  readonly playerScore: number;
  readonly leftScore: number;
  readonly rightScore: number;
  readonly playerCorrect: number;
  readonly playerWrong: number;
  readonly emptyShots: number;
  readonly events: readonly ShotEvent[];
  readonly history: readonly TurnSummary[];
  readonly counts: PopulationCounts;
  readonly playerMoving: boolean;
  readonly playerProgress: number;
  readonly statusMessage: string;
}

export type FireResult =
  | { readonly fired: true; readonly event: ShotEvent }
  | { readonly fired: false; readonly reason: "not-hunting" | "no-ammo" };

export interface TurnBank {
  readonly schemaVersion: 5;
  readonly modelId: "dw-prepared-turn-v5";
  readonly bankId: string;
  readonly seed: number;
  readonly contestantIds: readonly string[];
  getRecord(address: TurnAddress): TurnRecord;
  consume(address: TurnAddress): TurnRecord;
  resetConsumption(): void;
  consumedCount(): number;
  recordCount(): number;
}
