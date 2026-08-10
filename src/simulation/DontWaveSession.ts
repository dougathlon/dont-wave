import { createCreatureDefinitions } from "../content/creatures";
import { CREATURE_CROSSING_MS, creatureStartingProgress } from "../content/fieldLayout";
import {
  ClassicalDemoTurnBank,
  TOTAL_ROUNDS,
  TURN_RECORD_MODEL_ID,
  TURN_RECORD_SCHEMA_VERSION,
  TURNS_PER_ROUND,
  turnAddressKey,
  validateTurnRecord,
} from "./observationBank";
import { mixSeed, normalizeSeed } from "./rng";
import type {
  CreatureDefinition,
  CreatureRuntimeState,
  DontWavePhase,
  DontWaveState,
  OperatorId,
  PopulationCounts,
  SideOperatorId,
  TurnBank,
  TurnRecord,
  TurnSummary,
  ZapCreatureResult,
  ZapEvent,
} from "./types";

export const MIN_RED_TRIGGER_MS = 700;
export const MAX_GREEN_MS = 4_500;
export const REVEAL_MS = 400;
export const HUNT_MS = 4_500;
export const SIDE_OPERATOR_START_MS = 1_100;
export const SIDE_OPERATOR_INTERVAL_MS = 450;
export const DESCENT_MS = 3_000;
export const CROSSING_GREEN_MS = 4_500;
export const CROSSING_RED_MS = 650;
export const DEATH_MS = 1_200;
export const CORRECT_HIT_SCORE = 100;

const CREATURE_PROGRESS_PER_MS = 1 / CREATURE_CROSSING_MS;
const PLAYER_PROGRESS_PER_MS = 1 / 6_000;

type Subscriber = (state: DontWaveState) => void;

export interface DontWaveSessionOptions {
  readonly creatures?: readonly CreatureDefinition[];
  readonly bank?: TurnBank;
}

export class DontWaveSession {
  private seed: number;
  private definitions: readonly CreatureDefinition[];
  private bank: TurnBank;
  private state: DontWaveState;
  private readonly subscribers = new Set<Subscriber>();
  private readonly consumedRecordIds = new Set<string>();

  constructor(seed: number, options: DontWaveSessionOptions = {}) {
    this.seed = normalizeSeed(seed);
    this.definitions = options.creatures ?? createCreatureDefinitions(this.seed);
    this.bank = options.bank ?? new ClassicalDemoTurnBank(this.seed, this.definitions);
    validateBankIdentity(this.bank, this.seed, this.definitions);
    this.state = createInitialState(this.seed, this.bank.bankId, this.definitions);
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
    this.state = derive({
      ...this.state,
      phase: "ready",
      phaseElapsedMs: 0,
      statusMessage: "Round 1, turn 1 ready. Start GREEN when prepared.",
    });
    this.emit();
    return true;
  }

  startGreen(): boolean {
    if (this.state.phase !== "ready" || this.state.paused) return false;
    this.state = derive({
      ...this.state,
      phase: "green",
      greenElapsedMs: 0,
      phaseElapsedMs: 0,
      currentRecord: null,
      revealedWavingIds: [],
      revealedStillIds: [],
      revealedSafeIds: [],
      turnZaps: [],
      forcedRed: false,
      turnPlayerHits: 0,
      turnLeftOperatorHits: 0,
      turnRightOperatorHits: 0,
      revealedWavers: 0,
      wavingRemaining: 0,
      creatures: setActivePose(this.state.creatures, "moving"),
      statusMessage: `Round ${this.state.round}, turn ${this.state.turn}: GREEN.`,
    });
    this.emit();
    return true;
  }

  triggerRed(): boolean {
    if (this.state.phase !== "green" || this.state.paused || this.state.greenElapsedMs < MIN_RED_TRIGGER_MS) return false;
    this.resolveRed(false);
    return true;
  }

  zapCreature(creatureId: string): ZapCreatureResult {
    if (this.state.paused) return { accepted: false, reason: "paused" };
    if (this.state.phase !== "hunt") return { accepted: false, reason: "not-hunting" };
    const creature = this.state.creatures.find((candidate) => candidate.id === creatureId);
    if (!creature) return { accepted: false, reason: "unknown-creature" };
    if (creature.status === "removed" || creature.zappedBy) {
      this.recordPlayerMiss(`Too late: ${creature.name} was already claimed.`);
      return { accepted: false, reason: "already-zapped" };
    }
    if (creature.status !== "active" || creature.pose !== "waving") {
      this.recordPlayerMiss(`${creature.name} was still. Miss recorded.`);
      return { accepted: false, reason: "not-waving" };
    }

    const event = this.claimCreature(creature.id, "player");
    if (!event) throw new Error(`Eligible waving creature ${creature.id} could not be claimed.`);
    this.state = derive({ ...this.state, statusMessage: `${creature.name} zapped. +${CORRECT_HIT_SCORE}.` });
    this.emit();
    return { accepted: true, event };
  }

  registerMiss(): boolean {
    if (this.state.phase !== "hunt" || this.state.paused) return false;
    this.recordPlayerMiss("Empty shot. Miss recorded.");
    return true;
  }

  continueRound(): boolean {
    if (this.state.phase !== "intermission" || this.state.paused) return false;
    if (this.state.round !== 1 || this.state.turn !== TURNS_PER_ROUND) return false;
    this.state = derive({
      ...this.state,
      phase: "ready",
      round: 2,
      turn: 1,
      greenElapsedMs: 0,
      phaseElapsedMs: 0,
      currentRecord: null,
      revealedWavingIds: [],
      revealedStillIds: [],
      revealedSafeIds: [],
      turnZaps: [],
      forcedRed: false,
      turnPlayerHits: 0,
      turnLeftOperatorHits: 0,
      turnRightOperatorHits: 0,
      revealedWavers: 0,
      wavingRemaining: 0,
      creatures: setActivePose(this.state.creatures, "idle"),
      statusMessage: "Round 2, turn 1 ready. Progress retained.",
    });
    this.emit();
    return true;
  }

  beginCrossing(): boolean {
    if (this.state.phase !== "crossing-ready" || this.state.paused) return false;
    this.state = derive({
      ...this.state,
      phase: "crossing-green",
      phaseElapsedMs: 0,
      playerProgress: 0,
      playerMoving: false,
      statusMessage: "GREEN. Hold movement to cross.",
    });
    this.emit();
    return true;
  }

  setPlayerMoving(moving: boolean): boolean {
    if (this.state.phase !== "crossing-green" || this.state.paused) return false;
    if (this.state.playerMoving === moving) return true;
    this.state = derive({ ...this.state, playerMoving: moving });
    this.emit();
    return true;
  }

  pause(): boolean {
    if (!isPausable(this.state.phase) || this.state.paused) return false;
    this.state = derive({ ...this.state, paused: true, playerMoving: false, statusMessage: "Game paused." });
    this.emit();
    return true;
  }

  resume(): boolean {
    if (!this.state.paused) return false;
    this.state = derive({ ...this.state, paused: false, statusMessage: "Game resumed." });
    this.emit();
    return true;
  }

  togglePause(): void {
    if (this.state.paused) this.resume();
    else this.pause();
  }

  restart(seed = this.seed): void {
    const normalizedSeed = normalizeSeed(seed);
    if (normalizedSeed !== this.seed) {
      this.seed = normalizedSeed;
      this.definitions = createCreatureDefinitions(this.seed);
      this.bank = new ClassicalDemoTurnBank(this.seed, this.definitions);
    }
    this.bank.resetConsumption();
    this.consumedRecordIds.clear();
    this.state = createInitialState(this.seed, this.bank.bankId, this.definitions);
    this.emit();
  }

  tick(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0 || this.state.paused) return;
    const delta = Math.min(deltaMs, 10_000);
    switch (this.state.phase) {
      case "green":
        this.tickGreen(delta);
        break;
      case "reveal":
        this.tickReveal(delta);
        break;
      case "hunt":
        this.tickHunt(delta);
        break;
      case "descent":
        this.tickDescent(delta);
        break;
      case "crossing-green":
        this.tickCrossingGreen(delta);
        break;
      case "crossing-red":
        this.tickCrossingRed(delta);
        break;
      case "death":
        this.tickDeath(delta);
        break;
      default:
        break;
    }
  }

  private tickGreen(deltaMs: number): void {
    const remaining = Math.max(0, MAX_GREEN_MS - this.state.greenElapsedMs);
    const movementDelta = Math.min(deltaMs, remaining);
    const creatures = this.state.creatures.map((creature): CreatureRuntimeState => {
      if (creature.status !== "active") return creature;
      const progress = Math.min(1, creature.progress + movementDelta * CREATURE_PROGRESS_PER_MS);
      if (progress >= 1) return { ...creature, progress: 1, status: "safe", pose: "safe" };
      return { ...creature, progress, pose: "moving" };
    });
    const greenElapsedMs = this.state.greenElapsedMs + movementDelta;
    this.state = derive({ ...this.state, greenElapsedMs, phaseElapsedMs: greenElapsedMs, creatures });
    if (greenElapsedMs >= MAX_GREEN_MS) this.resolveRed(true);
    else this.emit();
  }

  private resolveRed(forcedRed: boolean): void {
    const address = { round: this.state.round, turn: this.state.turn } as const;
    const returnedRecord = this.bank.consume(address);
    validateTurnRecord(returnedRecord, this.definitions.map((definition) => definition.id), this.bank.bankId);
    if (turnAddressKey(returnedRecord.address) !== turnAddressKey(address)) {
      throw new Error(`Turn bank returned ${turnAddressKey(returnedRecord.address)} for requested address ${turnAddressKey(address)}.`);
    }
    if (this.consumedRecordIds.has(returnedRecord.id)) {
      throw new Error(`Turn bank reused record ID ${returnedRecord.id} within one run.`);
    }
    this.consumedRecordIds.add(returnedRecord.id);
    const record = snapshotRecord(returnedRecord);

    const wavingIds: string[] = [];
    const stillIds: string[] = [];
    const safeIds: string[] = [];
    const creatures = this.state.creatures.map((creature): CreatureRuntimeState => {
      if (creature.status === "safe") {
        safeIds.push(creature.id);
        return { ...creature, pose: "safe" };
      }
      if (creature.status === "removed") return creature;
      const outcome = record.outcomes[creature.id];
      if (!outcome) throw new Error(`Prepared record ${record.id} has no outcome for ${creature.id}.`);
      if (outcome === "waving") {
        wavingIds.push(creature.id);
        return { ...creature, pose: "waving" };
      }
      stillIds.push(creature.id);
      return { ...creature, pose: "still" };
    });

    this.state = derive({
      ...this.state,
      phase: "reveal",
      phaseElapsedMs: 0,
      currentRecord: record,
      revealedWavingIds: wavingIds,
      revealedStillIds: stillIds,
      revealedSafeIds: safeIds,
      turnZaps: [],
      forcedRed,
      turnPlayerHits: 0,
      turnLeftOperatorHits: 0,
      turnRightOperatorHits: 0,
      revealedWavers: wavingIds.length,
      wavingRemaining: wavingIds.length,
      creatures,
      statusMessage: forcedRed ? "RED triggered automatically." : "RED. Outcomes revealed.",
    });
    this.emit();
  }

  private tickReveal(deltaMs: number): void {
    const phaseElapsedMs = Math.min(REVEAL_MS, this.state.phaseElapsedMs + deltaMs);
    if (phaseElapsedMs < REVEAL_MS) {
      this.state = derive({ ...this.state, phaseElapsedMs });
      this.emit();
      return;
    }
    this.state = derive({
      ...this.state,
      phase: "hunt",
      phaseElapsedMs: 0,
      statusMessage: "Hunt open. Zap only waving creatures.",
    });
    this.emit();
  }

  private tickHunt(deltaMs: number): void {
    const nextElapsed = Math.min(HUNT_MS, this.state.phaseElapsedMs + deltaMs);
    this.state = derive({ ...this.state, phaseElapsedMs: nextElapsed });

    while (this.state.wavingRemaining > 0) {
      const sideHitsThisTurn = this.state.turnLeftOperatorHits + this.state.turnRightOperatorHits;
      const nextZapAt = SIDE_OPERATOR_START_MS + sideHitsThisTurn * SIDE_OPERATOR_INTERVAL_MS;
      if (nextZapAt > nextElapsed || nextZapAt > HUNT_MS) break;
      const operator: SideOperatorId = sideHitsThisTurn % 2 === 0 ? "left" : "right";
      const target = this.nextSideOperatorTarget(operator);
      if (!target) break;
      this.claimCreature(target.id, operator, nextZapAt);
    }

    if (nextElapsed < HUNT_MS) {
      this.emit();
      return;
    }

    this.clearRemainingAtTimeout();
    this.finishHunt();
  }

  private nextSideOperatorTarget(operator: SideOperatorId): CreatureRuntimeState | null {
    const recordId = this.state.currentRecord?.id;
    if (!recordId) throw new Error("Hunt has no current prepared record.");
    const candidates = this.state.creatures.filter((creature) => (
      creature.status === "active" && creature.pose === "waving" && !creature.zappedBy
    ));
    candidates.sort((left, right) => (
      mixSeed(this.seed, recordId, operator, left.id) - mixSeed(this.seed, recordId, operator, right.id)
    ));
    return candidates[0] ?? null;
  }

  private clearRemainingAtTimeout(): void {
    while (this.state.wavingRemaining > 0) {
      const sideHitsThisTurn = this.state.turnLeftOperatorHits + this.state.turnRightOperatorHits;
      const operator: SideOperatorId = sideHitsThisTurn % 2 === 0 ? "left" : "right";
      const target = this.nextSideOperatorTarget(operator);
      if (!target) throw new Error("Waving count disagrees with eligible prepared outcomes.");
      this.claimCreature(target.id, operator, HUNT_MS);
    }
  }

  private claimCreature(
    creatureId: string,
    operator: OperatorId,
    huntElapsedMs = this.state.phaseElapsedMs,
  ): ZapEvent | null {
    const creature = this.state.creatures.find((candidate) => candidate.id === creatureId);
    if (!creature || creature.status !== "active" || creature.pose !== "waving" || creature.zappedBy) return null;
    const scoreDelta = operator === "player" ? CORRECT_HIT_SCORE : 0;
    const event: ZapEvent = Object.freeze({ operator, creatureId, huntElapsedMs, scoreDelta });
    const creatures = this.state.creatures.map((candidate): CreatureRuntimeState => (
      candidate.id === creatureId
        ? { ...candidate, status: "removed", pose: "zapped", zappedBy: operator }
        : candidate
    ));
    this.state = derive({
      ...this.state,
      creatures,
      turnZaps: [...this.state.turnZaps, event],
      playerScore: this.state.playerScore + scoreDelta,
      playerHits: this.state.playerHits + (operator === "player" ? 1 : 0),
      leftOperatorHits: this.state.leftOperatorHits + (operator === "left" ? 1 : 0),
      rightOperatorHits: this.state.rightOperatorHits + (operator === "right" ? 1 : 0),
      turnPlayerHits: this.state.turnPlayerHits + (operator === "player" ? 1 : 0),
      turnLeftOperatorHits: this.state.turnLeftOperatorHits + (operator === "left" ? 1 : 0),
      turnRightOperatorHits: this.state.turnRightOperatorHits + (operator === "right" ? 1 : 0),
      wavingRemaining: this.state.wavingRemaining - 1,
    });
    return event;
  }

  private recordPlayerMiss(statusMessage: string): void {
    this.state = derive({
      ...this.state,
      playerMisses: this.state.playerMisses + 1,
      statusMessage,
    });
    this.emit();
  }

  private finishHunt(): void {
    const record = this.state.currentRecord;
    if (!record) throw new Error("Cannot finish a hunt without its prepared record.");
    if (this.state.wavingRemaining !== 0) throw new Error("Cannot finish a hunt with unresolved waving creatures.");
    const summary: TurnSummary = Object.freeze({
      recordId: record.id,
      bankId: record.bankId,
      address: record.address,
      provenance: record.provenance,
      greenElapsedMs: this.state.greenElapsedMs,
      forcedRed: this.state.forcedRed,
      wavingIds: Object.freeze([...this.state.revealedWavingIds]),
      stillIds: Object.freeze([...this.state.revealedStillIds]),
      safeIds: Object.freeze([...this.state.revealedSafeIds]),
      zaps: Object.freeze([...this.state.turnZaps]),
    });
    const history = [...this.state.history, summary];
    if (this.state.round === TOTAL_ROUNDS && this.state.turn === TURNS_PER_ROUND) {
      this.state = derive({
        ...this.state,
        phase: "descent",
        phaseElapsedMs: 0,
        history,
        creatures: setActivePose(this.state.creatures, "idle"),
        playerMoving: false,
        statusMessage: "Your station is descending to the field.",
      });
    } else if (this.state.turn === TURNS_PER_ROUND) {
      this.state = derive({
        ...this.state,
        phase: "intermission",
        phaseElapsedMs: 0,
        history,
        creatures: setActivePose(this.state.creatures, "idle"),
        statusMessage: `Round ${this.state.round} complete.`,
      });
    } else {
      const nextTurn = this.state.turn + 1;
      this.state = derive({
        ...this.state,
        phase: "ready",
        turn: nextTurn,
        greenElapsedMs: 0,
        phaseElapsedMs: 0,
        currentRecord: null,
        revealedWavingIds: [],
        revealedStillIds: [],
        revealedSafeIds: [],
        turnZaps: [],
        forcedRed: false,
        turnPlayerHits: 0,
        turnLeftOperatorHits: 0,
        turnRightOperatorHits: 0,
        revealedWavers: 0,
        wavingRemaining: 0,
        history,
        creatures: setActivePose(this.state.creatures, "idle"),
        statusMessage: `Round ${this.state.round}, turn ${nextTurn} ready. Progress retained.`,
      });
    }
    this.emit();
  }

  private tickDescent(deltaMs: number): void {
    const phaseElapsedMs = Math.min(DESCENT_MS, this.state.phaseElapsedMs + deltaMs);
    if (phaseElapsedMs < DESCENT_MS) {
      this.state = derive({ ...this.state, phaseElapsedMs });
      this.emit();
      return;
    }
    this.state = derive({
      ...this.state,
      phase: "crossing-ready",
      phaseElapsedMs: 0,
      statusMessage: "You are in the field. The crossing is compulsory.",
    });
    this.emit();
  }

  private tickCrossingGreen(deltaMs: number): void {
    const remaining = Math.max(0, CROSSING_GREEN_MS - this.state.phaseElapsedMs);
    const crossingDelta = Math.min(deltaMs, remaining);
    const playerProgress = this.state.playerMoving
      ? Math.min(0.9, this.state.playerProgress + crossingDelta * PLAYER_PROGRESS_PER_MS)
      : this.state.playerProgress;
    const phaseElapsedMs = this.state.phaseElapsedMs + crossingDelta;
    if (phaseElapsedMs < CROSSING_GREEN_MS) {
      this.state = derive({ ...this.state, phaseElapsedMs, playerProgress });
      this.emit();
      return;
    }
    this.state = derive({
      ...this.state,
      phase: "crossing-red",
      phaseElapsedMs: 0,
      playerProgress,
      playerMoving: false,
      statusMessage: "RED. Your arm rises anyway.",
    });
    this.emit();
  }

  private tickCrossingRed(deltaMs: number): void {
    const phaseElapsedMs = Math.min(CROSSING_RED_MS, this.state.phaseElapsedMs + deltaMs);
    if (phaseElapsedMs < CROSSING_RED_MS) {
      this.state = derive({ ...this.state, phaseElapsedMs });
      this.emit();
      return;
    }
    this.state = derive({
      ...this.state,
      phase: "death",
      phaseElapsedMs: 0,
      statusMessage: "The side operators fire.",
    });
    this.emit();
  }

  private tickDeath(deltaMs: number): void {
    const phaseElapsedMs = Math.min(DEATH_MS, this.state.phaseElapsedMs + deltaMs);
    if (phaseElapsedMs < DEATH_MS) {
      this.state = derive({ ...this.state, phaseElapsedMs });
      this.emit();
      return;
    }
    this.state = derive({
      ...this.state,
      phase: "complete",
      phaseElapsedMs: 0,
      playerMoving: false,
      statusMessage: "Shift complete.",
    });
    this.emit();
  }

  private emit(): void {
    for (const subscriber of this.subscribers) subscriber(this.state);
  }
}

function createInitialState(
  seed: number,
  bankId: string,
  definitions: readonly CreatureDefinition[],
): DontWaveState {
  const creatures: readonly CreatureRuntimeState[] = definitions.map((definition, index) => ({
    ...definition,
    status: "active",
    pose: "idle",
    progress: creatureStartingProgress(definition.id, index),
  }));
  return derive({
    seed,
    bankId,
    phase: "briefing",
    paused: false,
    round: 1,
    totalRounds: TOTAL_ROUNDS,
    turn: 1,
    turnsPerRound: TURNS_PER_ROUND,
    greenElapsedMs: 0,
    phaseElapsedMs: 0,
    huntRemainingMs: 0,
    canTriggerRed: false,
    creatures,
    currentRecord: null,
    revealedWavingIds: [],
    revealedStillIds: [],
    revealedSafeIds: [],
    turnZaps: [],
    forcedRed: false,
    history: [],
    counts: countPopulation(creatures),
    playerScore: 0,
    playerHits: 0,
    playerMisses: 0,
    operatorHits: 0,
    leftOperatorHits: 0,
    rightOperatorHits: 0,
    turnPlayerHits: 0,
    turnLeftOperatorHits: 0,
    turnRightOperatorHits: 0,
    revealedWavers: 0,
    wavingRemaining: 0,
    playerProgress: 0,
    playerMoving: false,
    statusMessage: "Awaiting briefing acknowledgement.",
  });
}

function derive(state: DontWaveState): DontWaveState {
  const huntRemainingMs = state.phase === "reveal"
    ? HUNT_MS
    : state.phase === "hunt"
      ? Math.max(0, HUNT_MS - state.phaseElapsedMs)
      : 0;
  const operatorHits = state.leftOperatorHits + state.rightOperatorHits;
  const canTriggerRed = state.phase === "green"
    && !state.paused
    && state.greenElapsedMs >= MIN_RED_TRIGGER_MS;
  const next = {
    ...state,
    huntRemainingMs,
    canTriggerRed,
    operatorHits,
    counts: countPopulation(state.creatures),
  };
  if (next.currentRecord) {
    const accounted = next.turnPlayerHits
      + next.turnLeftOperatorHits
      + next.turnRightOperatorHits
      + next.wavingRemaining;
    if (accounted !== next.revealedWavers) {
      throw new Error(`Reveal accounting failed: ${accounted} resolved or pending for ${next.revealedWavers} wavers.`);
    }
  }
  return next;
}

function countPopulation(creatures: readonly CreatureRuntimeState[]): PopulationCounts {
  let active = 0;
  let safe = 0;
  let removed = 0;
  for (const creature of creatures) {
    if (creature.status === "active") active += 1;
    else if (creature.status === "safe") safe += 1;
    else removed += 1;
  }
  return { total: creatures.length, active, safe, removed, survivors: active + safe };
}

function setActivePose(
  creatures: readonly CreatureRuntimeState[],
  pose: "idle" | "moving",
): readonly CreatureRuntimeState[] {
  return creatures.map((creature): CreatureRuntimeState => {
    if (creature.status === "active") return { ...creature, pose };
    if (creature.status === "safe") return { ...creature, pose: "safe" };
    return creature;
  });
}

function isPausable(phase: DontWavePhase): boolean {
  return phase !== "briefing" && phase !== "death" && phase !== "complete";
}

function validateBankIdentity(
  bank: TurnBank,
  seed: number,
  definitions: readonly CreatureDefinition[],
): void {
  if (bank.schemaVersion !== TURN_RECORD_SCHEMA_VERSION || bank.modelId !== TURN_RECORD_MODEL_ID) {
    throw new Error(`Turn bank must use schema v2 and model ${TURN_RECORD_MODEL_ID}.`);
  }
  if (bank.seed !== seed) throw new Error(`Turn bank seed ${bank.seed} does not match run seed ${seed}.`);
  const expected = definitions.map((definition) => definition.id).sort();
  const actual = [...bank.creatureIds].sort();
  if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
    throw new Error("Turn bank identity set does not match the run population.");
  }
  if (bank.recordCount() !== TOTAL_ROUNDS * TURNS_PER_ROUND) {
    throw new Error(`Turn bank must contain exactly ${TOTAL_ROUNDS * TURNS_PER_ROUND} prepared records.`);
  }
}

function snapshotRecord(record: TurnRecord): TurnRecord {
  return Object.freeze({
    schemaVersion: record.schemaVersion,
    id: record.id,
    bankId: record.bankId,
    address: Object.freeze({ ...record.address }),
    outcomes: Object.freeze({ ...record.outcomes }),
    provenance: Object.freeze({ ...record.provenance }),
  });
}
