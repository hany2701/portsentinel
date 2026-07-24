import { TICK_SIM_MINUTES } from "../sim/config";
import type { VesselClass } from "../sim/types";

// GR-1: maritime tuning. Kept apart from src/sim/config.ts so VESSEL_COUNT there
// keeps its existing meaning — the frozen 22-vessel Tuas pool (D-27).

// One authoritative population of 130 unique vessels: 78 deep-sea + 30 regional
// + the 22 Tuas baseline. These are NOT per-view populations — the global,
// regional and Tuas views render different scopes of the same entities.
export const DEEPSEA_VESSEL_COUNT = 78;
export const REGIONAL_VESSEL_COUNT = 30;

// Corridor allocation is proportional to route length, floored at this many
// vessels per corridor. Without the floor the shortest regional loop (Riau, at
// 62 nm against Mekong's 1,291) draws a single vessel and reads as a dead
// service; with it, every corridor stays visibly worked. The floor binds only on
// the short regional loops — every deep-sea corridor's proportional share is
// already well above it.
export const MIN_VESSELS_PER_CORRIDOR = 3;

// How many tracked regional vessels may be bound for Tuas at genesis. Each one
// eventually enters the Tuas FSM, so the Tuas-active population can reach
// 22 + 3 = 25. Capped deliberately: the 22 baseline vessels are frozen and the
// berth/anchorage doctrine is calibrated around them.
export const TUAS_BOUND_TRACKED_MAX = 3;

// Mean Earth radius in nautical miles — converts d3-geo's radian distances.
export const EARTH_RADIUS_NM = 3440.065;

// Service speeds by class. Deliberately below each class's design maximum:
// these are economical sailing speeds, which is what a schedule is built on.
export const CLASS_SPEED_KNOTS: Record<VesselClass, number> = {
  feeder: 14,
  panamax: 18,
  neopanamax: 21,
};

// A tick is TICK_SIM_MINUTES of simulated time, so one knot advances a vessel
// TICK_SIM_MINUTES/60 nm per tick. The single conversion every movement
// calculation goes through.
export function nmPerTick(speedKnots: number): number {
  return (speedKnots * TICK_SIM_MINUTES) / 60;
}
