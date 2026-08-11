import { createContestantDefinitions } from "../content/creatures";
import { FINISH_Z } from "../content/fieldLayout";
import {
  ClassicalDemoTurnBank,
  TOTAL_ROUNDS,
  TURN_RECORD_MODEL_ID,
  TURN_RECORD_SCHEMA_VERSION,
  TURNS_PER_ROUND,
  WAVERS_PER_TURN,
  turnAddressKey,
  validateTurnRecord,
} from "./observationBank";
import { mixSeed, normalizeSeed } from "./rng";
import type {
  ContestantDefinition,
  ContestantState,
  DontWavePhase,
  DontWaveState,
  FireResult,
  OperatorId,
  PopulationCounts,
  RivalId,
  ShotEvent,
  ShotOutcome,
  TurnBank,
  TurnRecord,
  TurnSummary,
} from "./types";

export const CHARGE_STEP_MS = 750;
export const MAX_AMMO = 6;
export const MAX_GREEN_MS = 5_500;
export const REVEAL_MS = 500;
export const HUNT_MS = 5_000;
export const RIVAL_FIRST_SHOT_MS = 350;
export const RIVAL_SHOT_INTERVAL_MS = 550;
export const RIVAL_SETTLE_MS = 450;
export const INTERTURN_MS = 650;
export const DESCENT_MS = 2_200;
export const CROSSING_GREEN_MS = 4_000;
export const CROSSING_RED_MS = 1_100;
export const DEATH_MS = 1_400;
export const CORRECT_SCORE = 100;
export const WRONG_SCORE = -100;

export const CROWD_SPEED = 1;
const RIVAL_SHOT_CAP = [2, 3] as const;

type Subscriber = (state: DontWaveState) => void;

export interface DontWaveSessionOptions {
  readonly definitions?: readonly ContestantDefinition[];
  readonly bank?: TurnBank;
}

export class DontWaveSession {
  private seed: number;
  private definitions: readonly ContestantDefinition[];
  private bank: TurnBank;
  private readonly suppliedDefinitions: readonly ContestantDefinition[] | null;
  private readonly suppliedBank: TurnBank | null;
  private state: DontWaveState;
  private readonly subscribers = new Set<Subscriber>();
  private nextEventId = 1;

  constructor(seed: number, options: DontWaveSessionOptions = {}) {
    this.seed = normalizeSeed(seed);
    this.suppliedDefinitions = options.definitions ?? null;
    this.definitions = this.suppliedDefinitions ?? createContestantDefinitions(this.seed, 1);
    this.suppliedBank = options.bank ?? null;
    this.bank = this.suppliedBank ?? new ClassicalDemoTurnBank(this.seed, this.definitions);
    validateBank(this.bank, this.seed, this.definitions);
    this.state = createInitialState(this.seed, this.definitions);
  }

  getState(): DontWaveState {
    return this.state;
  }

  getBank(): TurnBank {
    return this.bank;
  }

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    subscriber(this.state);
    return () => this.subscribers.delete(subscriber);
  }

  start(): boolean {
    if (this.state.phase !== "briefing") return false;
    this.replace({ phase: "ready", phaseElapsedMs: 0, statusMessage: "Call GREEN LIGHT." });
    return true;
  }

  startGreen(): boolean {
    if (this.state.phase !== "ready") return false;
    this.replace({
      phase: "green",
      phaseElapsedMs: 0,
      greenElapsedMs: 0,
      ammo: 0,
      ammoAtRed: 0,
      chargeProgress: 0,
      forcedRed: false,
      currentRecord: null,
      revealedWavers: 0,
      revealedStills: 0,
      rivalShotsUsedLeft: 0,
      rivalShotsUsedRight: 0,
      turnPlayerCorrect: 0,
      turnPlayerWrong: 0,
      turnLeftHits: 0,
      turnRightHits: 0,
      turnStartCrossed: this.state.counts.crossed,
      contestants: setActivePose(this.state.contestants, "walking"),
      statusMessage: "GREEN LIGHT",
    });
    return true;
  }

  triggerRed(): boolean {
    if (this.state.phase !== "green" || !this.state.canCallRed) return false;
    this.resolveRed(false);
    return true;
  }

  fire(targetId: string | null): FireResult {
    if (this.state.phase !== "hunt") return { fired: false, reason: "not-hunting" };
    if (this.state.ammo <= 0) return { fired: false, reason: "no-ammo" };

    const target = targetId === null
      ? null
      : this.state.contestants.find((contestant) => contestant.id === targetId) ?? null;
    let outcome: ShotOutcome = "empty";
    let scoreDelta = 0;
    let contestants = this.state.contestants;
    if (target?.status === "active" && (target.pose === "waving" || target.pose === "still")) {
      outcome = target.pose === "waving" ? "correct" : "wrong";
      scoreDelta = outcome === "correct" ? CORRECT_SCORE : WRONG_SCORE;
      contestants = removeContestant(this.state.contestants, target.id, "player", outcome);
    }
    const event = this.createEvent("player", outcome === "empty" ? null : target?.id ?? null, outcome, scoreDelta);
    this.replace({
      contestants,
      ammo: this.state.ammo - 1,
      playerScore: this.state.playerScore + scoreDelta,
      playerCorrect: this.state.playerCorrect + (outcome === "correct" ? 1 : 0),
      playerWrong: this.state.playerWrong + (outcome === "wrong" ? 1 : 0),
      emptyShots: this.state.emptyShots + (outcome === "empty" ? 1 : 0),
      turnPlayerCorrect: this.state.turnPlayerCorrect + (outcome === "correct" ? 1 : 0),
      turnPlayerWrong: this.state.turnPlayerWrong + (outcome === "wrong" ? 1 : 0),
      events: [...this.state.events, event],
      statusMessage: outcome === "correct" ? "+100" : outcome === "wrong" ? "−100" : "EMPTY",
    });
    return { fired: true, event };
  }

  continueRound(): boolean {
    if (this.state.phase !== "round-break") return false;
    const round = 2;
    this.definitions = this.suppliedDefinitions ?? createContestantDefinitions(this.seed, round);
    validateDefinitions(this.definitions, this.bank.contestantIds);
    this.replace({
      phase: "ready",
      round,
      turn: 1,
      crowdRevision: this.state.crowdRevision + 1,
      phaseElapsedMs: 0,
      greenElapsedMs: 0,
      ammo: 0,
      ammoAtRed: 0,
      chargeProgress: 0,
      currentRecord: null,
      forcedRed: false,
      revealedWavers: 0,
      revealedStills: 0,
      rivalShotsUsedLeft: 0,
      rivalShotsUsedRight: 0,
      turnPlayerCorrect: 0,
      turnPlayerWrong: 0,
      turnLeftHits: 0,
      turnRightHits: 0,
      contestants: instantiate(this.definitions),
      turnStartCrossed: 0,
      statusMessage: "Round two. Call GREEN LIGHT.",
    });
    return true;
  }

  leaveTower(): boolean {
    if (this.state.phase !== "final-standings") return false;
    this.replace({ phase: "descent", phaseElapsedMs: 0, statusMessage: "Descending." });
    return true;
  }

  beginCrossing(): boolean {
    if (this.state.phase !== "crossing-ready") return false;
    this.replace({
      phase: "crossing-green",
      phaseElapsedMs: 0,
      playerMoving: false,
      playerProgress: 0,
      statusMessage: "GREEN LIGHT",
    });
    return true;
  }

  setPlayerMoving(moving: boolean): boolean {
    if (this.state.phase !== "crossing-green") return false;
    if (this.state.playerMoving === moving) return true;
    this.replace({ playerMoving: moving });
    return true;
  }

  restart(seed = this.seed): void {
    this.seed = normalizeSeed(seed);
    this.definitions = this.suppliedDefinitions ?? createContestantDefinitions(this.seed, 1);
    if (this.suppliedBank && this.suppliedBank.seed === this.seed) {
      this.bank = this.suppliedBank;
      this.bank.resetConsumption();
    } else {
      this.bank = new ClassicalDemoTurnBank(this.seed, this.definitions);
    }
    validateBank(this.bank, this.seed, this.definitions);
    this.nextEventId = 1;
    this.state = createInitialState(this.seed, this.definitions);
    this.emit();
  }

  tick(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    let remainingMs = Math.min(10_000, deltaMs);
    let transitions = 0;
    while (remainingMs > 0 && transitions < 64) {
      const boundaryMs = this.millisecondsToBoundary();
      if (!Number.isFinite(boundaryMs)) return;
      const stepMs = Math.min(remainingMs, Math.max(0, boundaryMs));
      const before = this.progressSignature();
      this.tickPhase(stepMs);
      remainingMs -= stepMs;
      transitions += 1;
      if (stepMs === 0 && this.progressSignature() === before) return;
    }
  }

  private tickPhase(deltaMs: number): void {
    switch (this.state.phase) {
      case "green": this.tickGreen(deltaMs); break;
      case "reveal": this.tickReveal(deltaMs); break;
      case "hunt": this.tickHunt(deltaMs); break;
      case "rivals": this.tickRivals(deltaMs); break;
      case "interturn": this.tickInterturn(deltaMs); break;
      case "descent": this.tickDescent(deltaMs); break;
      case "crossing-green": this.tickCrossingGreen(deltaMs); break;
      case "crossing-red": this.tickCrossingRed(deltaMs); break;
      case "death": this.tickDeath(deltaMs); break;
      default: break;
    }
  }

  private millisecondsToBoundary(): number {
    switch (this.state.phase) {
      case "green": return Math.max(0, MAX_GREEN_MS - this.state.greenElapsedMs);
      case "reveal": return Math.max(0, REVEAL_MS - this.state.phaseElapsedMs);
      case "hunt": return Math.max(0, HUNT_MS - this.state.phaseElapsedMs);
      case "rivals": {
        if (this.state.wavingRemaining === 0) {
          return Math.max(0, rivalSettleDeadline(this.state) - this.state.phaseElapsedMs);
        }
        const cap = rivalShotCap(this.state.round);
        const nextShotIndex = Math.min(this.state.rivalShotsUsedLeft, this.state.rivalShotsUsedRight);
        const deadline = nextShotIndex < cap
          ? RIVAL_FIRST_SHOT_MS + nextShotIndex * RIVAL_SHOT_INTERVAL_MS
          : rivalSettleDeadline(this.state);
        return Math.max(0, deadline - this.state.phaseElapsedMs);
      }
      case "interturn": return Math.max(0, INTERTURN_MS - this.state.phaseElapsedMs);
      case "descent": return Math.max(0, DESCENT_MS - this.state.phaseElapsedMs);
      case "crossing-green": return Math.max(0, CROSSING_GREEN_MS - this.state.phaseElapsedMs);
      case "crossing-red": return Math.max(0, CROSSING_RED_MS - this.state.phaseElapsedMs);
      case "death": return Math.max(0, DEATH_MS - this.state.phaseElapsedMs);
      default: return Number.POSITIVE_INFINITY;
    }
  }

  private progressSignature(): string {
    return [
      this.state.phase,
      this.state.phaseElapsedMs,
      this.state.greenElapsedMs,
      this.state.rivalShotsUsedLeft,
      this.state.rivalShotsUsedRight,
      this.state.wavingRemaining,
    ].join("|");
  }

  private tickGreen(deltaMs: number): void {
    const movementMs = Math.min(deltaMs, MAX_GREEN_MS - this.state.greenElapsedMs);
    const speed = CROWD_SPEED;
    const contestants = this.state.contestants.map((contestant): ContestantState => {
      if (contestant.status !== "active") return contestant;
      const z = contestant.z + speed * movementMs / 1_000;
      if (z >= FINISH_Z) return { ...contestant, z: FINISH_Z, status: "crossed", pose: "idle" };
      return { ...contestant, z, pose: "walking" };
    });
    const greenElapsedMs = this.state.greenElapsedMs + movementMs;
    const ammo = Math.min(MAX_AMMO, Math.floor(greenElapsedMs / CHARGE_STEP_MS));
    this.state = derive({
      ...this.state,
      contestants,
      phaseElapsedMs: greenElapsedMs,
      greenElapsedMs,
      ammo,
      chargeProgress: Math.min(1, greenElapsedMs / (CHARGE_STEP_MS * MAX_AMMO)),
    });
    if (greenElapsedMs >= MAX_GREEN_MS) this.resolveRed(true);
    else this.emit();
  }

  private resolveRed(forcedRed: boolean): void {
    const address = { round: this.state.round, turn: this.state.turn } as const;
    const record = snapshotRecord(this.bank.consume(address));
    validateTurnRecord(record, this.bank.contestantIds, this.bank.bankId);
    if (turnAddressKey(record.address) !== turnAddressKey(address)) throw new Error("Turn bank returned the wrong address.");
    const wavingIds = selectWavingIds(record, this.state.contestants);
    let revealedWavers = 0;
    let revealedStills = 0;
    const contestants = this.state.contestants.map((contestant): ContestantState => {
      if (contestant.status !== "active") return contestant;
      if (wavingIds.has(contestant.id)) {
        revealedWavers += 1;
        return { ...contestant, pose: "waving" };
      }
      revealedStills += 1;
      return { ...contestant, pose: "still" };
    });
    this.replace({
      phase: "reveal",
      phaseElapsedMs: 0,
      currentRecord: record,
      forcedRed,
      ammoAtRed: this.state.ammo,
      contestants,
      revealedWavers,
      revealedStills,
      statusMessage: "RED LIGHT",
    });
  }

  private tickReveal(deltaMs: number): void {
    const phaseElapsedMs = Math.min(REVEAL_MS, this.state.phaseElapsedMs + deltaMs);
    if (phaseElapsedMs < REVEAL_MS) {
      this.replace({ phaseElapsedMs });
      return;
    }
    this.replace({ phase: "hunt", phaseElapsedMs: 0, statusMessage: "FIRE" });
  }

  private tickHunt(deltaMs: number): void {
    const phaseElapsedMs = Math.min(HUNT_MS, this.state.phaseElapsedMs + deltaMs);
    if (phaseElapsedMs < HUNT_MS) {
      this.replace({ phaseElapsedMs });
      return;
    }
    this.replace({ phase: "rivals", phaseElapsedMs: 0, statusMessage: "TOWERS ACTIVE" });
  }

  private tickRivals(deltaMs: number): void {
    const cap = rivalShotCap(this.state.round);
    const phaseElapsedMs = this.state.phaseElapsedMs + deltaMs;
    let leftUsed = this.state.rivalShotsUsedLeft;
    let rightUsed = this.state.rivalShotsUsedRight;
    for (let shotIndex = 0; shotIndex < cap; shotIndex += 1) {
      const shotAt = RIVAL_FIRST_SHOT_MS + shotIndex * RIVAL_SHOT_INTERVAL_MS;
      if (shotAt > phaseElapsedMs || this.countWavers() === 0) break;
      const preferred = preferredRival(this.state.round, this.state.turn, shotIndex);
      const order: readonly RivalId[] = preferred === "left" ? ["left", "right"] : ["right", "left"];
      for (const operator of order) {
        if (this.countWavers() === 0) break;
        const used = operator === "left" ? leftUsed : rightUsed;
        if (used > shotIndex) continue;
        if (this.fireRival(operator, shotIndex)) {
          if (operator === "left") leftUsed += 1;
          else rightUsed += 1;
        }
      }
    }

    this.state = derive({
      ...this.state,
      phaseElapsedMs,
      rivalShotsUsedLeft: leftUsed,
      rivalShotsUsedRight: rightUsed,
    });
    if (phaseElapsedMs >= rivalSettleDeadline(this.state)) this.finishTurn();
    else this.emit();
  }

  private fireRival(operator: RivalId, shotIndex: number): boolean {
    const target = this.nextRivalTarget(operator, shotIndex);
    if (!target) return false;
    const shotAt = RIVAL_FIRST_SHOT_MS + shotIndex * RIVAL_SHOT_INTERVAL_MS;
    const event = this.createEvent(operator, target.id, "correct", CORRECT_SCORE, shotAt);
    this.state = derive({
      ...this.state,
      contestants: removeContestant(this.state.contestants, target.id, operator, "correct"),
      leftScore: this.state.leftScore + (operator === "left" ? CORRECT_SCORE : 0),
      rightScore: this.state.rightScore + (operator === "right" ? CORRECT_SCORE : 0),
      turnLeftHits: this.state.turnLeftHits + (operator === "left" ? 1 : 0),
      turnRightHits: this.state.turnRightHits + (operator === "right" ? 1 : 0),
      events: [...this.state.events, event],
    });
    return true;
  }

  private nextRivalTarget(operator: RivalId, shotIndex: number): ContestantState | null {
    const recordId = this.state.currentRecord?.id;
    if (!recordId) throw new Error("Rival volley has no prepared record.");
    const candidates = this.state.contestants.filter((contestant) => (
      contestant.status === "active" && contestant.pose === "waving"
    ));
    candidates.sort((left, right) => (
      mixSeed(this.seed, recordId, operator, shotIndex, left.id)
      - mixSeed(this.seed, recordId, operator, shotIndex, right.id)
    ));
    return candidates[0] ?? null;
  }

  private finishTurn(): void {
    const record = this.state.currentRecord;
    if (!record) throw new Error("Cannot finish a turn without a prepared record.");
    const summary: TurnSummary = Object.freeze({
      address: Object.freeze({ round: this.state.round, turn: this.state.turn }),
      recordId: record.id,
      forcedRed: this.state.forcedRed,
      greenElapsedMs: this.state.greenElapsedMs,
      ammoAtRed: this.state.ammoAtRed,
      revealedWavers: this.state.revealedWavers,
      playerCorrect: this.state.turnPlayerCorrect,
      playerWrong: this.state.turnPlayerWrong,
      leftHits: this.state.turnLeftHits,
      rightHits: this.state.turnRightHits,
      unresolvedWavers: this.state.wavingRemaining,
      crossedThisTurn: Math.max(0, this.state.counts.crossed - this.state.turnStartCrossed),
    });
    this.replace({
      phase: "interturn",
      phaseElapsedMs: 0,
      contestants: setActivePose(this.state.contestants, "idle"),
      history: [...this.state.history, summary],
      statusMessage: "TURN COMPLETE",
    });
  }

  private tickInterturn(deltaMs: number): void {
    const phaseElapsedMs = Math.min(INTERTURN_MS, this.state.phaseElapsedMs + deltaMs);
    if (phaseElapsedMs < INTERTURN_MS) {
      this.replace({ phaseElapsedMs });
      return;
    }
    if (this.state.turn < TURNS_PER_ROUND) {
      this.replace({
        phase: "ready",
        turn: this.state.turn + 1,
        phaseElapsedMs: 0,
        greenElapsedMs: 0,
        ammo: 0,
        ammoAtRed: 0,
        chargeProgress: 0,
        currentRecord: null,
        revealedWavers: 0,
        revealedStills: 0,
        rivalShotsUsedLeft: 0,
        rivalShotsUsedRight: 0,
        statusMessage: "Call GREEN LIGHT.",
      });
      return;
    }
    this.replace({
      phase: this.state.round === TOTAL_ROUNDS ? "final-standings" : "round-break",
      phaseElapsedMs: 0,
      statusMessage: this.state.round === TOTAL_ROUNDS ? "FINAL STANDINGS" : "ROUND COMPLETE",
    });
  }

  private tickDescent(deltaMs: number): void {
    const phaseElapsedMs = Math.min(DESCENT_MS, this.state.phaseElapsedMs + deltaMs);
    if (phaseElapsedMs < DESCENT_MS) {
      this.replace({ phaseElapsedMs });
      return;
    }
    this.replace({ phase: "crossing-ready", phaseElapsedMs: 0, statusMessage: "FIELD LEVEL" });
  }

  private tickCrossingGreen(deltaMs: number): void {
    const movementMs = Math.min(deltaMs, CROSSING_GREEN_MS - this.state.phaseElapsedMs);
    const playerProgress = this.state.playerMoving
      ? Math.min(1, this.state.playerProgress + movementMs / CROSSING_GREEN_MS)
      : this.state.playerProgress;
    const phaseElapsedMs = this.state.phaseElapsedMs + movementMs;
    if (phaseElapsedMs < CROSSING_GREEN_MS) {
      this.replace({ phaseElapsedMs, playerProgress });
      return;
    }
    this.replace({
      phase: "crossing-red",
      phaseElapsedMs: 0,
      playerMoving: false,
      playerProgress,
      statusMessage: "RED LIGHT",
    });
  }

  private tickCrossingRed(deltaMs: number): void {
    const phaseElapsedMs = Math.min(CROSSING_RED_MS, this.state.phaseElapsedMs + deltaMs);
    if (phaseElapsedMs < CROSSING_RED_MS) {
      this.replace({ phaseElapsedMs });
      return;
    }
    this.replace({ phase: "death", phaseElapsedMs: 0, statusMessage: "" });
  }

  private tickDeath(deltaMs: number): void {
    const phaseElapsedMs = Math.min(DEATH_MS, this.state.phaseElapsedMs + deltaMs);
    if (phaseElapsedMs < DEATH_MS) {
      this.replace({ phaseElapsedMs });
      return;
    }
    this.replace({ phase: "complete", phaseElapsedMs: 0, playerMoving: false, statusMessage: "DON'T WAVE" });
  }

  private countWavers(): number {
    return this.state.contestants.filter((contestant) => contestant.status === "active" && contestant.pose === "waving").length;
  }

  private createEvent(
    operator: OperatorId,
    targetId: string | null,
    outcome: ShotOutcome,
    scoreDelta: number,
    phaseElapsedMs = this.state.phaseElapsedMs,
  ): ShotEvent {
    return Object.freeze({
      id: this.nextEventId++,
      operator,
      targetId,
      outcome,
      phaseElapsedMs,
      scoreDelta,
    });
  }

  private replace(patch: Partial<DontWaveState>): void {
    this.state = derive({ ...this.state, ...patch });
    this.emit();
  }

  private emit(): void {
    for (const subscriber of this.subscribers) subscriber(this.state);
  }
}

function createInitialState(seed: number, definitions: readonly ContestantDefinition[]): DontWaveState {
  return derive({
    seed,
    phase: "briefing",
    round: 1,
    totalRounds: TOTAL_ROUNDS,
    turn: 1,
    turnsPerRound: TURNS_PER_ROUND,
    crowdRevision: 1,
    phaseElapsedMs: 0,
    greenElapsedMs: 0,
    canCallRed: false,
    forcedRed: false,
    ammo: 0,
    ammoAtRed: 0,
    maxAmmo: MAX_AMMO,
    chargeProgress: 0,
    huntRemainingMs: 0,
    contestants: instantiate(definitions),
    currentRecord: null,
    turnStartCrossed: 0,
    revealedWavers: 0,
    revealedStills: 0,
    wavingRemaining: 0,
    rivalShotsUsedLeft: 0,
    rivalShotsUsedRight: 0,
    turnPlayerCorrect: 0,
    turnPlayerWrong: 0,
    turnLeftHits: 0,
    turnRightHits: 0,
    playerScore: 0,
    leftScore: 0,
    rightScore: 0,
    playerCorrect: 0,
    playerWrong: 0,
    emptyShots: 0,
    events: [],
    history: [],
    counts: { total: definitions.length, active: definitions.length, evaporated: 0, crossed: 0 },
    playerMoving: false,
    playerProgress: 0,
    statusMessage: "",
  });
}

function derive(state: DontWaveState): DontWaveState {
  const counts = countPopulation(state.contestants);
  const wavingRemaining = state.contestants.filter((contestant) => (
    contestant.status === "active" && contestant.pose === "waving"
  )).length;
  const huntRemainingMs = state.phase === "reveal"
    ? HUNT_MS
    : state.phase === "hunt"
      ? Math.max(0, HUNT_MS - state.phaseElapsedMs)
      : 0;
  const canCallRed = state.phase === "green" && state.ammo > 0;
  if ((state.phase === "reveal" || state.phase === "hunt" || state.phase === "rivals") && state.currentRecord) {
    const accounted = state.turnPlayerCorrect + state.turnLeftHits + state.turnRightHits + wavingRemaining;
    if (accounted !== state.revealedWavers) {
      throw new Error(`Waver accounting failed: ${accounted} of ${state.revealedWavers}.`);
    }
  }
  return { ...state, counts, wavingRemaining, huntRemainingMs, canCallRed };
}

function instantiate(definitions: readonly ContestantDefinition[]): readonly ContestantState[] {
  return definitions.map((definition): ContestantState => ({
    ...definition,
    z: definition.startZ,
    status: "active",
    pose: "idle",
  }));
}

function setActivePose(contestants: readonly ContestantState[], pose: "idle" | "walking"): readonly ContestantState[] {
  return contestants.map((contestant): ContestantState => (
    contestant.status === "active" ? { ...contestant, pose } : contestant
  ));
}

function removeContestant(
  contestants: readonly ContestantState[],
  id: string,
  operator: OperatorId,
  reason: "correct" | "wrong",
): readonly ContestantState[] {
  return contestants.map((contestant): ContestantState => (
    contestant.id === id
      ? { ...contestant, status: "evaporated", pose: "idle", removedBy: operator, removalReason: reason }
      : contestant
  ));
}

function countPopulation(contestants: readonly ContestantState[]): PopulationCounts {
  let active = 0;
  let evaporated = 0;
  let crossed = 0;
  for (const contestant of contestants) {
    if (contestant.status === "active") active += 1;
    else if (contestant.status === "evaporated") evaporated += 1;
    else crossed += 1;
  }
  return { total: contestants.length, active, evaporated, crossed };
}

function rivalShotCap(round: number): number {
  return RIVAL_SHOT_CAP[round - 1] ?? RIVAL_SHOT_CAP[0];
}

function preferredRival(round: number, turn: number, shotIndex: number): RivalId {
  const absoluteTurn = (round - 1) * TURNS_PER_ROUND + (turn - 1);
  return (absoluteTurn + shotIndex) % 2 === 0 ? "left" : "right";
}

function selectWavingIds(record: TurnRecord, contestants: readonly ContestantState[]): ReadonlySet<string> {
  const active = contestants.filter((contestant) => contestant.status === "active");
  const activeIds = new Set(active.map((contestant) => contestant.id));
  const targetCount = Math.min(WAVERS_PER_TURN, Math.max(0, active.length - 2));
  return new Set(record.priority.filter((id) => activeIds.has(id)).slice(0, targetCount));
}

function validateBank(bank: TurnBank, seed: number, definitions: readonly ContestantDefinition[]): void {
  if (bank.schemaVersion !== TURN_RECORD_SCHEMA_VERSION || bank.modelId !== TURN_RECORD_MODEL_ID) {
    throw new Error(`Turn bank must use schema v5 and model ${TURN_RECORD_MODEL_ID}.`);
  }
  if (bank.seed !== seed) throw new Error("Turn bank seed does not match the session seed.");
  validateDefinitions(definitions, bank.contestantIds);
  if (bank.recordCount() !== TOTAL_ROUNDS * TURNS_PER_ROUND) throw new Error("Turn bank must contain eight prepared records.");
}

function validateDefinitions(definitions: readonly ContestantDefinition[], expectedIds: readonly string[]): void {
  const actual = definitions.map((definition) => definition.id).sort();
  const expected = [...expectedIds].sort();
  if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
    throw new Error("Contestant identities do not match the prepared bank.");
  }
}

function snapshotRecord(record: TurnRecord): TurnRecord {
  return Object.freeze({
    schemaVersion: record.schemaVersion,
    id: record.id,
    bankId: record.bankId,
    address: Object.freeze({ ...record.address }),
    priority: Object.freeze([...record.priority]),
    provenance: Object.freeze({ ...record.provenance }),
  });
}

export function phaseAcceptsInput(phase: DontWavePhase): boolean {
  return phase === "ready" || phase === "green" || phase === "hunt" || phase === "crossing-green";
}

function rivalSettleDeadline(state: DontWaveState): number {
  const cap = rivalShotCap(state.round);
  if (state.wavingRemaining > 0) {
    return RIVAL_FIRST_SHOT_MS + Math.max(0, cap - 1) * RIVAL_SHOT_INTERVAL_MS + RIVAL_SETTLE_MS;
  }
  const firedVolleys = Math.max(state.rivalShotsUsedLeft, state.rivalShotsUsedRight);
  const lastShotAt = firedVolleys > 0
    ? RIVAL_FIRST_SHOT_MS + (firedVolleys - 1) * RIVAL_SHOT_INTERVAL_MS
    : 0;
  return lastShotAt + RIVAL_SETTLE_MS;
}
