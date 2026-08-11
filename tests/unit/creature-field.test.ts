import { describe, expect, it } from "vitest";
import { CreatureField } from "../../src/game/creatures/CreatureField";
import { DontWaveSession } from "../../src/simulation/DontWaveSession";

describe("the rendered target field", () => {
  it("excludes crossed and evaporated hitboxes from raycast candidates", () => {
    const contestants = new DontWaveSession(7071).getState().contestants;
    const crossed = contestants[0];
    const evaporated = contestants[1];
    if (!crossed || !evaporated) throw new Error("The test population is incomplete.");
    const field = new CreatureField(contestants);

    field.sync(contestants.map((contestant) => {
      if (contestant.id === crossed.id) return { ...contestant, status: "crossed" as const };
      if (contestant.id === evaporated.id) return { ...contestant, status: "evaporated" as const };
      return contestant;
    }), 100, false);

    const ids = field.pickableTargets().map((target) => field.contestantIdForObject(target));
    expect(ids).toHaveLength(contestants.length - 2);
    expect(ids).not.toContain(crossed.id);
    expect(ids).not.toContain(evaporated.id);
    field.dispose();
  });
});
