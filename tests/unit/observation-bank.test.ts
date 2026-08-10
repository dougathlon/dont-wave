import { describe, expect, it } from "vitest";
import { createCreatureDefinitions } from "../../src/content/creatures";
import {
  ClassicalDemoTurnBank,
  TOTAL_ROUNDS,
  TURN_RECORD_MODEL_ID,
  TURNS_PER_ROUND,
  WAVERS_PER_RECORD,
  turnAddressKey,
  validateTurnRecord,
} from "../../src/simulation/observationBank";
import type { TurnAddress, TurnRecord } from "../../src/simulation/types";

describe("prepared turn bank v3", () => {
  it("prepares exactly four deterministic identity-bound records keyed only by round and turn", () => {
    const creatures = createCreatureDefinitions(7_071);
    const first = new ClassicalDemoTurnBank(7_071, creatures);
    const second = new ClassicalDemoTurnBank(7_071, creatures);

    expect(first.recordCount()).toBe(TOTAL_ROUNDS * TURNS_PER_ROUND);
    expect(first.recordCount()).toBe(4);
    for (let round = 1; round <= TOTAL_ROUNDS; round += 1) {
      for (let turn = 1; turn <= TURNS_PER_ROUND; turn += 1) {
        const address = { round, turn };
        const record = first.getRecord(address);
        expect(record).toEqual(second.getRecord(address));
        expect(Object.keys(record.address).sort()).toEqual(["round", "turn"]);
        expect(Object.keys(record.outcomes)).toHaveLength(48);
        expect(Object.values(record.outcomes).filter((outcome) => outcome === "waving")).toHaveLength(WAVERS_PER_RECORD);
        expect(record).toMatchObject({
          schemaVersion: 3,
          address,
          provenance: {
            kind: "classical-demo",
            modelId: TURN_RECORD_MODEL_ID,
            preparedBeforePlay: true,
            bindingMethod: "stable-creature-id",
          },
        });
      }
    }
  });

  it("gives curated seed 7071 both visible targets and non-targets in every prepared turn", () => {
    const bank = new ClassicalDemoTurnBank(7_071, createCreatureDefinitions(7_071));
    for (let round = 1; round <= TOTAL_ROUNDS; round += 1) {
      for (let turn = 1; turn <= TURNS_PER_ROUND; turn += 1) {
        const outcomes = Object.values(bank.getRecord({ round, turn }).outcomes);
        expect(outcomes.filter((outcome) => outcome === "waving").length).toBeGreaterThan(0);
        expect(outcomes.filter((outcome) => outcome === "still").length).toBeGreaterThan(0);
      }
    }
  });

  it("consumes each address once and restores consumption only on explicit reset", () => {
    const bank = new ClassicalDemoTurnBank(81, createCreatureDefinitions(81));
    const address = { round: 1, turn: 1 };

    expect(bank.consumedCount()).toBe(0);
    bank.getRecord(address);
    expect(bank.consumedCount()).toBe(0);
    bank.consume(address);
    expect(bank.consumedCount()).toBe(1);
    expect(() => bank.consume(address)).toThrow("already been consumed");
    bank.resetConsumption();
    expect(bank.consume(address).address).toEqual(address);
  });

  it("freezes the complete prepared record graph", () => {
    const creatures = createCreatureDefinitions(83);
    const record = new ClassicalDemoTurnBank(83, creatures).getRecord({ round: 1, turn: 1 });
    const creatureId = creatures[0]?.id ?? "missing";
    const original = record.outcomes[creatureId];

    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.address)).toBe(true);
    expect(Object.isFrozen(record.outcomes)).toBe(true);
    expect(Object.isFrozen(record.provenance)).toBe(true);
    expect(() => {
      (record.outcomes as Record<string, "still" | "waving">)[creatureId] = original === "waving" ? "still" : "waving";
    }).toThrow();
    expect(record.outcomes[creatureId]).toBe(original);
  });

  it("fails closed on identity, provenance, integrity, bank, and address mismatches", () => {
    const creatures = createCreatureDefinitions(82);
    const bank = new ClassicalDemoTurnBank(82, creatures);
    const record = bank.getRecord({ round: 1, turn: 1 });

    const incompleteOutcomes = { ...record.outcomes };
    delete incompleteOutcomes[creatures[0]?.id ?? "missing"];
    expect(() => validateTurnRecord({ ...record, outcomes: incompleteOutcomes }, bank.creatureIds, bank.bankId))
      .toThrow("identity set");

    const notPrepared = {
      ...record,
      provenance: { ...record.provenance, preparedBeforePlay: false },
    } as unknown as TurnRecord;
    expect(() => validateTurnRecord(notPrepared, bank.creatureIds, bank.bankId)).toThrow("prepared before play");

    const tamperedOutcomes = { ...record.outcomes };
    const firstId = creatures[0]?.id ?? "missing";
    tamperedOutcomes[firstId] = tamperedOutcomes[firstId] === "waving" ? "still" : "waving";
    expect(() => validateTurnRecord({ ...record, outcomes: tamperedOutcomes }, bank.creatureIds, bank.bankId))
      .toThrow("integrity");

    expect(() => validateTurnRecord(record, bank.creatureIds, "WRONG-BANK")).toThrow("belongs to bank");

    const legacySchema = { ...record, schemaVersion: 2 } as unknown as TurnRecord;
    expect(() => validateTurnRecord(legacySchema, bank.creatureIds, bank.bankId)).toThrow("schema v3");

    const v1Model = {
      ...record,
      provenance: { ...record.provenance, modelId: "dw-demo-time-tuning-v1" },
    } as unknown as TurnRecord;
    expect(() => validateTurnRecord(v1Model, bank.creatureIds, bank.bankId)).toThrow("dw-prepared-turn-v3");

    const v1Address = { round: 1, turn: 1, timingBucket: 2, tuning: "coral" } as unknown as TurnAddress;
    expect(() => bank.getRecord(v1Address)).toThrow("exactly round, turn");
    expect(() => turnAddressKey(v1Address)).toThrow("exactly round, turn");
  });

  it("contains no legacy timing, tuning, circuit, backend, or quantum claim fields", () => {
    const record = new ClassicalDemoTurnBank(91, createCreatureDefinitions(91)).getRecord({ round: 1, turn: 1 });
    const serialized = JSON.stringify(record);
    for (const forbidden of ["timingBucket", "tuning", "circuit", "backend", "quantum", "qpu"]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
