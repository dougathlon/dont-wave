import { describe, expect, it } from "vitest";
import {
  CORRECT_HIT_SCORE,
  CROSSING_GREEN_MS,
  CROSSING_RED_MS,
  DEATH_MS,
  DESCENT_MS,
  HUNT_MS,
  MAX_GREEN_MS,
  MIN_RED_TRIGGER_MS,
  REVEAL_MS,
  sideOperatorStartMs,
  DontWaveSession,
} from "../../src/simulation/DontWaveSession";
import { TOTAL_ROUNDS, TURNS_PER_ROUND } from "../../src/simulation/observationBank";
import type { DontWaveState, TurnBank, TurnRecord } from "../../src/simulation/types";

describe("Don't Wave v3 session", () => {
  it("enforces the RED gate and auto-triggers the same prepared address at maximum GREEN", () => {
    const manual = new DontWaveSession(7_071);
    manual.start();
    manual.startGreen();
    manual.tick(MIN_RED_TRIGGER_MS - 1);
    expect(manual.getState().canTriggerRed).toBe(false);
    expect(manual.triggerRed()).toBe(false);
    manual.tick(1);
    expect(manual.triggerRed()).toBe(true);
    const manualRecord = manual.getState().currentRecord;

    const forced = new DontWaveSession(7_071);
    forced.start();
    forced.startGreen();
    forced.tick(MAX_GREEN_MS);
    expect(forced.getState()).toMatchObject({ phase: "reveal", forcedRed: true });
    expect(forced.getState().currentRecord).toEqual(manualRecord);
    expect(forced.getState().currentRecord?.address).toEqual({ round: 1, turn: 1 });
  });

  it("makes RED timing a visible scoring-versus-escape tradeoff", () => {
    const early = new DontWaveSession(7_071);
    early.start();
    early.startGreen();
    early.tick(MIN_RED_TRIGGER_MS);
    early.triggerRed();

    const late = new DontWaveSession(7_071);
    late.start();
    late.startGreen();
    late.tick(MAX_GREEN_MS);

    expect(late.getState().counts.safe).toBeGreaterThan(early.getState().counts.safe);
    expect(late.getState().turnEscaped).toBe(late.getState().counts.safe);
    expect(late.getState().revealedWavers).toBeLessThanOrEqual(early.getState().revealedWavers);
    expect(late.getState().currentRecord).toEqual(early.getState().currentRecord);
  });

  it("runs four turns with a report after each hunt and preserves field progress", () => {
    const session = new DontWaveSession(7_071);
    session.start();
    let completedTurns = 0;

    for (let round = 1; round <= TOTAL_ROUNDS; round += 1) {
      for (let turn = 1; turn <= TURNS_PER_ROUND; turn += 1) {
        expect(session.getState()).toMatchObject({ phase: "ready", round, turn });
        enterHunt(session, MIN_RED_TRIGGER_MS);
        session.tick(HUNT_MS);
        completedTurns += 1;
        expect(session.getState()).toMatchObject({ phase: "report", round, turn });
        expect(session.getState().history).toHaveLength(completedTurns);
        const progress = new Map(session.getState().creatures.map((creature) => [creature.id, creature.progress]));
        expect(session.continueFromReport()).toBe(true);
        expect(session.getState().creatures.every((creature) => creature.progress === progress.get(creature.id))).toBe(true);
      }
    }

    expect(session.getState()).toMatchObject({ phase: "descent", round: 2, turn: 2 });
    expect(session.getState().history).toHaveLength(4);
    expect(session.getBank().consumedCount()).toBe(4);
  });

  it("gives the first hunt the longest tower grace window", () => {
    expect(sideOperatorStartMs(1, 1)).toBeGreaterThan(sideOperatorStartMs(1, 2));
    expect(sideOperatorStartMs(1, 2)).toBeGreaterThan(sideOperatorStartMs(2, 1));
    expect(sideOperatorStartMs(2, 1)).toBeGreaterThan(sideOperatorStartMs(2, 2));
  });

  it("lets towers compete without bulk-clearing unresolved wavers at timeout", () => {
    const session = new DontWaveSession(7_071);
    session.start();
    const hunt = enterHunt(session, MIN_RED_TRIGGER_MS);
    expect(hunt.revealedWavers).toBeGreaterThan(0);

    session.tick(HUNT_MS);
    const report = session.getState();
    expect(report.phase).toBe("report");
    expect(report.operatorHits).toBeGreaterThan(0);
    expect(report.wavingRemaining).toBeGreaterThan(0);
    expect(report.history[0]?.unresolvedWavingIds).toHaveLength(report.wavingRemaining);
    expect(report.history[0]?.zaps).toHaveLength(report.operatorHits);
    assertRevealInvariant(report);
  });

  it("ends a hunt as soon as every revealed waver has been claimed", () => {
    const session = new DontWaveSession(7_071);
    session.start();
    const hunt = enterHunt(session, MIN_RED_TRIGGER_MS);
    for (const creatureId of hunt.revealedWavingIds) expect(session.zapCreature(creatureId).accepted).toBe(true);
    expect(session.getState().phase).toBe("hunt");
    session.tick(1);
    expect(session.getState()).toMatchObject({ phase: "report", wavingRemaining: 0 });
  });

  it("awards 100 only for a valid player hit and treats wrong, empty, and late shots as misses", () => {
    const session = new DontWaveSession(7_071);
    session.start();
    const hunt = enterHunt(session, MIN_RED_TRIGGER_MS);
    const wavingId = hunt.revealedWavingIds[0];
    const stillId = hunt.revealedStillIds[0];
    if (!wavingId || !stillId) throw new Error("Prepared turn must contain waving and still creatures.");

    expect(session.zapCreature(wavingId).accepted).toBe(true);
    expect(session.getState()).toMatchObject({ playerScore: CORRECT_HIT_SCORE, playerHits: 1, playerMisses: 0 });
    expect(session.zapCreature(stillId)).toEqual({ accepted: false, reason: "not-waving" });
    expect(session.registerMiss()).toBe(true);
    expect(session.zapCreature(wavingId)).toEqual({ accepted: false, reason: "already-zapped" });
    expect(session.getState()).toMatchObject({ playerScore: CORRECT_HIT_SCORE, playerHits: 1, playerMisses: 3 });
    assertRevealInvariant(session.getState());
  });

  it("freezes GREEN, hunt, and tower clocks while paused", () => {
    const session = new DontWaveSession(7_071);
    session.start();
    session.startGreen();
    session.tick(MIN_RED_TRIGGER_MS);
    const greenBefore = session.getState();
    session.pause();
    session.tick(2_000);
    expect(session.getState().greenElapsedMs).toBe(greenBefore.greenElapsedMs);
    expect(session.getState().creatures.map((creature) => creature.progress))
      .toEqual(greenBefore.creatures.map((creature) => creature.progress));
    session.resume();
    session.triggerRed();
    session.tick(REVEAL_MS);
    session.pause();
    const huntBefore = session.getState();
    session.tick(3_000);
    expect(session.getState().phaseElapsedMs).toBe(huntBefore.phaseElapsedMs);
    expect(session.getState().operatorHits).toBe(huntBefore.operatorHits);
    session.resume();
    session.tick(sideOperatorStartMs(1, 1));
    expect(session.getState().operatorHits).toBe(1);
  });

  it("reuses the rule in the compulsory crossing and records whether the player stopped", () => {
    const session = driveToDescent(7_071);
    expect(session.getState().history).toHaveLength(4);
    expect(session.getBank().consumedCount()).toBe(4);

    session.tick(DESCENT_MS);
    expect(session.getState().phase).toBe("crossing-ready");
    session.beginCrossing();
    session.setPlayerMoving(true);
    session.tick(CROSSING_GREEN_MS / 2);
    session.setPlayerMoving(false);
    session.tick(CROSSING_GREEN_MS / 2);
    expect(session.getState()).toMatchObject({ phase: "crossing-red", playerStoppedAtRed: true, playerMoving: false });
    session.tick(CROSSING_RED_MS);
    expect(session.getState().phase).toBe("death");
    session.tick(DEATH_MS);
    expect(session.getState()).toMatchObject({ phase: "complete", playerStoppedAtRed: true });
    expect(session.getBank().consumedCount()).toBe(4);
  });

  it("replays an identical command timeline deterministically", () => {
    expect(driveToDescent(73_031).getState()).toEqual(driveToDescent(73_031).getState());
  });

  it("rejects mismatched banks and legacy-shaped returned addresses before state changes", () => {
    const sourceSession = new DontWaveSession(106);
    const source = sourceSession.getBank();
    expect(() => new DontWaveSession(107, { bank: source })).toThrow("seed");

    const wrongAddressBank: TurnBank = {
      schemaVersion: 3,
      modelId: "dw-prepared-turn-v3",
      bankId: source.bankId,
      seed: source.seed,
      creatureIds: source.creatureIds,
      getRecord: (address) => source.getRecord(address),
      consume: (address) => ({
        ...source.getRecord(address),
        address: { ...address, timingBucket: 1, tuning: "coral" },
      }) as unknown as TurnRecord,
      resetConsumption: () => undefined,
      consumedCount: () => 0,
      recordCount: () => 4,
    };
    const session = new DontWaveSession(106, { bank: wrongAddressBank });
    session.start();
    session.startGreen();
    session.tick(MIN_RED_TRIGGER_MS);
    expect(() => session.triggerRed()).toThrow("exactly round, turn");
    expect(session.getState()).toMatchObject({ phase: "green", history: [] });
  });
});

function enterHunt(session: DontWaveSession, greenMs: number): DontWaveState {
  expect(session.startGreen()).toBe(true);
  session.tick(greenMs);
  if (session.getState().phase === "green") expect(session.triggerRed()).toBe(true);
  expect(session.getState().phase).toBe("reveal");
  session.tick(REVEAL_MS);
  expect(session.getState().phase).toBe("hunt");
  assertRevealInvariant(session.getState());
  return session.getState();
}

function driveToDescent(seed: number): DontWaveSession {
  const session = new DontWaveSession(seed);
  session.start();
  for (let turnIndex = 0; turnIndex < TOTAL_ROUNDS * TURNS_PER_ROUND; turnIndex += 1) {
    enterHunt(session, MIN_RED_TRIGGER_MS);
    session.tick(HUNT_MS);
    expect(session.getState().phase).toBe("report");
    session.continueFromReport();
  }
  return session;
}

function assertRevealInvariant(state: DontWaveState): void {
  expect(
    state.turnPlayerHits
      + state.turnLeftOperatorHits
      + state.turnRightOperatorHits
      + state.wavingRemaining,
  ).toBe(state.revealedWavers);
}
