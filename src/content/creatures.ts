import { CONTESTANT_COUNT, fieldSlot } from "./fieldLayout";
import { mixSeed, normalizeSeed } from "../simulation/rng";
import type { ContestantDefinition, ContestantVisual } from "../simulation/types";

const SKINS = [0xd5a176, 0xb9785d, 0x8e594d, 0xe0b28b, 0x735044, 0xc58d6d] as const;
const SUITS = [0x315d56, 0x4f6b61, 0x355d68, 0x5b554d, 0x406058, 0x574d64] as const;
const ACCENTS = [0xe55f4d, 0xe9bf55, 0x7dc9ba, 0xd98aaa, 0x9bbd66, 0xd89b5d] as const;

export function createContestantDefinitions(seed: number, round: number): readonly ContestantDefinition[] {
  const normalized = normalizeSeed(seed);
  return Object.freeze(Array.from({ length: CONTESTANT_COUNT }, (_, slot) => {
    const id = `contestant-${String(slot + 1).padStart(2, "0")}`;
    const layout = fieldSlot(slot);
    const visualSeed = mixSeed(normalized, "contestant", round, id);
    const visual: ContestantVisual = Object.freeze({
      skinColor: choose(SKINS, visualSeed),
      suitColor: choose(SUITS, visualSeed >>> 3),
      accentColor: choose(ACCENTS, visualSeed >>> 7),
      headScale: 0.82 + unit(visualSeed, 11) * 0.38,
      torsoWidth: 0.78 + unit(visualSeed, 17) * 0.44,
      torsoHeight: 0.86 + unit(visualSeed, 23) * 0.34,
      eyeCount: ((visualSeed >>> 13) % 3 + 1) as 1 | 2 | 3,
      armLength: 0.86 + unit(visualSeed, 29) * 0.26,
      waveHand: (visualSeed & 1) === 0 ? "left" : "right",
      gaitPhase: unit(visualSeed, 37) * Math.PI * 2,
    });
    return Object.freeze({
      id,
      slot,
      x: layout.x + (unit(visualSeed, 41) - 0.5) * 0.32,
      startZ: layout.startZ,
      visual,
    });
  }));
}

function choose<T>(values: readonly T[], seed: number): T {
  const value = values[Math.abs(seed) % values.length];
  if (value === undefined) throw new Error("Visual palette is empty.");
  return value;
}

function unit(seed: number, salt: number): number {
  return (mixSeed(seed, salt) >>> 0) / 0xffffffff;
}
