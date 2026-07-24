import type { Rng } from "./types";

export function makeRng(seed: number): Rng {
  return { state: seed >>> 0 };
}

export function rand(rng: Rng): number {
  let t = (rng.state = (rng.state + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(rng: Rng, minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(rand(rng) * (maxInclusive - minInclusive + 1));
}

export function randRange(rng: Rng, min: number, max: number): number {
  return min + rand(rng) * (max - min);
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rand(rng) * arr.length)];
}

export function chance(rng: Rng, probability: number): boolean {
  return rand(rng) < probability;
}
