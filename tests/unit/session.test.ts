import { describe, expect, it } from "vitest";
import { FINISH_Z } from "../../src/content/fieldLayout";
import {
  CHARGE_STEP_MS,
  CORRECT_SCORE,
  CROWD_SPEED,
  CROSSING_GREEN_MS,
  CROSSING_RED_MS,
  DEATH_MS,
  DESCENT_MS,
  HUNT_MS,
  INTERTURN_MS,
  MAX_AMMO,
  MAX_GREEN_MS,
  REVEAL_MS,
  RIVAL_FIRST_SHOT_MS,
  WRONG_SCORE,
  DontWaveSession,
} from "../../src/simulation/DontWaveSession";

describe("Don't Wave reset session", () => {
  it("moves every active contestant toward the tower and never backward", () => {
    const session = readySession();
    expect(session.startGreen()).toBe(true);
    const before = session.getState().contestants.map(({ id, z }) => ({ id, z }));
    session.tick(1_000);
    const after = session.getState().contestants;
    for (const initial of before) {
      const current = after.find((contestant) => contestant.id === initial.id);
      expect(current).toBeDefined();
      expect(current!.z).toBeGreaterThan(initial.z);
      expect(current!.z - initial.z).toBeCloseTo(CROWD_SPEED, 6);
      expect(FINISH_Z - current!.z).toBeLessThan(FINISH_Z - initial.z);
    }
  });

  it.each([
    ["earliest RED", CHARGE_STEP_MS],
    ["forced RED", MAX_GREEN_MS],
  ])("keeps literal wavers visible on every turn under %s play", (_label, greenMs) => {
    const session = readySession();
    let sawCrossing = false;
    for (let round = 1; round <= 2; round += 1) {
      for (let turn = 1; turn <= 4; turn += 1) {
        const reveal = revealTurn(session, greenMs);
        expect(reveal.round).toBe(round);
        expect(reveal.turn).toBe(turn);
        const address = `R${round}T${turn}`;
        expect(reveal.counts.active, `${address} active`).toBeGreaterThan(0);
        expect(reveal.revealedWavers, `${address} wavers`).toBeGreaterThanOrEqual(2);
        expect(reveal.revealedStills, `${address} stills`).toBeGreaterThan(0);
        sawCrossing ||= reveal.counts.crossed > 0;
        settleTurn(session);
      }
      if (round === 1) expect(session.continueRound()).toBe(true);
    }
    if (greenMs === MAX_GREEN_MS) expect(sawCrossing).toBe(true);
  });

  it.each([
    ["earliest RED", CHARGE_STEP_MS],
    ["forced RED", MAX_GREEN_MS],
  ])("preserves a playable reveal after six correct hits on every prior turn under %s play", (_label, greenMs) => {
    const session = readySession();
    for (let round = 1; round <= 2; round += 1) {
      for (let turn = 1; turn <= 4; turn += 1) {
        const reveal = revealTurn(session, greenMs);
        expect(reveal.revealedWavers, `R${round}T${turn} wavers`).toBeGreaterThan(0);
        expect(reveal.revealedStills, `R${round}T${turn} stills`).toBeGreaterThan(0);
        session.tick(REVEAL_MS);
        while (session.getState().ammo > 0) {
          const target = session.getState().contestants.find((contestant) => (
            contestant.status === "active" && contestant.pose === "waving"
          ));
          if (!target) break;
          expect(session.fire(target.id).fired).toBe(true);
        }
        settleHunt(session);
      }
      if (round === 1) expect(session.continueRound()).toBe(true);
    }
    expect(session.getState().phase).toBe("final-standings");
  });

  it("charges at exact 750ms boundaries, caps at six, and gates RED", () => {
    const session = readySession();
    session.startGreen();
    session.tick(CHARGE_STEP_MS - 1);
    expect(session.getState().ammo).toBe(0);
    expect(session.getState().canCallRed).toBe(false);
    expect(session.triggerRed()).toBe(false);
    session.tick(1);
    expect(session.getState().ammo).toBe(1);
    expect(session.getState().canCallRed).toBe(true);
    session.tick(CHARGE_STEP_MS * 7);
    expect(session.getState().ammo).toBe(MAX_AMMO);
  });

  it("forces RED once at 5.5 seconds after applying forward movement", () => {
    const session = readySession();
    const frontStart = session.getState().contestants[0]?.z ?? 0;
    session.startGreen();
    session.tick(MAX_GREEN_MS);
    const state = session.getState();
    expect(state.phase).toBe("reveal");
    expect(state.forcedRed).toBe(true);
    expect(state.greenElapsedMs).toBe(MAX_GREEN_MS);
    expect(state.ammoAtRed).toBe(MAX_AMMO);
    expect(state.contestants[0]?.z).toBeGreaterThan(frontStart);
    expect(state.currentRecord?.address).toEqual({ round: 1, turn: 1 });
    expect(session.getBank().consumedCount()).toBe(1);
  });

  it("partitions every visible active body into an unmistakable still or waving state", () => {
    const session = enterHunt();
    const state = session.getState();
    const resolved = state.contestants.filter((contestant) => contestant.status === "active");
    expect(resolved.every((contestant) => contestant.pose === "still" || contestant.pose === "waving")).toBe(true);
    expect(state.revealedWavers + state.revealedStills).toBe(resolved.length);
    expect(state.phase).toBe("hunt");
  });

  it("scores correct, wrong, empty, and out-of-ammo shots distinctly", () => {
    const session = enterHunt();
    const waver = session.getState().contestants.find((contestant) => contestant.pose === "waving");
    const still = session.getState().contestants.find((contestant) => contestant.pose === "still");
    expect(waver).toBeDefined();
    expect(still).toBeDefined();

    const correct = session.fire(waver!.id);
    expect(correct.fired && correct.event.outcome).toBe("correct");
    expect(session.getState().playerScore).toBe(CORRECT_SCORE);
    expect(session.getState().contestants.find((contestant) => contestant.id === waver!.id)?.status).toBe("evaporated");

    const wrong = session.fire(still!.id);
    expect(wrong.fired && wrong.event.outcome).toBe("wrong");
    expect(session.getState().playerScore).toBe(CORRECT_SCORE + WRONG_SCORE);
    expect(session.getState().contestants.find((contestant) => contestant.id === still!.id)?.status).toBe("evaporated");

    const empty = session.fire(null);
    expect(empty.fired && empty.event.outcome).toBe("empty");
    expect(session.getState().playerScore).toBe(0);
    while (session.getState().ammo > 0) expect(session.fire(null).fired).toBe(true);
    expect(session.fire(null)).toEqual({ fired: false, reason: "no-ammo" });
  });

  it("provides a literal five-second uncontested player window", () => {
    const session = enterHunt();
    session.tick(HUNT_MS - 1);
    expect(session.getState().phase).toBe("hunt");
    expect(session.getState().leftScore).toBe(0);
    expect(session.getState().rightScore).toBe(0);
    session.tick(1);
    expect(session.getState().phase).toBe("rivals");
    expect(session.getState().leftScore).toBe(0);
    expect(session.getState().rightScore).toBe(0);
    session.tick(RIVAL_FIRST_SHOT_MS - 1);
    expect(session.getState().leftScore + session.getState().rightScore).toBe(0);
    session.tick(1);
    expect(session.getState().leftScore + session.getState().rightScore).toBeGreaterThan(0);
    expect(session.fire(null)).toEqual({ fired: false, reason: "not-hunting" });
  });

  it("limits each rival independently and never bulk-clears remaining wavers", () => {
    const session = enterHunt(CHARGE_STEP_MS);
    session.tick(HUNT_MS);
    settleRivals(session);
    const state = session.getState();
    expect(state.turnLeftHits).toBeLessThanOrEqual(2);
    expect(state.turnRightHits).toBeLessThanOrEqual(2);
    expect(state.leftScore).toBe(state.turnLeftHits * 100);
    expect(state.rightScore).toBe(state.turnRightHits * 100);
    expect(state.phase).toBe("interturn");
    expect(state.history[0]?.unresolvedWavers).toBeGreaterThan(0);
  });

  it("alternates which rival receives an odd final target", () => {
    const session = readySession();
    for (let turn = 0; turn < 4; turn += 1) completeTurn(session);
    expect(session.continueRound()).toBe(true);

    const summaries = [];
    for (let turn = 0; turn < 2; turn += 1) {
      revealTurn(session, CHARGE_STEP_MS);
      session.tick(REVEAL_MS);
      const target = session.getState().contestants.find((contestant) => (
        contestant.status === "active" && contestant.pose === "waving"
      ));
      expect(target).toBeDefined();
      expect(session.fire(target!.id).fired).toBe(true);
      settleHunt(session);
      summaries.push(session.getState().history.at(-1));
    }

    expect([summaries[0]?.leftHits, summaries[0]?.rightHits]).toEqual([3, 2]);
    expect([summaries[1]?.leftHits, summaries[1]?.rightHits]).toEqual([2, 3]);
  });

  it("lets unresolved wavers lower their arms and continue forward on the next GREEN", () => {
    const session = enterHunt(CHARGE_STEP_MS);
    session.tick(HUNT_MS);
    settleRivals(session);
    const unresolvedId = session.getState().contestants.find((contestant) => (
      contestant.status === "active" && contestant.pose === "idle"
    ))?.id;
    expect(unresolvedId).toBeDefined();
    const beforeZ = session.getState().contestants.find((contestant) => contestant.id === unresolvedId)?.z ?? 0;
    session.tick(INTERTURN_MS);
    expect(session.getState().phase).toBe("ready");
    session.startGreen();
    session.tick(500);
    const resumed = session.getState().contestants.find((contestant) => contestant.id === unresolvedId);
    expect(resumed?.pose).toBe("walking");
    expect(resumed?.z).toBeGreaterThan(beforeZ);
  });

  it("runs exactly eight turns, refreshes round two, and keeps all three scores separate", () => {
    const session = readySession();
    const firstCrowd = session.getState().contestants.map((contestant) => contestant.visual);
    for (let turn = 0; turn < 4; turn += 1) completeTurn(session);
    expect(session.getState().phase).toBe("round-break");
    expect(session.getState().history).toHaveLength(4);
    expect(session.continueRound()).toBe(true);
    expect(session.getState().round).toBe(2);
    expect(session.getState().turn).toBe(1);
    expect(session.getState().contestants.map((contestant) => contestant.visual)).not.toEqual(firstCrowd);
    expect(session.getState().counts.active).toBe(session.getState().counts.total);
    for (let turn = 0; turn < 4; turn += 1) completeTurn(session);
    const final = session.getState();
    expect(final.phase).toBe("final-standings");
    expect(final.history).toHaveLength(8);
    expect(new Set(final.history.map((summary) => summary.recordId)).size).toBe(8);
    expect(session.getBank().consumedCount()).toBe(8);
    expect(final.leftScore).toBeGreaterThan(0);
    expect(final.rightScore).toBeGreaterThan(0);
  });

  it("ends with forward movement, an unavoidable RED, death, and replay reset", () => {
    const session = readySession();
    for (let turn = 0; turn < 4; turn += 1) completeTurn(session);
    session.continueRound();
    for (let turn = 0; turn < 4; turn += 1) completeTurn(session);
    expect(session.leaveTower()).toBe(true);
    session.tick(DESCENT_MS);
    expect(session.getState().phase).toBe("crossing-ready");
    session.beginCrossing();
    session.setPlayerMoving(true);
    session.tick(CROSSING_GREEN_MS);
    expect(session.getState().phase).toBe("crossing-red");
    expect(session.getState().playerMoving).toBe(false);
    expect(session.getState().playerProgress).toBeGreaterThan(0);
    session.tick(CROSSING_RED_MS);
    expect(session.getState().phase).toBe("death");
    session.tick(DEATH_MS);
    expect(session.getState().phase).toBe("complete");
    session.restart();
    const replay = session.getState();
    expect(replay.phase).toBe("briefing");
    expect(replay.history).toHaveLength(0);
    expect(replay.playerScore + replay.leftScore + replay.rightScore).toBe(0);
    expect(replay.counts.active).toBe(replay.counts.total);
  });

  it("preserves elapsed time across automatic phase boundaries", () => {
    const session = readySession();
    session.startGreen();
    session.tick(CHARGE_STEP_MS);
    expect(session.triggerRed()).toBe(true);
    session.tick(REVEAL_MS + 123);
    expect(session.getState().phase).toBe("hunt");
    expect(session.getState().phaseElapsedMs).toBe(123);

    session.tick(HUNT_MS - 123 + RIVAL_FIRST_SHOT_MS);
    expect(session.getState().phase).toBe("rivals");
    expect(session.getState().phaseElapsedMs).toBe(RIVAL_FIRST_SHOT_MS);
    expect(session.getState().leftScore + session.getState().rightScore).toBeGreaterThan(0);
  });
});

function readySession(): DontWaveSession {
  const session = new DontWaveSession(7071);
  expect(session.start()).toBe(true);
  return session;
}

function enterHunt(greenMs = CHARGE_STEP_MS * MAX_AMMO): DontWaveSession {
  const session = readySession();
  session.startGreen();
  session.tick(greenMs);
  expect(session.triggerRed()).toBe(true);
  session.tick(REVEAL_MS);
  return session;
}

function completeTurn(session: DontWaveSession): void {
  revealTurn(session, CHARGE_STEP_MS * MAX_AMMO);
  settleTurn(session);
}

function revealTurn(session: DontWaveSession, greenMs: number) {
  expect(session.getState().phase).toBe("ready");
  expect(session.startGreen()).toBe(true);
  session.tick(greenMs);
  if (greenMs < MAX_GREEN_MS) expect(session.triggerRed()).toBe(true);
  expect(session.getState().phase).toBe("reveal");
  return session.getState();
}

function settleTurn(session: DontWaveSession): void {
  session.tick(REVEAL_MS);
  settleHunt(session);
}

function settleHunt(session: DontWaveSession): void {
  session.tick(HUNT_MS);
  settleRivals(session);
  session.tick(INTERTURN_MS);
}

function settleRivals(session: DontWaveSession): void {
  for (let step = 0; step < 50 && session.getState().phase === "rivals"; step += 1) {
    session.tick(50);
  }
  expect(session.getState().phase).toBe("interturn");
}
