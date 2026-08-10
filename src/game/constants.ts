import { Color, Vector3 } from "three";
import { FIELD_CHECKPOINT_Z, FIELD_COLUMNS, FIELD_ROWS } from "../content/fieldLayout";

export const WORLD = {
  fieldWidth: 30,
  fieldNearZ: 13,
  fieldFarZ: -17,
  crossingStartZ: 12.6,
  checkpointZ: FIELD_CHECKPOINT_Z,
  columns: FIELD_COLUMNS,
  rows: FIELD_ROWS,
} as const;

export const WATCH_CAMERA_POSITION = new Vector3(0, 10.8, 20.4);
export const WATCH_CAMERA_TARGET = new Vector3(0, 1.25, -3.5);
export const CROSSING_CAMERA_POSITION = new Vector3(0, 1.72, 13.2);
export const CROSSING_CAMERA_TARGET = new Vector3(0, 1.48, -8.8);

export const PALETTE = {
  abyss: new Color(0x0c0810),
  aubergine: new Color(0x24152b),
  field: new Color(0x403049),
  fieldDark: new Color(0x2a1c31),
  cream: new Color(0xf2dfac),
  dirtyCream: new Color(0xb9a77e),
  coral: new Color(0xff786f),
  cyan: new Color(0x65ded1),
  chartreuse: new Color(0xb6cf5b),
  ink: new Color(0x25172b),
  rust: new Color(0x754853),
  steel: new Color(0x5b5262),
  warning: new Color(0xffb45d),
} as const;

export const OPERATOR_COLORS = {
  player: 0xf2dfac,
  left: 0xff786f,
  right: 0x65ded1,
  miss: 0xffb45d,
} as const;

export const MAX_FRAME_DELTA_MS = 100;
export const MAX_PIXEL_RATIO = 1.5;

export function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function hashUnit(value: string, salt: number): number {
  const mixed = stableHash(`${value}:${salt}`);
  return mixed / 0xffffffff;
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
