import type { CraneStatus, SimState } from "../sim";

// Derived-presentation layer (D-58): the single place the twin decides how an
// entity's operational state renders. Pure — reads sim state, NEVER mutates it
// (owner condition 1). "suspended" is derived from wxOps every call, never
// stored (recovery is automatic and stateless). Animation flags gate motion by
// the same signals that gate the simulation (owner condition 4): a crane that
// cannot advance productivity must not animate.
export type PresentedCraneStatus = CraneStatus | "suspended";

export type TwinPresentation = {
  tick: number;
  // crane id → presented status + whether its gantry/trolley may animate
  cranes: Record<string, { status: PresentedCraneStatus; animate: boolean }>;
  // vessel id → true while an approved hold is in force (tick < heldUntilTick)
  held: Record<string, boolean>;
  movesSuspended: boolean;
  // D-71: AGV activity mirrors actual operations — a finger branch runs AGVs only
  // while a vessel there is actively discharging (same gates as the tick's cargo
  // stage); the main loop mirrors GateState density, zero when RTGs can't feed it.
  agv: { branchCounts: number[]; mainCount: number };
};

// Memoised per state object (owner condition 2): the store replaces the
// SimState object on every tick / weather refresh / approved effect, so keying
// on object identity re-derives on exactly every relevant input change.
const cache = new WeakMap<SimState, TwinPresentation>();

export function presentTwin(sim: SimState): TwinPresentation {
  const hit = cache.get(sim);
  if (hit) return hit;

  const cranes: TwinPresentation["cranes"] = {};
  for (const c of sim.cranes) {
    const suspended =
      c.status !== "down" &&
      ((c.kind === "STS" && sim.wxOps.stsSuspended) || (c.kind === "RTG" && sim.wxOps.rtgSuspended));
    const status: PresentedCraneStatus = suspended ? "suspended" : c.status;
    cranes[c.id] = { status, animate: status !== "down" && status !== "suspended" };
  }

  const held: TwinPresentation["held"] = {};
  for (const v of sim.vessels) {
    if (v.heldUntilTick !== undefined && sim.clock.tick < v.heldUntilTick) held[v.id] = true;
  }

  // D-71: a finger's branch is active iff a berth there hosts a vessel alongside
  // with work remaining, and neither STS (work frozen) nor RTG (lots can't be
  // placed) is weather-suspended — the exact gates the tick's cargo stage uses.
  // The min-2 idle heuristic is gone: an idle port shows zero AGVs.
  const branchCounts = sim.fingers.map((finger) => {
    if (sim.wxOps.stsSuspended || sim.wxOps.rtgSuspended) return 0;
    const active = sim.berths.some((b) => {
      if (b.fingerId !== finger.id || !b.vesselId) return false;
      const v = sim.vessels.find((x) => x.id === b.vesselId);
      return !!v && v.status === "alongside" && v.workProgress < 1 && v.manifest.reduce((s, m) => s + m.quantityTEU, 0) > 0;
    });
    return active ? 2 : 0;
  });
  const mainCount = sim.wxOps.rtgSuspended ? 0 : Math.min(6, Math.max(0, Math.round(sim.gate.queuedTrucks / 5)));

  const result: TwinPresentation = {
    tick: sim.clock.tick,
    cranes,
    held,
    movesSuspended: sim.wxOps.movesSuspended,
    agv: { branchCounts, mainCount },
  };
  cache.set(sim, result);
  return result;
}
