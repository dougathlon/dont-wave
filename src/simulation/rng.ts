export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) throw new Error("Run seed must be a finite number.");
  return Math.trunc(seed) >>> 0;
}

export function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mixSeed(...parts: readonly (string | number)[]): number {
  return hashText(parts.join("|"));
}

export function createRng(seed: number): () => number {
  let state = normalizeSeed(seed) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
