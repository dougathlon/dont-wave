export const FIELD_COLUMNS = 6;
export const FIELD_ROWS = 6;
export const CONTESTANT_COUNT = FIELD_COLUMNS * FIELD_ROWS;
export const FINISH_Z = 8;
export const FRONT_ROW_Z = 1.5;
export const ROW_DEPTH = 5.4;
export const COLUMN_WIDTH = 2.75;

export interface FieldSlot {
  readonly slot: number;
  readonly row: number;
  readonly column: number;
  readonly x: number;
  readonly startZ: number;
}

export function fieldSlot(slot: number): FieldSlot {
  if (!Number.isInteger(slot) || slot < 0 || slot >= CONTESTANT_COUNT) {
    throw new Error(`Contestant slot ${String(slot)} is outside the field.`);
  }
  const row = Math.floor(slot / FIELD_COLUMNS);
  const column = slot % FIELD_COLUMNS;
  const x = (column - (FIELD_COLUMNS - 1) / 2) * COLUMN_WIDTH;
  const startZ = FRONT_ROW_Z - row * ROW_DEPTH;
  if (startZ >= FINISH_Z) throw new Error("Field layout must begin behind the finish line.");
  return { slot, row, column, x, startZ };
}

export function distanceToFinish(z: number): number {
  return FINISH_Z - z;
}
