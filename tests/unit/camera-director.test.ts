import { describe, expect, it } from "vitest";
import { CameraDirector } from "../../src/game/CameraDirector";
import { DESCENT_MS, DontWaveSession } from "../../src/simulation/DontWaveSession";
import type { DontWaveState } from "../../src/simulation/types";

describe("ending camera", () => {
  it("keeps a continuous upright orientation throughout the tower descent", () => {
    const director = new CameraDirector();
    const baseline = new DontWaveSession(7071).getState();
    let previousQuaternion: readonly [number, number, number, number] | null = null;

    for (let elapsed = 0; elapsed <= DESCENT_MS; elapsed += 20) {
      const state: DontWaveState = { ...baseline, phase: "descent", phaseElapsedMs: elapsed };
      director.update(state, elapsed, false);
      const snapshot = director.snapshot();
      expect(snapshot.quaternion.every(Number.isFinite)).toBe(true);
      expect(snapshot.screenUp[1]).toBeGreaterThan(0.35);
      if (previousQuaternion) {
        const orientationDot = Math.abs(snapshot.quaternion.reduce((sum, value, index) => (
          sum + value * previousQuaternion![index]!
        ), 0));
        expect(orientationDot).toBeGreaterThan(0.99);
      }
      previousQuaternion = snapshot.quaternion;
    }

    director.dispose();
  });
});
