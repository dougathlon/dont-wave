import { hashText, mixSeed, normalizeSeed } from "./rng";
import type {
  CreatureDefinition,
  TurnAddress,
  TurnBank,
  TurnOutcome,
  TurnRecord,
  TurnRecordProvenance,
} from "./types";

export const TOTAL_ROUNDS = 2;
export const TURNS_PER_ROUND = 2;
export const TURN_RECORD_SCHEMA_VERSION = 3 as const;
export const TURN_RECORD_MODEL_ID = "dw-prepared-turn-v3" as const;
export const WAVERS_PER_RECORD = 10;

const ADDRESS_KEYS = ["round", "turn"] as const;
const RECORD_KEYS = ["address", "bankId", "id", "outcomes", "provenance", "schemaVersion"] as const;
const PROVENANCE_KEYS = ["bindingMethod", "integrity", "kind", "modelId", "preparedBeforePlay", "provider"] as const;

/** Exactly four immutable records, selected only by round and turn. */
export class ClassicalDemoTurnBank implements TurnBank {
  readonly schemaVersion = TURN_RECORD_SCHEMA_VERSION;
  readonly modelId = TURN_RECORD_MODEL_ID;
  readonly bankId: string;
  readonly seed: number;
  readonly creatureIds: readonly string[];
  private readonly records = new Map<string, TurnRecord>();
  private readonly consumed = new Set<string>();

  constructor(seed: number, creatures: readonly CreatureDefinition[]) {
    this.seed = normalizeSeed(seed);
    this.bankId = `DW-V2-DEMO-${this.seed.toString(16).padStart(8, "0").toUpperCase()}`;
    this.creatureIds = Object.freeze(creatures.map((creature) => creature.id));
    assertUniqueCreatureIds(this.creatureIds);

    for (let round = 1; round <= TOTAL_ROUNDS; round += 1) {
      for (let turn = 1; turn <= TURNS_PER_ROUND; turn += 1) {
        const address = { round, turn } as const;
        const record = createRecord(this.seed, this.bankId, creatures, address);
        validateTurnRecord(record, this.creatureIds, this.bankId);
        this.records.set(turnAddressKey(address), record);
      }
    }
  }

  getRecord(address: TurnAddress): TurnRecord {
    assertValidAddress(address);
    const key = turnAddressKey(address);
    const record = this.records.get(key);
    if (!record) throw new Error(`Turn bank is missing prepared address ${key}.`);
    return record;
  }

  consume(address: TurnAddress): TurnRecord {
    const key = turnAddressKey(address);
    if (this.consumed.has(key)) throw new Error(`Prepared turn ${key} has already been consumed in this run.`);
    const record = this.getRecord(address);
    this.consumed.add(key);
    return record;
  }

  resetConsumption(): void {
    this.consumed.clear();
  }

  consumedCount(): number {
    return this.consumed.size;
  }

  recordCount(): number {
    return this.records.size;
  }
}

export function validateTurnRecord(
  record: TurnRecord,
  expectedCreatureIds: readonly string[],
  expectedBankId = record.bankId,
): void {
  assertExactKeys(record as unknown as Record<string, unknown>, RECORD_KEYS, "Turn record");
  assertValidAddress(record.address);
  assertExactKeys(record.provenance as unknown as Record<string, unknown>, PROVENANCE_KEYS, "Turn record provenance");

  if (record.schemaVersion !== TURN_RECORD_SCHEMA_VERSION) {
    throw new Error(`Turn record ${record.id || "<unnamed>"} does not use schema v3.`);
  }
  if (record.bankId !== expectedBankId) {
    throw new Error(`Turn record ${record.id} belongs to bank ${record.bankId}, expected ${expectedBankId}.`);
  }
  const expectedId = `${record.bankId}-${turnAddressKey(record.address)}`;
  if (record.id !== expectedId) {
    throw new Error(`Turn record ID ${record.id || "<unnamed>"} does not match prepared address ${expectedId}.`);
  }
  if (record.provenance.kind !== "classical-demo") {
    throw new Error(`Turn record ${record.id} has unsupported provenance kind ${String(record.provenance.kind)}.`);
  }
  if (record.provenance.modelId !== TURN_RECORD_MODEL_ID) {
    throw new Error(`Turn record ${record.id} does not use model ${TURN_RECORD_MODEL_ID}.`);
  }
  if (record.provenance.bindingMethod !== "stable-creature-id") {
    throw new Error(`Turn record ${record.id} does not bind outcomes to stable creature IDs.`);
  }
  if (record.provenance.preparedBeforePlay !== true) {
    throw new Error(`Turn record ${record.id} was not marked as prepared before play.`);
  }
  if (!isNonEmptyString(record.provenance.provider) || !isNonEmptyString(record.provenance.integrity)) {
    throw new Error(`Turn record ${record.id} has incomplete provenance.`);
  }

  const outcomeIds = Object.keys(record.outcomes).sort();
  const expected = [...expectedCreatureIds].sort();
  if (outcomeIds.length !== expected.length || outcomeIds.some((id, index) => id !== expected[index])) {
    throw new Error(`Turn record ${record.id} has an incomplete or mismatched creature identity set.`);
  }
  for (const outcome of Object.values(record.outcomes)) {
    if (outcome !== "still" && outcome !== "waving") {
      throw new Error(`Turn record ${record.id} contains an invalid outcome.`);
    }
  }

  const expectedIntegrity = computeIntegrity(record);
  if (record.provenance.integrity !== expectedIntegrity) {
    throw new Error(`Turn record ${record.id} failed its integrity check.`);
  }
}

export function turnAddressKey(address: TurnAddress): string {
  assertValidAddress(address);
  return `R${address.round}-T${address.turn}`;
}

function createRecord(
  seed: number,
  bankId: string,
  creatures: readonly CreatureDefinition[],
  address: TurnAddress,
): TurnRecord {
  const outcomeSeed = mixSeed(seed, TURN_RECORD_MODEL_ID, turnAddressKey(address));
  const rankedIds = creatures
    .map((creature) => creature.id)
    .sort((left, right) => mixSeed(outcomeSeed, left) - mixSeed(outcomeSeed, right));
  const wavingIds = new Set(rankedIds.slice(0, Math.min(WAVERS_PER_RECORD, rankedIds.length)));
  const outcomes: Record<string, TurnOutcome> = {};
  for (const creature of creatures) outcomes[creature.id] = wavingIds.has(creature.id) ? "waving" : "still";

  const id = `${bankId}-${turnAddressKey(address)}`;
  const provenanceBase = {
    kind: "classical-demo" as const,
    provider: "local deterministic generator",
    modelId: TURN_RECORD_MODEL_ID,
    preparedBeforePlay: true as const,
    bindingMethod: "stable-creature-id" as const,
  };
  const draft: TurnRecord = {
    schemaVersion: TURN_RECORD_SCHEMA_VERSION,
    id,
    bankId,
    address: Object.freeze({ ...address }),
    outcomes: Object.freeze(outcomes),
    provenance: { ...provenanceBase, integrity: "pending" },
  };
  const provenance: TurnRecordProvenance = Object.freeze({
    ...provenanceBase,
    integrity: computeIntegrity(draft),
  });
  return Object.freeze({ ...draft, provenance });
}

function computeIntegrity(record: TurnRecord): string {
  const outcomeText = Object.keys(record.outcomes)
    .sort()
    .map((creatureId) => `${creatureId}:${record.outcomes[creatureId] ?? "missing"}`)
    .join("|");
  const payload = [
    `schema:${record.schemaVersion}`,
    `id:${record.id}`,
    `bank:${record.bankId}`,
    `address:${turnAddressKey(record.address)}`,
    `kind:${record.provenance.kind}`,
    `provider:${record.provenance.provider}`,
    `model:${record.provenance.modelId}`,
    `prepared:${String(record.provenance.preparedBeforePlay)}`,
    `binding:${record.provenance.bindingMethod}`,
    outcomeText,
  ].join("|");
  return `fnv1a-${hashText(payload).toString(16).padStart(8, "0")}`;
}

function assertValidAddress(address: TurnAddress): void {
  if (!address || typeof address !== "object") throw new Error("Turn address must be an object.");
  assertExactKeys(address as unknown as Record<string, unknown>, ADDRESS_KEYS, "Turn address");
  if (!Number.isInteger(address.round) || address.round < 1 || address.round > TOTAL_ROUNDS) {
    throw new Error(`Round ${String(address.round)} is outside the prepared range.`);
  }
  if (!Number.isInteger(address.turn) || address.turn < 1 || address.turn > TURNS_PER_ROUND) {
    throw new Error(`Turn ${String(address.turn)} is outside the prepared range.`);
  }
}

function assertUniqueCreatureIds(creatureIds: readonly string[]): void {
  if (creatureIds.length === 0) throw new Error("Turn bank requires at least one creature identity.");
  if (new Set(creatureIds).size !== creatureIds.length) throw new Error("Turn bank creature identities must be unique.");
  if (creatureIds.some((id) => !isNonEmptyString(id))) throw new Error("Turn bank creature identities must be non-empty strings.");
}

function assertExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain exactly ${expected.join(", ")}.`);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
