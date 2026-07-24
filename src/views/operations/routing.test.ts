import { describe, it, expect } from "vitest";
import { generateWorld } from "../../sim";
import { tick } from "../../sim";
import type { EntityRef, SimState, VesselStatus } from "../../sim";
import { operationsDestinations } from "./routing";

const SEED = 20260710;

function run(ticks: number): SimState {
  let state = generateWorld(SEED);
  for (let i = 0; i < ticks; i++) state = tick(state);
  return state;
}

function tabsFor(sim: SimState, ref: EntityRef): string[] {
  return operationsDestinations(sim, ref).map((d) => d.tab);
}

describe("operationsDestinations — static entity types", () => {
  const sim = run(0);
  it("berth → Berth Planning", () => {
    expect(tabsFor(sim, { entityType: "berth", entityId: sim.berths[0].id })).toEqual(["berths"]);
  });
  it("yard block → Yard Control", () => {
    expect(tabsFor(sim, { entityType: "yardBlock", entityId: sim.yardBlocks[0].id })).toEqual(["yard"]);
  });
  it("cargo lot → Cargo at Risk (defensive routing)", () => {
    expect(operationsDestinations(sim, { entityType: "cargoLot", entityId: "LOT-X" }).map((d) => d.tab)).toEqual(["cargo"]);
  });
  it("crane / gate / customer → no destination", () => {
    expect(operationsDestinations(sim, { entityType: "crane", entityId: sim.cranes[0].id })).toEqual([]);
    expect(operationsDestinations(sim, { entityType: "gate", entityId: "GATE-1" })).toEqual([]);
    expect(operationsDestinations(sim, { entityType: "customer", entityId: sim.customers[0].id })).toEqual([]);
  });
  it("unknown vessel id → no destination", () => {
    expect(operationsDestinations(sim, { entityType: "vessel", entityId: "NOPE" })).toEqual([]);
  });
});

describe("operationsDestinations — vessel by status", () => {
  const sim = run(60);
  const firstWith = (status: VesselStatus) => sim.vessels.find((v) => v.status === status);

  it("anchored vessel → Anchorage Queue then Berth Planning (multi-destination)", () => {
    const v = firstWith("anchored");
    if (!v) return; // seed-dependent; skip if none anchored at this tick
    expect(tabsFor(sim, { entityType: "vessel", entityId: v.id })).toEqual(["anchorage", "berths"]);
  });

  it("berthed vessels (alongside/berthing/departing) → Berth Planning only", () => {
    for (const status of ["alongside", "berthing", "departing", "approaching"] as VesselStatus[]) {
      const v = firstWith(status);
      if (!v) continue;
      expect(tabsFor(sim, { entityType: "vessel", entityId: v.id })).toEqual(["berths"]);
    }
  });

  it("every vessel resolves to a known Operations tab set", () => {
    const allowed = new Set(["berths", "yard", "anchorage", "cargo"]);
    for (const v of sim.vessels) {
      for (const d of operationsDestinations(sim, { entityType: "vessel", entityId: v.id })) {
        expect(allowed.has(d.tab)).toBe(true);
      }
    }
  });
});

describe("operationsDestinations — diverted vessel", () => {
  it("diverted vessel → Cargo at Risk", () => {
    // Construct the diverted state directly so the branch is always exercised.
    const base = run(0);
    const v0 = base.vessels[0];
    const sim: SimState = { ...base, vessels: [{ ...v0, status: "diverted" }, ...base.vessels.slice(1)] };
    expect(tabsFor(sim, { entityType: "vessel", entityId: v0.id })).toEqual(["cargo"]);
  });
});
