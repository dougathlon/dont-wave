import { hashText, mixSeed, normalizeSeed } from "./rng";
import type {
  ContestantDefinition,
  TurnAddress,
  TurnBank,
  TurnRecord,
  TurnRecordProvenance,
} from "./types";

export const TOTAL_ROUNDS = 2;
export const TURNS_PER_ROUND = 4;
export const TURN_RECORD_SCHEMA_VERSION = 5 as const;
export const TURN_RECORD_MODEL_ID = "dw-prepared-turn-v5" as const;
export const WAVERS_PER_TURN = 6;

const RECORD_KEYS = ["address", "bankId", "id", "priority", "provenance", "schemaVersion"] as const;
const PROVENANCE_KEYS = ["bindingMethod", "integrity", "kind", "modelId", "preparedBeforePlay", "provider"] as const;

/** Eight immutable local records. They are a deterministic demo boundary, not a hardware claim. */
export class ClassicalDemoTurnBank implements TurnBank {
  readonly schemaVersion = TURN_RECORD_SCHEMA_VERSION;
  readonly modelId = TURN_RECORD_MODEL_ID;
  readonly bankId: string;
  readonly seed: number;
  readonly contestantIds: readonly string[];
  private readonly records = new Map<string, TurnRecord>();
  private readonly consumed = new Set<string>();

  constructor(seed: number, definitions: readonly ContestantDefinition[]) {
    this.seed = normalizeSeed(seed);
    this.bankId = `DW-V5-DEMO-${this.seed.toString(16).padStart(8, "0").toUpperCase()}`;
    this.contestantIds = Object.freeze(definitions.map((definition) => definition.id));
    assertIdentitySet(this.contestantIds);
    for (let round = 1; round <= TOTAL_ROUNDS; round += 1) {
      for (let turn = 1; turn <= TURNS_PER_ROUND; turn += 1) {
        const record = createRecord(this.seed, this.bankId, this.contestantIds, { round, turn });
        validateTurnRecord(record, this.contestantIds, this.bankId);
        this.records.set(turnAddressKey(record.address), record);
      }
    }
  }

  getRecord(address: TurnAddress): TurnRecord {
    assertAddress(address);
    const record = this.records.get(turnAddressKey(address));
    if (!record) throw new Error(`Prepared record ${turnAddressKey(address)} is missing.`);
    return record;
  }

  consume(address: TurnAddress): TurnRecord {
    const key = turnAddressKey(address);
    if (this.consumed.has(key)) throw new Error(`Prepared record ${key} was already consumed.`);
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
  expectedContestantIds: readonly string[],
  expectedBankId = record.bankId,
): void {
  assertExactKeys(record as unknown as Record<string, unknown>, RECORD_KEYS, "Turn record");
  assertExactKeys(record.provenance as unknown as Record<string, unknown>, PROVENANCE_KEYS, "Turn provenance");
  assertAddress(record.address);
  if (record.schemaVersion !== TURN_RECORD_SCHEMA_VERSION) throw new Error("Turn record must use schema v5.");
  if (record.bankId !== expectedBankId) throw new Error(`Turn record belongs to ${record.bankId}, expected ${expectedBankId}.`);
  if (record.id !== `${record.bankId}-${turnAddressKey(record.address)}`) throw new Error("Turn record ID does not match its address.");
  if (record.provenance.kind !== "classical-demo"
    || record.provenance.modelId !== TURN_RECORD_MODEL_ID
    || record.provenance.preparedBeforePlay !== true
    || record.provenance.bindingMethod !== "stable-contestant-priority") {
    throw new Error(`Turn record ${record.id} has invalid provenance.`);
  }
  if (!record.provenance.provider.trim() || !record.provenance.integrity.trim()) {
    throw new Error(`Turn record ${record.id} has incomplete provenance.`);
  }
  const actualIds = [...record.priority].sort();
  const expectedIds = [...expectedContestantIds].sort();
  if (actualIds.length !== expectedIds.length || actualIds.some((id, index) => id !== expectedIds[index])) {
    throw new Error(`Turn record ${record.id} has a mismatched identity set.`);
  }
  if (record.provenance.integrity !== computeIntegrity(record)) throw new Error(`Turn record ${record.id} failed integrity validation.`);
}

export function turnAddressKey(address: TurnAddress): string {
  assertAddress(address);
  return `R${address.round}-T${address.turn}`;
}

function createRecord(seed: number, bankId: string, ids: readonly string[], address: TurnAddress): TurnRecord {
  const priority = Object.freeze([...ids].sort((left, right) => (
    mixSeed(seed, TURN_RECORD_MODEL_ID, turnAddressKey(address), left)
    - mixSeed(seed, TURN_RECORD_MODEL_ID, turnAddressKey(address), right)
  )));
  const provenanceBase = {
    kind: "classical-demo" as const,
    provider: "local deterministic generator",
    modelId: TURN_RECORD_MODEL_ID,
    preparedBeforePlay: true as const,
    bindingMethod: "stable-contestant-priority" as const,
  };
  const draft: TurnRecord = {
    schemaVersion: TURN_RECORD_SCHEMA_VERSION,
    id: `${bankId}-${turnAddressKey(address)}`,
    bankId,
    address: Object.freeze({ ...address }),
    priority,
    provenance: { ...provenanceBase, integrity: "pending" },
  };
  const provenance: TurnRecordProvenance = Object.freeze({ ...provenanceBase, integrity: computeIntegrity(draft) });
  return Object.freeze({ ...draft, provenance });
}

function computeIntegrity(record: TurnRecord): string {
  const payload = [
    record.schemaVersion,
    record.id,
    record.bankId,
    turnAddressKey(record.address),
    record.provenance.kind,
    record.provenance.provider,
    record.provenance.modelId,
    String(record.provenance.preparedBeforePlay),
    record.provenance.bindingMethod,
    record.priority.join(","),
  ].join("|");
  return `fnv1a-${hashText(payload).toString(16).padStart(8, "0")}`;
}

function assertAddress(address: TurnAddress): void {
  if (!address || typeof address !== "object") throw new Error("Turn address must be an object.");
  const keys = Object.keys(address).sort();
  if (keys.join("|") !== "round|turn") throw new Error("Turn address must contain only round and turn.");
  if (!Number.isInteger(address.round) || address.round < 1 || address.round > TOTAL_ROUNDS) throw new Error("Round is outside the prepared range.");
  if (!Number.isInteger(address.turn) || address.turn < 1 || address.turn > TURNS_PER_ROUND) throw new Error("Turn is outside the prepared range.");
}

function assertIdentitySet(ids: readonly string[]): void {
  if (ids.length === 0 || new Set(ids).size !== ids.length || ids.some((id) => !id.trim())) {
    throw new Error("Turn bank requires unique non-empty contestant identities.");
  }
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    throw new Error(`${label} must contain exactly ${sortedExpected.join(", ")}.`);
  }
}
