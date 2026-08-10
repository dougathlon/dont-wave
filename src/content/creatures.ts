import { createRng, mixSeed, normalizeSeed } from "../simulation/rng";
import type { CreatureDefinition, CreatureVisualDefinition } from "../simulation/types";

export const DEFAULT_POPULATION_SIZE = 96;

const GIVEN_NAMES = [
  "Mallow",
  "Brindle",
  "Oona",
  "Tippet",
  "Luma",
  "Fen",
  "Poggle",
  "Nib",
  "Sable",
  "Tansy",
  "Orlo",
  "Vesper",
] as const;

const FAMILY_NAMES = ["Bell", "Moss", "Glint", "Thimble", "Rook", "Purl", "Soot", "Wren"] as const;
const BODY_SHAPES = ["bean", "gourd", "orb", "slug"] as const;
const EAR_STYLES = ["antennae", "droop", "fan", "horns"] as const;
const MARKINGS = ["belly", "freckles", "stripe", "patch"] as const;
const BODY_COLORS = [0xf0d49a, 0xdb8e83, 0x8cc8bd, 0xa9bd68, 0x9f7ca7, 0xd1a76d, 0xc987b0, 0x91a4c4] as const;
const ACCENT_COLORS = [0xff786f, 0x65ded1, 0xb6cf5b, 0xe4b4d0, 0xf0cc68, 0x7d6d9e] as const;

/**
 * Creates stable identities with seeded cosmetic variation. Every returned creature
 * has the same simulation speed, outcome probability, hitbox, and eligibility.
 */
export function createCreatureDefinitions(seed: number, count = DEFAULT_POPULATION_SIZE): readonly CreatureDefinition[] {
  if (!Number.isInteger(count) || count <= 0 || count > DEFAULT_POPULATION_SIZE) {
    throw new Error(`Creature count must be an integer from 1 to ${DEFAULT_POPULATION_SIZE}.`);
  }

  const normalizedSeed = normalizeSeed(seed);
  return Array.from({ length: count }, (_, index) => {
    const id = `DW-${String(index + 1).padStart(3, "0")}`;
    const given = pick(GIVEN_NAMES, index % GIVEN_NAMES.length);
    const family = pick(FAMILY_NAMES, Math.floor(index / GIVEN_NAMES.length));
    const visualRng = createRng(mixSeed(normalizedSeed, id, "visual-v2"));
    return {
      id,
      name: `${given} ${family}`,
      visual: createVisual(visualRng, index),
    };
  });
}

function createVisual(rng: () => number, index: number): CreatureVisualDefinition {
  return {
    bodyShape: pick(BODY_SHAPES, Math.floor(rng() * BODY_SHAPES.length)),
    bodyColor: pick(BODY_COLORS, Math.floor(rng() * BODY_COLORS.length)),
    accentColor: pick(ACCENT_COLORS, (index + Math.floor(rng() * ACCENT_COLORS.length)) % ACCENT_COLORS.length),
    eyeCount: pick([1, 2, 3] as const, Math.floor(rng() * 3)),
    eyeScale: round(0.76 + rng() * 0.42),
    earStyle: pick(EAR_STYLES, Math.floor(rng() * EAR_STYLES.length)),
    marking: pick(MARKINGS, Math.floor(rng() * MARKINGS.length)),
    widthScale: round(0.78 + rng() * 0.38),
    heightScale: round(0.78 + rng() * 0.4),
    lean: Math.round(rng() * 10 - 5),
    leftHanded: rng() < 0.5,
  };
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function pick<T>(values: readonly T[], index: number): T {
  const value = values[((index % values.length) + values.length) % values.length];
  if (value === undefined) throw new Error("Cannot select from an empty content list.");
  return value;
}
