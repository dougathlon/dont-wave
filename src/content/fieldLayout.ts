import { hashText } from "../simulation/rng";

export const FIELD_COLUMNS = 8;
export const FIELD_ROWS = 6;
export const FIELD_START_Z = 7;
export const FIELD_CHECKPOINT_Z = -13.8;
export const FIELD_FINISH_Z = FIELD_CHECKPOINT_Z - 0.55;
export const FIELD_ROW_STEP_Z = 3.5;
export const FIELD_ROW_JITTER_Z = 0.26;
export const CREATURE_CROSSING_MS = 20_000;

export function creatureStartingProgress(id: string, index: number): number {
  const row = Math.floor(index / FIELD_COLUMNS);
  const jitter = (layoutHashUnit(id, 47) - 0.5) * FIELD_ROW_JITTER_Z;
  const startingZ = FIELD_START_Z - row * FIELD_ROW_STEP_Z + jitter;
  return clamp01((FIELD_START_Z - startingZ) / (FIELD_START_Z - FIELD_FINISH_Z));
}

export function creatureZAtProgress(progress: number): number {
  const normalized = clamp01(progress);
  return FIELD_START_Z + (FIELD_FINISH_Z - FIELD_START_Z) * normalized;
}

function layoutHashUnit(value: string, salt: number): number {
  return hashText(`${value}:${salt}`) / 0xffffffff;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
