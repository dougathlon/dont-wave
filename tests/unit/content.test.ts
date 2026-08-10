import { describe, expect, it } from "vitest";
import { createCreatureDefinitions, DEFAULT_POPULATION_SIZE } from "../../src/content/creatures";

describe("creature content", () => {
  it("creates 96 stable, unique identities with cosmetic variation only", () => {
    const first = createCreatureDefinitions(7_071);
    const second = createCreatureDefinitions(7_071);

    expect(first).toEqual(second);
    expect(first).toHaveLength(DEFAULT_POPULATION_SIZE);
    expect(new Set(first.map((creature) => creature.id)).size).toBe(DEFAULT_POPULATION_SIZE);
    expect(new Set(first.map((creature) => creature.name)).size).toBe(DEFAULT_POPULATION_SIZE);
    expect(new Set(first.map((creature) => JSON.stringify(creature.visual))).size).toBe(DEFAULT_POPULATION_SIZE);
    expect(first.every((creature) => Object.keys(creature).sort().join(",") === "id,name,visual")).toBe(true);
  });

  it("has no cohort, group, type, class, speed, hitbox, probability, or eligibility field", () => {
    const creatures = createCreatureDefinitions(31);
    const serialized = JSON.stringify(creatures);

    for (const forbidden of [
      "cohort",
      "relationshipGroup",
      "creatureType",
      "creatureClass",
      "movementRate",
      "hitbox",
      "probability",
      "eligibility",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("keeps identity labels stable while seeded visual traits vary", () => {
    const first = createCreatureDefinitions(12);
    const second = createCreatureDefinitions(13);

    expect(second.map(({ id, name }) => ({ id, name }))).toEqual(first.map(({ id, name }) => ({ id, name })));
    expect(second.map((creature) => creature.visual)).not.toEqual(first.map((creature) => creature.visual));
  });

  it("rejects empty, fractional, and oversized populations", () => {
    expect(() => createCreatureDefinitions(1, 0)).toThrow("integer");
    expect(() => createCreatureDefinitions(1, 1.5)).toThrow("integer");
    expect(() => createCreatureDefinitions(1, DEFAULT_POPULATION_SIZE + 1)).toThrow("integer");
  });
});
