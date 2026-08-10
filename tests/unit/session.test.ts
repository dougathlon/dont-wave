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
  SIDE_OPERATOR_START_MS,
  DontWaveSession,
} from "../../src/simulation/DontWaveSession";
import type { DontWaveState, TurnBank, TurnRecord } from "../../src/simulation/types";

describe("Don't Wave v2 session", () => {
  it("enforces the minimum RED gate and auto-triggers at maximum GREEN without changing the prepared address", () => {
    const manual = new DontWaveSession(7_071);
    expect(manual.start()).toBe(true);
    expect(manual.startGreen()).toBe(true);
    manual.tick(MIN_RED_TRIGGER_MS - 1);
    expect(manual.getState().canTriggerRed).toBe(false);
    expect(manual.triggerRed()).toBe(false);
    expect(manual.getBank().consumedCount()).toBe(0);
    manual.tick(1);
    expect(manual.getState().canTriggerRed).toBe(true);
    expect(manual.triggerRed()).toBe(true);
    const manualRecord = manual.getState().currentRecord;

    const forced = new DontWaveSession(7_071);
    forced.start();
    forced.startGreen();
    forced.tick(4_500);
    expect(forced.getState()).toMatchObject({ phase: "reveal", forcedRed: true, canTriggerRed: false });
    expect(forced.getBank().consumedCount()).toBe(1);
    expect(forced.getState().currentRecord).toEqual(manualRecord);
    expect(forced.getState().currentRecord?.address).toEqual({ round: 1, turn: 1 });
  });

  it("runs exactly two rounds of four turns with one round intermission and persistent progress", () => {
    const session = new DontWaveSession(7_071);
    session.start();

    for (let round = 1; round <= 2; round += 1) {
      for (let turn = 1; turn <= 4; turn += 1) {
        expect(session.getState()).toMatchObject({ phase: "ready", round, turn });
        const reveal = enterHunt(session, MIN_RED_TRIGGER_MS);
        expect(reveal.revealedWavers).toBeGreaterThan(0);
        expect(reveal.counts.survivors).toBeGreaterThan(0);
        assertRevealInvariant(reveal);

        session.tick(HUNT_MS);
        const afterHunt = session.getState();
        expect(afterHunt.history).toHaveLength((round - 1) * 4 + turn);
        expect(afterHunt.counts.survivors).toBeGreaterThan(0);

        if (turn < 4) {
          expect(afterHunt).toMatchObject({ phase: "ready", round, turn: turn + 1 });
        } else if (round === 1) {
          expect(afterHunt).toMatchObject({ phase: "intermission", round: 1, turn: 4 });
          const progress = new Map(afterHunt.creatures.map((creature) => [creature.id, creature.progress]));
          expect(session.continueRound()).toBe(true);
          expect(session.getState()).toMatchObject({ phase: "ready", round: 2, turn: 1 });
          expect(session.getState().creatures.every((creature) => creature.progress === progress.get(creature.id))).toBe(true);
        } else {
          expect(afterHunt).toMatchObject({ phase: "descent", round: 2, turn: 4 });
        }
      }
    }

    expect(session.getState().history).toHaveLength(8);
    expect(session.getBank().consumedCount()).toBe(8);
    expect(session.continueRound()).toBe(false);
  });

  it("keeps visible targets through all eight maximum-GREEN turns", () => {
    const session = new DontWaveSession(7_071);
    session.start();

    for (let round = 1; round <= 2; round += 1) {
      for (let turn = 1; turn <= 4; turn += 1) {
        expect(session.startGreen()).toBe(true);
        session.tick(MAX_GREEN_MS);
        const reveal = session.getState();
        expect(reveal).toMatchObject({ phase: "reveal", round, turn, forcedRed: true });
        expect(reveal.revealedWavers).toBeGreaterThan(0);
        expect(reveal.counts.active).toBeGreaterThan(0);

        session.tick(REVEAL_MS);
        session.tick(HUNT_MS);
        if (round === 1 && turn === 4) expect(session.continueRound()).toBe(true);
      }
    }

    expect(session.getState()).toMatchObject({ phase: "descent", round: 2, turn: 4 });
    expect(session.getState().counts.active).toBeGreaterThan(0);
    expect(session.getState().counts.safe).toBeGreaterThan(0);
    expect(session.getState().counts.survivors).toBeGreaterThan(0);
  });

  it("awards 100 only for a player hit and records wrong, empty, and late clicks as misses", () => {
    const session = new DontWaveSession(7_071);
    session.start();
    const hunt = enterHunt(session, MIN_RED_TRIGGER_MS);
    const wavingId = hunt.revealedWavingIds[0];
    const stillId = hunt.revealedStillIds[0];
    if (!wavingId || !stillId) throw new Error("Curated turn must include waving and still creatures.");

    const hit = session.zapCreature(wavingId);
    expect(hit.accepted).toBe(true);
    expect(session.getState()).toMatchObject({
      playerScore: CORRECT_HIT_SCORE,
      playerHits: 1,
      turnPlayerHits: 1,
      playerMisses: 0,
    });

    expect(session.zapCreature(stillId)).toEqual({ accepted: false, reason: "not-waving" });
    expect(session.registerMiss()).toBe(true);
    expect(session.zapCreature(wavingId)).toEqual({ accepted: false, reason: "already-zapped" });
    expect(session.getState()).toMatchObject({ playerScore: CORRECT_HIT_SCORE, playerHits: 1, playerMisses: 3 });
    assertRevealInvariant(session.getState());
  });

  it("lets side operators race the player, then assigns every unresolved waver at timeout", () => {
    const session = new DontWaveSession(7_071);
    session.start();
    const hunt = enterHunt(session, MIN_RED_TRIGGER_MS);
    const revealedWavers = hunt.revealedWavers;
    const playerTarget = hunt.revealedWavingIds[0];
    if (!playerTarget) throw new Error("Curated turn must include a player target.");
    session.zapCreature(playerTarget);

    session.tick(SIDE_OPERATOR_START_MS);
    const afterLeft = session.getState();
    expect(afterLeft).toMatchObject({ phase: "hunt", leftOperatorHits: 1, rightOperatorHits: 0 });
    const leftTarget = afterLeft.turnZaps.find((event) => event.operator === "left")?.creatureId;
    if (!leftTarget) throw new Error("Left operator must claim one target at its reaction time.");
    expect(session.zapCreature(leftTarget)).toEqual({ accepted: false, reason: "already-zapped" });
    assertRevealInvariant(session.getState());

    session.tick(HUNT_MS - SIDE_OPERATOR_START_MS);
    const finished = session.getState();
    expect(finished).toMatchObject({ phase: "ready", turn: 2, wavingRemaining: 0 });
    const summary = finished.history[0];
    expect(summary?.zaps).toHaveLength(revealedWavers);
    expect(summary?.zaps.filter((event) => event.operator === "player")).toHaveLength(1);
    expect(finished.operatorHits).toBe(finished.leftOperatorHits + finished.rightOperatorHits);
    expect(finished.playerHits + finished.operatorHits).toBe(revealedWavers);
  });

  it("freezes GREEN and hunt clocks, movement, and NPC actions while paused", () => {
    const session = new DontWaveSession(7_071);
    session.start();
    session.startGreen();
    session.tick(MIN_RED_TRIGGER_MS);
    const greenBefore = session.getState();
    expect(greenBefore.canTriggerRed).toBe(true);
    expect(session.pause()).toBe(true);
    expect(session.getState().canTriggerRed).toBe(false);
    session.tick(2_000);
    expect(session.getState().greenElapsedMs).toBe(greenBefore.greenElapsedMs);
    expect(session.getState().creatures.map((creature) => creature.progress))
      .toEqual(greenBefore.creatures.map((creature) => creature.progress));
    expect(session.resume()).toBe(true);
    expect(session.getState().canTriggerRed).toBe(true);

    session.triggerRed();
    session.tick(REVEAL_MS);
    expect(session.pause()).toBe(true);
    const huntBefore = session.getState();
    session.tick(2_000);
    expect(session.getState().phaseElapsedMs).toBe(huntBefore.phaseElapsedMs);
    expect(session.getState().operatorHits).toBe(huntBefore.operatorHits);
    session.resume();
    session.tick(SIDE_OPERATOR_START_MS);
    expect(session.getState().leftOperatorHits).toBe(1);
  });

  it("forces the player crossing, compulsory wave, death, and completion without consuming a ninth record", () => {
    const session = driveToDescent(7_071);
    expect(session.getState()).toMatchObject({ phase: "descent", round: 2, turn: 4 });
    expect(session.getState().history).toHaveLength(8);
    expect(session.getBank().consumedCount()).toBe(8);

    session.tick(DESCENT_MS);
    expect(session.getState().phase).toBe("crossing-ready");
    expect(session.beginCrossing()).toBe(true);
    expect(session.setPlayerMoving(true)).toBe(true);
    session.tick(CROSSING_GREEN_MS / 2);
    expect(session.getState().playerProgress).toBeGreaterThan(0);
    session.setPlayerMoving(false);
    session.tick(CROSSING_GREEN_MS / 2);
    expect(session.getState()).toMatchObject({ phase: "crossing-red", playerMoving: false });
    expect(session.getBank().consumedCount()).toBe(8);

    session.tick(CROSSING_RED_MS);
    expect(session.getState().phase).toBe("death");
    expect(session.pause()).toBe(false);
    session.tick(DEATH_MS);
    expect(session.getState().phase).toBe("complete");
    expect(session.getBank().consumedCount()).toBe(8);
    expect(session.getState().history).toHaveLength(8);
  });

  it("replays an identical command timeline deterministically", () => {
    expect(driveToDescent(73_031).getState()).toEqual(driveToDescent(73_031).getState());
  });

  it("rejects mismatched banks and v1-shaped returned addresses before state changes", () => {
    const sourceSession = new DontWaveSession(106);
    const source = sourceSession.getBank();
    expect(() => new DontWaveSession(107, { bank: source })).toThrow("seed");

    const wrongAddressBank: TurnBank = {
      schemaVersion: 2,
      modelId: "dw-prepared-turn-v2",
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
      recordCount: () => 8,
    };
    const session = new DontWaveSession(106, { bank: wrongAddressBank });
    session.start();
    session.startGreen();
    session.tick(MIN_RED_TRIGGER_MS);
    expect(() => session.triggerRed()).toThrow("exactly round, turn");
    expect(session.getState()).toMatchObject({ phase: "green", history: [] });
  });

  it("keeps the current reveal accounting identity exact throughout player and NPC claims", () => {
    const session = new DontWaveSession(7_071);
    session.start();
    const hunt = enterHunt(session, MIN_RED_TRIGGER_MS);
    assertRevealInvariant(hunt);
    for (const creatureId of hunt.revealedWavingIds.slice(0, 3)) {
      session.zapCreature(creatureId);
      assertRevealInvariant(session.getState());
    }
    session.tick(2_000);
    assertRevealInvariant(session.getState());
  });
});

function enterHunt(session: DontWaveSession, greenMs: number): DontWaveState {
  expect(session.startGreen()).toBe(true);
  session.tick(greenMs);
  if (session.getState().phase === "green") expect(session.triggerRed()).toBe(true);
  expect(session.getState().phase).toBe("reveal");
  const reveal = session.getState();
  assertRevealInvariant(reveal);
  session.tick(REVEAL_MS);
  expect(session.getState().phase).toBe("hunt");
  return session.getState();
}

function driveToDescent(seed: number): DontWaveSession {
  const session = new DontWaveSession(seed);
  session.start();
  for (let round = 1; round <= 2; round += 1) {
    for (let turn = 1; turn <= 4; turn += 1) {
      enterHunt(session, MIN_RED_TRIGGER_MS);
      session.tick(HUNT_MS);
      if (turn === 4 && round === 1) expect(session.continueRound()).toBe(true);
    }
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
