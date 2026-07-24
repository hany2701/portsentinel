// D-58 owner-condition tests (INT-4): the twin's presentation may never
// contradict the simulation. Pure TS — no rendering involved.
import { describe, it, expect } from "vitest";
import { generateWorld } from "../sim/worldGen";
import { tick } from "../sim/tick";
import { applyEffect } from "../sim/effects";
import type { SimState, WeatherReading } from "../sim/types";
import { presentTwin } from "./presentation";

const CALM: WeatherReading = { asOfMs: 0, windKts: 8, gustKts: 10, windDirDeg: 90, waveHeightM: 0.3, visibilityKm: 12, precipMm: 0 };
const LOW_VIS: WeatherReading = { ...CALM, visibilityKm: 2 };
const CRITICAL: WeatherReading = { ...CALM, gustKts: 30, waveHeightM: 2, precipMm: 8 };

function withFeed(state: SimState, reading: WeatherReading): SimState {
  state.weatherFeed = { reading, freshness: "live" };
  return state;
}

// One anchored vessel, everything else pushed out of the queue, berths open.
function isolateAnchored(state: SimState): string {
  const anchored = state.vessels.filter((v) => v.status === "anchored");
  const keep = anchored[0];
  keep.class = "panamax";
  for (const v of anchored.slice(1)) {
    v.status = "approaching";
    v.etaTick = state.clock.tick + 500;
    v.anchoredSinceTick = undefined;
  }
  return keep.id;
}

describe("twin presentation (D-58 conditions, INT-4)", () => {
  it("condition 5a: a held vessel does not berth before heldUntilTick, then berths", () => {
    let state = withFeed(generateWorld(20260710), CALM);
    const id = isolateAnchored(state);
    applyEffect(state, { kind: "holdVessel", vesselId: id, untilTick: state.clock.tick + 4 });
    expect(presentTwin(state).held[id]).toBe(true);
    for (let i = 0; i < 3; i++) {
      state = tick(state);
      expect(state.vessels.find((v) => v.id === id)!.status).toBe("anchored");
    }
    for (let i = 0; i < 3; i++) state = tick(state); // hold expires
    const after = state.vessels.find((v) => v.id === id)!;
    expect(["berthing", "alongside"]).toContain(after.status);
    expect(presentTwin(state).held[id]).toBeUndefined(); // held presentation cleared
  });

  it("condition 5b: reaching heldUntilTick does not bypass an active weather restriction", () => {
    let state = withFeed(generateWorld(20260710), LOW_VIS);
    const id = isolateAnchored(state);
    applyEffect(state, { kind: "holdVessel", vesselId: id, untilTick: state.clock.tick + 2 });
    for (let i = 0; i < 6; i++) state = tick(state); // hold long expired, moves still suspended
    expect(state.wxOps.movesSuspended).toBe(true);
    expect(state.vessels.find((v) => v.id === id)!.status).toBe("anchored");
  });

  it("condition 5c: suspended cranes neither animate nor advance productivity", () => {
    let state = withFeed(generateWorld(20260710), CRITICAL);
    state = tick(state);
    const pres = presentTwin(state);
    for (const c of state.cranes) {
      if (c.status === "down") continue;
      expect(pres.cranes[c.id].status).toBe("suspended");
      expect(pres.cranes[c.id].animate).toBe(false);
    }
    const before = state.vessels.filter((v) => v.status === "alongside").map((v) => v.workProgress);
    state = tick(state);
    expect(state.vessels.filter((v) => v.status === "alongside").map((v) => v.workProgress)).toEqual(before);
  });

  it("condition 5d: frozen transfers advance neither visually nor operationally", () => {
    let state = withFeed(generateWorld(20260710), { ...CALM, gustKts: 50 }); // RTG gust gate
    state = tick(state);
    const pres = presentTwin(state);
    for (const c of state.cranes.filter((x) => x.kind === "RTG" && x.status !== "down")) {
      expect(pres.cranes[c.id].status).toBe("suspended");
      expect(pres.cranes[c.id].animate).toBe(false);
    }
    const yardTEU = (s: SimState) => s.cargoLots.filter((l) => l.status === "yard").reduce((t, l) => t + l.quantityTEU, 0);
    const before = yardTEU(state);
    state = tick(state);
    expect(yardTEU(state)).toBe(before);
  });

  it("condition 1+2: presentTwin never mutates sim state and memoises per state object", () => {
    let state = withFeed(generateWorld(20260710), CRITICAL);
    state = tick(state);
    const snapshot = JSON.stringify(state);
    const a = presentTwin(state);
    const b = presentTwin(state);
    expect(JSON.stringify(state)).toBe(snapshot); // no mutation
    expect(b).toBe(a); // memo hit for the same state object
    const next = tick(state); // new state object → fresh derivation
    expect(presentTwin(next)).not.toBe(a);
  });

  it("operational cranes animate and read their sim status", () => {
    let state = withFeed(generateWorld(20260710), CALM);
    state = tick(state);
    const pres = presentTwin(state);
    const op = state.cranes.find((c) => c.status === "operational")!;
    expect(pres.cranes[op.id]).toEqual({ status: "operational", animate: true });
  });
});

describe("AGV flow realism (D-71)", () => {
  it("populates only the branches of fingers with an actively discharging vessel", () => {
    let state = withFeed(generateWorld(20260710), CALM);
    state = tick(state);
    const pres = presentTwin(state);
    state.fingers.forEach((finger, i) => {
      const active = state.berths.some((b) => {
        if (b.fingerId !== finger.id || !b.vesselId) return false;
        const v = state.vessels.find((x) => x.id === b.vesselId)!;
        return v.status === "alongside" && v.workProgress < 1 && v.manifest.reduce((s, m) => s + m.quantityTEU, 0) > 0;
      });
      expect(pres.agv.branchCounts[i]).toBe(active ? 2 : 0);
    });
  });

  it("STS suspension empties every finger branch", () => {
    let state = withFeed(generateWorld(20260710), { ...CALM, gustKts: 40 }); // STS gate only
    state = tick(state);
    expect(state.wxOps.stsSuspended).toBe(true);
    expect(presentTwin(state).agv.branchCounts).toEqual([0, 0, 0, 0]);
  });

  it("RTG suspension empties branches AND the main loop, whatever the gate queue", () => {
    let state = withFeed(generateWorld(20260710), { ...CALM, gustKts: 50 }); // RTG gate
    state = tick(state);
    state.gate.queuedTrucks = 80;
    expect(state.wxOps.rtgSuspended).toBe(true);
    const pres = presentTwin(state);
    expect(pres.agv.branchCounts).toEqual([0, 0, 0, 0]);
    expect(pres.agv.mainCount).toBe(0);
  });

  it("an idle port shows zero AGVs — the min-2 heuristic is gone", () => {
    const state = withFeed(generateWorld(20260710), CALM);
    for (const v of state.vessels) if (v.status === "alongside") v.workProgress = 1;
    state.gate.queuedTrucks = 0;
    const pres = presentTwin(state);
    expect(pres.agv.branchCounts).toEqual([0, 0, 0, 0]);
    expect(pres.agv.mainCount).toBe(0);
  });
});
