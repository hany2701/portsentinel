import { describe, expect, it } from "vitest";
import { generateWorld, tick } from ".";
import {
  DECISION_HISTORY_PER_VESSEL,
  HANDOVER_HISTORY_PER_VESSEL,
  ROUTE_HISTORY_PER_VESSEL,
  activePlan,
  openHandover,
  pruneMaritimeHistory,
} from "./maritimeStep";
import { trackedVessels } from "../maritime/selectors";
import type { RerouteDecision, SimState, VesselRoutePlan } from "./types";

const SEED = 20260710;

// GR-3: vessels sail their loops indefinitely, so finished route plans, closed
// handovers and resolved decisions would grow without bound — and every one of
// them is structuredClone'd on every tick. Pruning keeps the history bounded.
// These tests pin what it must NEVER drop.

function makePlan(state: SimState, vesselId: string, version: number, status: VesselRoutePlan["status"]): VesselRoutePlan {
  const plan: VesselRoutePlan = {
    id: `RP-TEST-${vesselId}-${version}`,
    vesselId,
    routeVersion: version,
    status,
    nodeIds: ["PORT-TUAS", "NODE-TUAS-ANCHORAGE"],
    originNodeId: "PORT-TUAS",
    destinationNodeId: "NODE-TUAS-ANCHORAGE",
    totalDistanceNm: 10,
    etaTick: state.clock.tick + 10,
    expectedWaitMinutes: 0,
    weatherRisk: 0,
    congestionRisk: 0,
    totalCost: 0,
    createdTick: state.clock.tick,
  };
  state.maritime.routePlans.push(plan);
  return plan;
}

function makeDecision(
  state: SimState,
  vesselId: string,
  originalPlanId: string,
  approvalStatus: RerouteDecision["approvalStatus"],
  newPlanId?: string,
): RerouteDecision {
  const decision: RerouteDecision = {
    id: `RD-TEST-${vesselId}-${approvalStatus}-${state.maritime.rerouteDecisions.length}`,
    vesselId,
    originalPlanId,
    newPlanId,
    reason: "weather",
    highRiskEdgeIds: [],
    delayAvoidedMinutes: 30,
    additionalDistanceNm: 12,
    approvalStatus,
    createdTick: state.clock.tick,
  };
  state.maritime.rerouteDecisions.push(decision);
  return decision;
}

describe("maritime history pruning (GR-3)", () => {
  it("retains every vessel's active route plan", () => {
    let state = generateWorld(SEED);
    for (let i = 0; i < 1200; i++) state = tick(state);
    for (const v of trackedVessels(state)) {
      if (v.status !== "enroute" || !v.track) continue;
      const plan = activePlan(state, v.id);
      expect(plan, `${v.id} lost its active plan`).toBeDefined();
      // The plan the vessel is actually sailing must be the one retained.
      expect(plan!.id).toBe(v.track.routePlanId);
    }
  });

  it("retains the two most recent historical plans per vessel", () => {
    const state = generateWorld(SEED);
    const vesselId = trackedVessels(state)[0].id;
    // Five superseded generations plus the live one.
    for (let version = 1; version <= 5; version++) makePlan(state, vesselId, version, "superseded");
    const live = makePlan(state, vesselId, 6, "active");

    pruneMaritimeHistory(state);

    const mine = state.maritime.routePlans.filter((p) => p.id.startsWith(`RP-TEST-${vesselId}`));
    const historical = mine.filter((p) => p.status !== "active");
    expect(historical).toHaveLength(ROUTE_HISTORY_PER_VESSEL);
    // The two KEPT are the most recent, not an arbitrary pair.
    expect(historical.map((p) => p.routeVersion)).toEqual([4, 5]);
    expect(mine.some((p) => p.id === live.id)).toBe(true);
  });

  it("keeps enough lineage to compare the original route against the active one", () => {
    const state = generateWorld(SEED);
    const vesselId = trackedVessels(state)[0].id;
    const superseded = makePlan(state, vesselId, 1, "superseded");
    const active = makePlan(state, vesselId, 2, "active");
    makeDecision(state, vesselId, superseded.id, "executed", active.id);

    pruneMaritimeHistory(state);

    const ids = new Set(state.maritime.routePlans.map((p) => p.id));
    expect(ids.has(superseded.id), "original route lost — nothing to compare against").toBe(true);
    expect(ids.has(active.id)).toBe(true);
    // Both route versions survive, so v1→v2 is still traceable.
    const versions = state.maritime.routePlans
      .filter((p) => p.vesselId === vesselId && p.id.startsWith("RP-TEST"))
      .map((p) => p.routeVersion);
    expect(versions).toEqual([1, 2]);
  });

  it("never drops a plan a live decision still points at", () => {
    const state = generateWorld(SEED);
    const vesselId = trackedVessels(state)[0].id;
    // Bury the cited plan under more history than the per-vessel cap allows.
    const cited = makePlan(state, vesselId, 1, "superseded");
    for (let version = 2; version <= 6; version++) makePlan(state, vesselId, version, "superseded");
    makePlan(state, vesselId, 7, "active");
    makeDecision(state, vesselId, cited.id, "pending");

    pruneMaritimeHistory(state);

    expect(
      state.maritime.routePlans.some((p) => p.id === cited.id),
      "a pending decision was left pointing at a deleted plan",
    ).toBe(true);
    // And every surviving decision still resolves both of its plan references.
    const planIds = new Set(state.maritime.routePlans.map((p) => p.id));
    for (const decision of state.maritime.rerouteDecisions) {
      expect(planIds.has(decision.originalPlanId), `${decision.id} lost its original plan`).toBe(true);
      if (decision.newPlanId) expect(planIds.has(decision.newPlanId)).toBe(true);
    }
  });

  it("keeps unresolved decisions and trims only resolved ones", () => {
    const state = generateWorld(SEED);
    const vesselId = trackedVessels(state)[0].id;
    const plan = makePlan(state, vesselId, 1, "active");
    makeDecision(state, vesselId, plan.id, "pending");
    makeDecision(state, vesselId, plan.id, "approved");
    for (let i = 0; i < 6; i++) makeDecision(state, vesselId, plan.id, "executed", plan.id);

    pruneMaritimeHistory(state);

    const mine = state.maritime.rerouteDecisions.filter((d) => d.vesselId === vesselId);
    expect(mine.filter((d) => d.approvalStatus === "pending")).toHaveLength(1);
    expect(mine.filter((d) => d.approvalStatus === "approved")).toHaveLength(1);
    expect(mine.filter((d) => d.approvalStatus === "executed")).toHaveLength(DECISION_HISTORY_PER_VESSEL);
  });

  it("retains the open handover and trims closed ones", () => {
    let state = generateWorld(SEED);
    // Run long enough for at least one vessel to cross frames.
    for (let i = 0; i < 4000 && !state.maritime.handovers.length; i++) state = tick(state);
    const handover = state.maritime.handovers[0];
    expect(handover, "no handover occurred in the run").toBeDefined();
    expect(openHandover(state, handover.vesselId)).toBeDefined();

    for (const h of state.maritime.handovers) h.status = "completed";
    for (let i = 0; i < 8; i++) {
      state.maritime.handovers.push({ ...handover, status: "completed", handoverTick: state.clock.tick - i });
    }
    pruneMaritimeHistory(state);
    const mine = state.maritime.handovers.filter((h) => h.vesselId === handover.vesselId);
    expect(mine).toHaveLength(HANDOVER_HISTORY_PER_VESSEL);
  });

  it("keeps state bounded over a long soak", () => {
    let state = generateWorld(SEED);
    const tracked = trackedVessels(state).length;
    const sizeAt = (s: SimState) =>
      s.maritime.routePlans.length + s.maritime.handovers.length + s.maritime.rerouteDecisions.length;

    for (let i = 0; i < 1000; i++) state = tick(state);
    const first = sizeAt(state);
    for (let i = 0; i < 1000; i++) state = tick(state);
    const second = sizeAt(state);
    for (let i = 0; i < 1000; i++) state = tick(state);
    const late = sizeAt(state);

    // The hard ceiling: active + history, per vessel, for each record kind.
    const ceiling = tracked * (1 + ROUTE_HISTORY_PER_VESSEL + HANDOVER_HISTORY_PER_VESSEL + DECISION_HISTORY_PER_VESSEL);
    expect(late).toBeLessThanOrEqual(ceiling);

    // Growth must DECELERATE, and measurably. A vessel fills its history slots
    // over its first few voyages, so the state converges on the ceiling and each
    // window adds materially less than the one before it (measured: +58 then
    // +34, i.e. 0.59). A leak is the opposite shape — growth stays linear in the
    // tick count, so the two windows come out EQUAL. That is why this asserts a
    // real drop rather than "no worse than": equal windows must fail.
    //
    // This replaced a fixed "late <= early * 1.5" ratio, which measured warm-up
    // speed rather than boundedness — it depended on how fast vessels complete
    // voyages, so it tripped the moment corridor allocation moved vessels from
    // the 62 nm Riau loop onto 1,000+ nm loops even though nothing leaked.
    const firstWindow = second - first;
    const secondWindow = late - second;
    expect(firstWindow).toBeGreaterThan(0);
    expect(secondWindow, "state growth is not decelerating — suspect a pruning leak").toBeLessThanOrEqual(
      firstWindow * 0.75,
    );
  });

  it("does not change deterministic simulation results", () => {
    // Pruning is history management, not simulation: two runs from one seed stay
    // identical, and the RNG stream is untouched by it.
    let a = generateWorld(SEED);
    let b = generateWorld(SEED);
    for (let i = 0; i < 300; i++) {
      a = tick(a);
      b = tick(b);
    }
    expect(a.rng.state).toBe(b.rng.state);
    expect(a.vessels).toEqual(b.vessels);
    expect(a.maritime).toEqual(b.maritime);

    // Pruning an already-pruned state is a no-op, so it can never race the sim.
    const before = structuredClone(a.maritime);
    pruneMaritimeHistory(a);
    expect(a.maritime).toEqual(before);
    expect(a.rng.state).toBe(b.rng.state);
  });
});
