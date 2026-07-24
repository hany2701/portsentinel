import { describe, it, expect } from "vitest";
import { generateWorld } from "./worldGen";
import { tick, clone } from "./tick";
import { berthFreeTicks } from "./derive";
import { nextServiceSlot, serviceById, SERVICE_JITTER, SERVICE_ROSTER } from "./roster";
import { makeRng } from "./rng";
import {
  agvMetrics,
  berthConflicts,
  berthTimeline,
  cargoJourney,
  dwellBuckets,
  projectedETD,
  queueEntryForecast,
  serviceCallSlots,
  vesselRemainingWorkTicks,
  yardCategoryPressure,
  yardFlowForecast,
} from "./opsDerive";
import type { SimState } from "./types";

function run(seed: number, ticks: number): SimState {
  let state = generateWorld(seed);
  for (let i = 0; i < ticks; i++) state = tick(state);
  return state;
}

const SEED = 20260710;

describe("opsDerive — determinism", () => {
  it("every derivation is a pure function of state (identical output twice)", () => {
    const a = run(SEED, 60);
    const b = run(SEED, 60);
    const h = 288;
    expect(berthTimeline(a, h)).toEqual(berthTimeline(b, h));
    expect(serviceCallSlots(a.clock.tick, h)).toEqual(serviceCallSlots(b.clock.tick, h));
    expect(berthConflicts(a)).toEqual(berthConflicts(b));
    expect(yardFlowForecast(a, h, 24)).toEqual(yardFlowForecast(b, h, 24));
    expect(agvMetrics(a)).toEqual(agvMetrics(b));
    expect(queueEntryForecast(a)).toEqual(queueEntryForecast(b));
    expect(dwellBuckets(a)).toEqual(dwellBuckets(b));
    expect(yardCategoryPressure(a)).toEqual(yardCategoryPressure(b));
  });

  it("never reads or advances the shared rng, and never mutates state", () => {
    const state = run(SEED, 45);
    const rngBefore = state.rng.state;
    const snapshot = clone(state);
    berthTimeline(state, 288);
    serviceCallSlots(state.clock.tick, 288);
    berthConflicts(state);
    yardFlowForecast(state, 288, 24);
    agvMetrics(state);
    queueEntryForecast(state);
    dwellBuckets(state);
    yardCategoryPressure(state);
    for (const v of state.vessels) {
      vesselRemainingWorkTicks(state, v);
      projectedETD(state, v);
      cargoJourney(state, { entityType: "vessel", entityId: v.id });
    }
    for (const l of state.cargoLots) cargoJourney(state, { entityType: "cargoLot", entityId: l.id });
    expect(state.rng.state).toBe(rngBefore);
    expect(state).toEqual(snapshot);
  });
});

describe("opsDerive — vesselRemainingWorkTicks vs shared berthFreeTicks", () => {
  it("agrees with berthFreeTicks for a discharge-only alongside vessel", () => {
    const state = run(SEED, 60);
    const alongside = state.vessels.find((v) => v.status === "alongside" && v.berthId);
    expect(alongside).toBeDefined();
    // Force discharge-only (no onward load) — the two must then agree exactly.
    const probe = clone(state);
    const v = probe.vessels.find((x) => x.id === alongside!.id)!;
    v.loadTarget = 0;
    v.loadedTEU = 0;
    const berth = probe.berths.find((b) => b.id === v.berthId)!;
    expect(vesselRemainingWorkTicks(probe, v)).toBe(berthFreeTicks(probe, berth));
  });

  it("is load-aware: never below the discharge-only estimate", () => {
    const state = run(SEED, 60);
    for (const v of state.vessels) {
      if (v.status !== "alongside" || !v.berthId) continue;
      const berth = state.berths.find((b) => b.id === v.berthId)!;
      expect(vesselRemainingWorkTicks(state, v)).toBeGreaterThanOrEqual(berthFreeTicks(state, berth));
    }
  });

  it("projectedETD is null for non-alongside vessels and >= now otherwise", () => {
    const state = run(SEED, 60);
    for (const v of state.vessels) {
      const etd = projectedETD(state, v);
      if (v.status === "alongside" && v.berthId) {
        expect(etd).not.toBeNull();
        expect(etd!).toBeGreaterThanOrEqual(state.clock.tick);
      } else {
        expect(etd).toBeNull();
      }
    }
  });
});

describe("opsDerive — berthTimeline invariants", () => {
  it("windows within a berth never overlap and respect the deep-water rule", () => {
    const state = run(SEED, 40);
    const rows = berthTimeline(state, 288);
    for (const row of rows) {
      const sorted = [...row.windows].sort((a, b) => a.startTick - b.startTick);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].startTick).toBeGreaterThanOrEqual(sorted[i - 1].endTick);
      }
      for (const w of row.windows) {
        const v = state.vessels.find((x) => x.id === w.vesselId)!;
        if (v.class === "neopanamax") expect(row.berth.deepWater).toBe(true);
      }
    }
  });

  it("covers exactly the berth set, in order", () => {
    const state = run(SEED, 20);
    const rows = berthTimeline(state, 144);
    expect(rows.map((r) => r.berth.id)).toEqual(state.berths.map((b) => b.id));
  });
});

describe("opsDerive — serviceCallSlots", () => {
  it("first slot per service matches nextServiceSlot within the jitter band", () => {
    const state = run(SEED, 10);
    const after = state.clock.tick;
    const slots = serviceCallSlots(after, 5000);
    for (const service of SERVICE_ROSTER) {
      const first = slots.find((s) => s.service.id === service.id);
      expect(first).toBeDefined();
      const jittered = nextServiceSlot(makeRng(1), serviceById(service.id)!, after);
      expect(Math.abs(jittered - first!.slotTick)).toBeLessThanOrEqual(SERVICE_JITTER);
      expect(first!.slotTick).toBeGreaterThan(after);
    }
  });

  it("returns slots in ascending tick order within the horizon", () => {
    const slots = serviceCallSlots(100, 600);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].slotTick).toBeGreaterThanOrEqual(slots[i - 1].slotTick);
    }
    for (const s of slots) expect(s.slotTick).toBeLessThanOrEqual(700);
  });
});

describe("opsDerive — yardFlowForecast", () => {
  it("has the right bucket count, non-negative flows and bounded utilisation", () => {
    const state = run(SEED, 60);
    const buckets = yardFlowForecast(state, 288, 24);
    expect(buckets.length).toBe(12);
    for (const b of buckets) {
      expect(b.inflowTEU).toBeGreaterThanOrEqual(0);
      expect(b.outflowTEU).toBeGreaterThanOrEqual(0);
      expect(b.projectedUtilPct).toBeGreaterThanOrEqual(0);
      expect(b.endTick - b.startTick).toBe(24);
    }
  });
});

describe("opsDerive — queue / dwell / category", () => {
  it("queueEntryForecast ranks the anchorage and every entry lands in the future", () => {
    const state = run(SEED, 30);
    const forecast = queueEntryForecast(state);
    expect(forecast.map((f) => f.queuePosition)).toEqual(forecast.map((_, i) => i + 1));
    for (const f of forecast) {
      expect(f.vessel.status).toBe("anchored");
      expect(f.entryTick).toBeGreaterThanOrEqual(state.clock.tick);
    }
  });

  it("dwellBuckets counts sum to the number of yard lots", () => {
    const state = run(SEED, 60);
    const yardLots = state.cargoLots.filter((l) => l.status === "yard").length;
    const summed = dwellBuckets(state).reduce((s, b) => s + b.count, 0);
    expect(summed).toBe(yardLots);
  });

  it("yardCategoryPressure covers every block's capacity once", () => {
    const state = run(SEED, 20);
    const totalCap = state.yardBlocks.reduce((s, b) => s + b.capacityTEU, 0);
    const summedCap = yardCategoryPressure(state).reduce((s, c) => s + c.capacityTEU, 0);
    expect(summedCap).toBe(totalCap);
  });
});

describe("opsDerive — berthConflicts + cargoJourney", () => {
  it("berthConflict entities resolve to real sim entities", () => {
    const state = run(SEED, 60);
    for (const c of berthConflicts(state)) {
      for (const ref of c.entities) {
        const exists =
          ref.entityType === "vessel"
            ? state.vessels.some((v) => v.id === ref.entityId)
            : ref.entityType === "berth"
              ? state.berths.some((b) => b.id === ref.entityId)
              : true;
        expect(exists).toBe(true);
      }
    }
  });

  it("cargoJourney resolves for a known vessel and lot, null for unknown", () => {
    const state = run(SEED, 60);
    const v = state.vessels[0];
    const vStages = cargoJourney(state, { entityType: "vessel", entityId: v.id });
    expect(vStages).not.toBeNull();
    expect(vStages!.length).toBeGreaterThan(0);
    const lot = state.cargoLots.find((l) => l.status === "yard");
    if (lot) expect(cargoJourney(state, { entityType: "cargoLot", entityId: lot.id })).not.toBeNull();
    expect(cargoJourney(state, { entityType: "vessel", entityId: "NOPE" })).toBeNull();
  });
});
