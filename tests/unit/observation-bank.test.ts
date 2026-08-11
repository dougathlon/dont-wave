import { describe, expect, it } from "vitest";
import { createContestantDefinitions } from "../../src/content/creatures";
import {
  ClassicalDemoTurnBank,
  TOTAL_ROUNDS,
  TURNS_PER_ROUND,
  validateTurnRecord,
} from "../../src/simulation/observationBank";
import type { TurnRecord } from "../../src/simulation/types";

describe("prepared turn bank v5", () => {
  const definitions = createContestantDefinitions(7071, 1);

  it("prepares exactly two rounds of four deterministic records", () => {
    const first = new ClassicalDemoTurnBank(7071, definitions);
    const second = new ClassicalDemoTurnBank(7071, definitions);
    expect(first.recordCount()).toBe(TOTAL_ROUNDS * TURNS_PER_ROUND);
    for (let round = 1; round <= TOTAL_ROUNDS; round += 1) {
      for (let turn = 1; turn <= TURNS_PER_ROUND; turn += 1) {
        const left = first.getRecord({ round, turn });
        const right = second.getRecord({ round, turn });
        expect(left).toEqual(right);
        expect(left.priority).toHaveLength(first.contestantIds.length);
        expect(new Set(left.priority).size).toBe(first.contestantIds.length);
        expect(() => validateTurnRecord(left, first.contestantIds, first.bankId)).not.toThrow();
      }
    }
  });

  it("binds a deterministic priority to stable identities and does not expose mutable records", () => {
    const bank = new ClassicalDemoTurnBank(7071, definitions);
    const record = bank.getRecord({ round: 1, turn: 1 });
    expect([...record.priority].sort()).toEqual([...bank.contestantIds].sort());
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.priority)).toBe(true);
    expect(Object.isFrozen(record.provenance)).toBe(true);
  });

  it("allows each prepared address to be consumed once per run", () => {
    const bank = new ClassicalDemoTurnBank(7071, definitions);
    expect(bank.consume({ round: 1, turn: 1 }).address).toEqual({ round: 1, turn: 1 });
    expect(() => bank.consume({ round: 1, turn: 1 })).toThrow(/already consumed/i);
    bank.resetConsumption();
    expect(() => bank.consume({ round: 1, turn: 1 })).not.toThrow();
  });

  it("rejects identity, address, and integrity tampering", () => {
    const bank = new ClassicalDemoTurnBank(7071, definitions);
    const source = bank.getRecord({ round: 1, turn: 1 });
    const tampered = {
      ...source,
      priority: source.priority.slice(1),
    } as TurnRecord;
    expect(() => validateTurnRecord(tampered, bank.contestantIds, bank.bankId)).toThrow(/identity set/i);

    const badIntegrity = {
      ...source,
      provenance: { ...source.provenance, integrity: "fnv1a-deadbeef" },
    } as TurnRecord;
    expect(() => validateTurnRecord(badIntegrity, bank.contestantIds, bank.bankId)).toThrow(/integrity/i);
    expect(() => bank.getRecord({ round: 1, turn: 5 })).toThrow(/prepared range/i);
  });
});
