export function normalizeSeed(seed: number): number {
  return seed >>> 0;
}

export function nextRandom(state: number): { value: number; state: number } {
  let t = (state + 0x6d2b79f5) >>> 0;
  let z = t;
  z = Math.imul(z ^ (z >>> 15), z | 1);
  z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
  return { value: ((z ^ (z >>> 14)) >>> 0) / 4294967296, state: t };
}

export function nextInt(state: number, maxExclusive: number): { value: number; state: number } {
  if (maxExclusive <= 0) return { value: 0, state };
  const next = nextRandom(state);
  return { value: Math.floor(next.value * maxExclusive), state: next.state };
}

export function shuffleInPlace<T>(items: T[], state: number): number {
  let rngState = state;
  for (let i = items.length - 1; i > 0; i--) {
    const next = nextInt(rngState, i + 1);
    rngState = next.state;
    [items[i], items[next.value]] = [items[next.value], items[i]];
  }
  return rngState;
}
