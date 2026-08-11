import { Color, Vector3 } from "three";

export const WATCH_CAMERA_POSITION = new Vector3(0, 10.8, 15.5);
export const WATCH_CAMERA_TARGET = new Vector3(0, 1.1, -12.5);
export const CROSSING_CAMERA_START = new Vector3(0, 1.68, -21);
export const CROSSING_LOOK_TARGET = new Vector3(0, 1.35, 9);
export const CROSSING_TRAVEL = 9;

export const PALETTE = {
  sky: new Color(0xaebfc0),
  fog: new Color(0x87999a),
  concrete: new Color(0xb7a98d),
  concreteDark: new Color(0x6d675c),
  bone: new Color(0xf2ead3),
  ink: new Color(0x17191a),
  green: new Color(0x84d34e),
  red: new Color(0xe4473b),
  left: new Color(0xf17867),
  right: new Color(0x57c6cc),
  yellow: new Color(0xe6bd4a),
  rust: new Color(0x794d45),
  civicBlue: new Color(0x3d6870),
} as const;

export const OPERATOR_COLORS = {
  player: 0xf2ead3,
  wrong: 0xe6bd4a,
  left: 0xf17867,
  right: 0x57c6cc,
  empty: 0xa9a093,
} as const;

export const MAX_FRAME_DELTA_MS = 50;
export const MAX_PIXEL_RATIO = 1.6;

export function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
