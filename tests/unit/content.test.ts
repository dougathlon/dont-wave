import { describe, expect, it } from "vitest";
import { createContestantDefinitions } from "../../src/content/creatures";
import {
  CONTESTANT_COUNT,
  FIELD_COLUMNS,
  FIELD_ROWS,
  FINISH_Z,
  distanceToFinish,
  fieldSlot,
} from "../../src/content/fieldLayout";

describe("the reset field", () => {
  it("places a six-by-six crowd entirely behind the tower-side finish", () => {
    expect(CONTESTANT_COUNT).toBe(36);
    expect(FIELD_COLUMNS * FIELD_ROWS).toBe(CONTESTANT_COUNT);
    const slots = Array.from({ length: CONTESTANT_COUNT }, (_, index) => fieldSlot(index));
    expect(slots.every((slot) => slot.startZ < FINISH_Z)).toBe(true);
    expect(slots[0]?.startZ).toBeGreaterThan(slots.at(-1)?.startZ ?? 0);
  });

  it("defines forward progress as increasing z and decreasing finish distance", () => {
    const start = fieldSlot(CONTESTANT_COUNT - 1).startZ;
    const later = start + 2;
    expect(later).toBeGreaterThan(start);
    expect(distanceToFinish(later)).toBeLessThan(distanceToFinish(start));
  });

  it("keeps round populations mechanically aligned while refreshing their grotesque visuals", () => {
    const first = createContestantDefinitions(7071, 1);
    const second = createContestantDefinitions(7071, 2);
    expect(first).toHaveLength(CONTESTANT_COUNT);
    expect(new Set(first.map((contestant) => contestant.id)).size).toBe(CONTESTANT_COUNT);
    expect(second.map(({ id, x, startZ }) => ({ id, x, startZ }))).not.toEqual(
      first.map(({ id, x, startZ }) => ({ id, x, startZ })),
    );
    expect(second.map((contestant) => contestant.startZ)).toEqual(first.map((contestant) => contestant.startZ));
    expect(second.map((contestant) => contestant.visual)).not.toEqual(first.map((contestant) => contestant.visual));
  });
});
