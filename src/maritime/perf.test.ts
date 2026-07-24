import { describe, expect, it } from "vitest";
import { generateWorld, tick } from "../sim";
import { clusterCellDeg, clusterVessels } from "./clustering";
import { geographicVessels } from "./selectors";
import type { SimState } from "../sim";

// GR-11 performance guard.
//
// The extension took the population from 22 vessels to 130, and `tick()`
// structuredClones the whole state every time. Two things could quietly rot:
// the per-tick cost, and the size of what gets cloned (route plans, decisions
// and handovers accumulate as vessels sail their loops — see
// maritimePruning.test.ts for the correctness half of that story).
//
// Budgets are deliberately loose — this is a regression trip-wire for an
// order-of-magnitude slip, not a benchmark. Measured 2026-07-22 on the dev
// machine: 2.6 ms/tick alone, 7.2 ms/tick with the rest of the suite running
// alongside it, and 294 KB of state after 1,000 ticks. The tick budget sits
// ~3x above the loaded figure so machine load never fails a green build; the
// simulation itself only needs to fit 2,000 ms per tick at 1x speed.

const SEED = 20260710;
const TICKS = 1_000;
const TICK_BUDGET_MS = 25;
const STATE_BUDGET_KB = 900;

const stateKb = (s: SimState) => JSON.stringify(s).length / 1024;

describe("performance at 130 vessels (GR-11)", () => {
  it("runs 1,000 ticks inside the per-tick budget", () => {
    let state = generateWorld(SEED);
    expect(state.vessels).toHaveLength(130);

    const startedAt = performance.now();
    for (let i = 0; i < TICKS; i++) state = tick(state);
    const msPerTick = (performance.now() - startedAt) / TICKS;

    expect(msPerTick, `${msPerTick.toFixed(2)} ms/tick over ${TICKS} ticks`).toBeLessThan(
      TICK_BUDGET_MS,
    );
  });

  it("keeps the cloned state bounded as voyage history accumulates", () => {
    let state = generateWorld(SEED);
    const atGenesis = stateKb(state);

    for (let i = 0; i < TICKS; i++) state = tick(state);
    const afterRun = stateKb(state);

    // Pruning (pruneMaritimeHistory) is what makes this hold: without it the
    // completed route plans alone grow without bound and every tick pays for
    // them again.
    expect(afterRun, `state grew to ${afterRun.toFixed(0)} KB`).toBeLessThan(STATE_BUDGET_KB);
    expect(afterRun).toBeLessThan(atGenesis * 4);
  });

  it("clusters the whole tracked fleet cheaply enough to run every tick", () => {
    // The map re-derives clusters whenever the vessel array changes identity —
    // which is every tick, since tick() returns a fresh clone. That is only
    // acceptable because clustering is O(n) over 130 points.
    const state = generateWorld(SEED);
    const points = geographicVessels(state).flatMap((v) =>
      v.track ? [{ id: v.id, latitude: v.track.latitude, longitude: v.track.longitude }] : [],
    );
    expect(points.length).toBeGreaterThan(100);

    const startedAt = performance.now();
    for (let i = 0; i < 100; i++) clusterVessels(points, clusterCellDeg(2));
    const msPerCluster = (performance.now() - startedAt) / 100;

    // Measured 0.031 ms per pass; a tick has 2,000 ms of headroom at 1x speed.
    expect(msPerCluster, `${msPerCluster.toFixed(3)} ms per cluster pass`).toBeLessThan(0.5);
  });
});
