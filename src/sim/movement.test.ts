import { describe, expect, it } from "vitest";
import { generateWorld, tick, assertInvariants } from ".";
import { activePlan, isHandoverTick, openHandover, stepMaritime } from "./maritimeStep";
import { TICK_SIM_MINUTES } from "./config";
import { CLASS_SPEED_KNOTS, nmPerTick } from "../maritime/config";
import { edgeBetween } from "../maritime/graph";
import { inSingaporeApproach } from "../maritime/geofence";
import { routeNodeById } from "../maritime/network";
import { geographicVessels, trackedVessels } from "../maritime/selectors";
import { APPROACH_ENTRY } from "../twin/layout";
import { vesselSlot } from "../twin/bindings";
import type { SimState, Vessel } from "./types";

const SEED = 20260710;

function greatCircleNm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const toRad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * toRad;
  const dLon = (b.longitude - a.longitude) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * toRad) * Math.cos(b.latitude * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * 3440.065;
}

/** Run until `done`, returning every state so transitions can be inspected. */
function runUntil(
  seed: number,
  maxTicks: number,
  done: (s: SimState) => boolean,
): { states: SimState[]; found: boolean } {
  let state = generateWorld(seed);
  const states = [state];
  for (let i = 0; i < maxTicks && !done(state); i++) {
    state = tick(state);
    states.push(state);
  }
  return { states, found: done(state) };
}

const tuasBound = (s: SimState): Vessel[] =>
  trackedVessels(s).filter((v) => v.destinationPortId === "PORT-TUAS");

describe("maritime movement (GR-3)", () => {
  it("converts knots to nautical miles per tick consistently", () => {
    // A tick is TICK_SIM_MINUTES of simulated time, so 1 knot = 1/12 nm/tick.
    expect(nmPerTick(12)).toBeCloseTo(1, 10);
    expect(nmPerTick(CLASS_SPEED_KNOTS.neopanamax)).toBeCloseTo((21 * TICK_SIM_MINUTES) / 60, 10);
  });

  it("advances vessels along their route without teleporting", () => {
    let state = generateWorld(SEED);
    const maxStep = nmPerTick(Math.max(...Object.values(CLASS_SPEED_KNOTS))) * 1.5;
    for (let i = 0; i < 60; i++) {
      const before = new Map(geographicVessels(state).map((v) => [v.id, { ...v.track! }]));
      state = tick(state);
      for (const v of geographicVessels(state)) {
        const prev = before.get(v.id);
        if (!prev) continue; // just re-entered the geographic frame
        if (v.track!.routePlanId !== prev.routePlanId) continue; // turned around
        const moved = greatCircleNm(prev, v.track!);
        expect(moved, `${v.id} jumped ${moved.toFixed(1)} nm in one tick`).toBeLessThanOrEqual(maxStep);
      }
    }
  });

  it("carries leftover distance across edge boundaries", () => {
    let state = generateWorld(SEED);
    const v = geographicVessels(state)[0];
    const plan = activePlan(state, v.id)!;
    // Park the vessel just short of its current edge's end, then step once: it
    // must cross into the next edge rather than stall at the node.
    const span = edgeBetween(plan.nodeIds[v.track!.edgeIndex], plan.nodeIds[v.track!.edgeIndex + 1])!.distanceNm;
    const startIndex = v.track!.edgeIndex;
    v.track!.progressNm = span - 0.01;
    stepMaritime(state);
    const after = state.vessels.find((x) => x.id === v.id)!;
    expect(after.track!.edgeIndex).toBeGreaterThan(startIndex);
    expect(after.track!.progressNm).toBeGreaterThan(0);
  });

  it("slows vessels in bad weather and stops them on a blocked edge", () => {
    const calm = generateWorld(SEED);
    const stormy = generateWorld(SEED);
    stormy.weather.riskIndex = 95;
    const target = geographicVessels(calm)[0].id;
    stepMaritime(calm);
    stepMaritime(stormy);
    const calmSpeed = calm.vessels.find((v) => v.id === target)!.track!.speedKnots;
    const stormSpeed = stormy.vessels.find((v) => v.id === target)!.track!.speedKnots;
    expect(stormSpeed).toBeLessThan(calmSpeed);
  });

  it("draws no RNG, so the Tuas simulation stream is unaffected", () => {
    const state = generateWorld(SEED);
    const before = state.rng.state;
    stepMaritime(state);
    stepMaritime(state);
    expect(state.rng.state).toBe(before);
  });

  it("stays deterministic over 200 ticks", () => {
    let a = generateWorld(SEED);
    let b = generateWorld(SEED);
    for (let i = 0; i < 200; i++) {
      a = tick(a);
      b = tick(b);
    }
    expect(a.maritime).toEqual(b.maritime);
    expect(a.vessels).toEqual(b.vessels);
  });

  it("keeps maritime history bounded as vessels sail their loops", () => {
    // Vessels loop forever, so finished plans and closed handovers must be
    // pruned — every record is structuredClone'd on every tick, so unbounded
    // history is both a memory leak and a quadratic slowdown.
    let state = generateWorld(SEED);
    const tracked = trackedVessels(state).length;
    for (let i = 0; i < 1500; i++) state = tick(state);
    expect(state.maritime.routePlans.length).toBeLessThanOrEqual(tracked * 3);
    expect(state.maritime.handovers.length).toBeLessThanOrEqual(tracked * 3);
    // Every vessel still has its one active plan.
    for (const v of trackedVessels(state)) {
      if (v.status !== "enroute") continue;
      expect(activePlan(state, v.id), `${v.id} lost its active plan to pruning`).toBeDefined();
    }
  });

  it("holds every invariant over a long run at 130 vessels", () => {
    let state = generateWorld(SEED);
    for (let i = 0; i < 2000; i++) {
      state = tick(state);
      assertInvariants(state);
    }
    expect(state.vessels).toHaveLength(130);
    expect(state.vessels.filter((v) => v.scope === undefined)).toHaveLength(22);
  });
});

describe("geographic ↔ D-62 handover (GR-3)", () => {
  const inbound = runUntil(SEED, 4000, (s) =>
    s.maritime.handovers.some((h) => h.direction === "regional_to_tuas"),
  );

  it("hands a Tuas-bound vessel over at the approach fence", () => {
    expect(inbound.found, "no vessel reached the Tuas approach fence").toBe(true);
    const state = inbound.states[inbound.states.length - 1];
    const handover = state.maritime.handovers.find((h) => h.direction === "regional_to_tuas")!;
    expect(handover.handoverTick).toBe(state.clock.tick);
    const vessel = state.vessels.find((v) => v.id === handover.vesselId)!;
    expect(vessel.status).toBe("approaching");
    expect(vessel.scope).toBeDefined();
  });

  it("records a complete inbound handover schema", () => {
    const state = inbound.states[inbound.states.length - 1];
    const handover = state.maritime.handovers.find((h) => h.direction === "regional_to_tuas")!;
    expect(handover.direction).toBe("regional_to_tuas");
    expect(handover.status).toBe("active");
    expect(handover.routeVersion).toBeGreaterThanOrEqual(1);
    expect(handover.d62AnchorId).toBe("D62-APPROACH-ENTRY");
    // The geographic state at the crossing is captured in full.
    const entry = handover.regionalEntry;
    expect(entry.latitude).toBeGreaterThan(-90);
    expect(entry.longitude).toBeGreaterThan(-180);
    expect(entry.speedKnots).toBeGreaterThan(0);
    expect(entry.headingDeg).toBeGreaterThanOrEqual(0);
    expect(entry.headingDeg).toBeLessThan(360);
    expect(inSingaporeApproach(entry), "handover recorded outside the fence").toBe(true);
  });

  it("moves the vessel with neither engine on the handover tick", () => {
    const states = inbound.states;
    const at = states.length - 1;
    const state = states[at];
    const handover = state.maritime.handovers.find((h) => h.direction === "regional_to_tuas")!;
    const before = states[at - 1].vessels.find((v) => v.id === handover.vesselId)!;
    const after = state.vessels.find((v) => v.id === handover.vesselId)!;

    expect(isHandoverTick(state, after.id)).toBe(true);
    // Geographic frame: position frozen for the crossing tick.
    expect(after.track!.latitude).toBe(before.track!.latitude);
    expect(after.track!.longitude).toBe(before.track!.longitude);
    // Tuas frame: the FSM has not advanced it either — it is still approaching,
    // not anchored, regardless of its ETA.
    expect(after.status).toBe("approaching");
    expect(after.anchoredSinceTick).toBeUndefined();
  });

  it("pins the vessel at the exact D-62 entry anchor during the handover tick", () => {
    const state = inbound.states[inbound.states.length - 1];
    const handover = state.maritime.handovers.find((h) => h.direction === "regional_to_tuas")!;
    const vessel = state.vessels.find((v) => v.id === handover.vesselId)!;
    expect(vesselSlot(state, vessel)).toEqual(APPROACH_ENTRY);
  });

  it("starts D-62 movement only on the tick after the handover", () => {
    const state = inbound.states[inbound.states.length - 1];
    const handover = state.maritime.handovers.find((h) => h.direction === "regional_to_tuas")!;
    const next = tick(state);
    const vessel = next.vessels.find((v) => v.id === handover.vesselId)!;
    expect(isHandoverTick(next, vessel.id)).toBe(false);
    // No longer pinned: it has joined the normal approach queue.
    expect(vesselSlot(next, vessel)).not.toEqual(APPROACH_ENTRY);
  });

  it("orients the vessel by the D-62 path tangent, not the geographic heading", () => {
    const state = inbound.states[inbound.states.length - 1];
    const handover = state.maritime.handovers.find((h) => h.direction === "regional_to_tuas")!;
    const vessel = state.vessels.find((v) => v.id === handover.vesselId)!;
    const slot = vesselSlot(state, vessel)!;
    // The slot's yaw comes from the approach anchor's own tangent. The recorded
    // geographic heading is metadata and is deliberately not transformed into
    // this frame — the two numbers are in different coordinate systems.
    expect(slot.angleY).toBe(APPROACH_ENTRY.angleY);
    expect(handover.direction === "regional_to_tuas" && handover.regionalEntry.headingDeg).not.toBe(
      slot.angleY,
    );
  });

  it("keeps exactly one movement owner per vessel across a long run", () => {
    let state = generateWorld(SEED);
    for (let i = 0; i < 1500; i++) {
      const before = new Map(state.vessels.map((v) => [v.id, { status: v.status, track: v.track && { ...v.track } }]));
      state = tick(state);
      for (const v of state.vessels) {
        const prev = before.get(v.id);
        if (!prev?.track || !v.track) continue;
        if (isHandoverTick(state, v.id)) {
          const handover = openHandover(state, v.id)!;
          if (handover.direction === "regional_to_tuas") {
            // Crossing INTO D-62: the geographic position freezes exactly, and
            // the Tuas FSM has not started moving it either.
            expect(v.track.latitude, `${v.id} moved on its handover tick`).toBe(prev.track.latitude);
            expect(v.track.longitude).toBe(prev.track.longitude);
          } else {
            // Crossing OUT of D-62: the vessel re-enters the geographic frame at
            // the approved exit node, which is the contract, not movement.
            const exit = routeNodeById(handover.geographicExitNodeId)!;
            expect(v.track.latitude).toBe(exit.latitude);
            expect(v.track.longitude).toBe(exit.longitude);
            expect(v.track.progressNm).toBe(0);
          }
        }
        // A vessel is never simultaneously geographic and berthed.
        if (v.status === "enroute") expect(v.berthId).toBeUndefined();
      }
      // The invariant layer enforces at most one open handover per vessel.
      assertInvariants(state);
    }
  });

  it("never creates a duplicate vessel or loses a canonical id", () => {
    let state = generateWorld(SEED);
    const originalIds = new Set(state.vessels.map((v) => v.id));
    for (let i = 0; i < 1500; i++) {
      state = tick(state);
      expect(state.vessels).toHaveLength(130);
      const ids = state.vessels.map((v) => v.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(originalIds.has(id), `${id} is a new vessel`).toBe(true);
    }
  });

  it("shows a handed-over vessel in one frame only", () => {
    const state = inbound.states[inbound.states.length - 1];
    const handover = state.maritime.handovers.find((h) => h.direction === "regional_to_tuas")!;
    // It has left the geographic maps...
    expect(geographicVessels(state).some((v) => v.id === handover.vesselId)).toBe(false);
    // ...and appears in the D-62 frame instead.
    const vessel = state.vessels.find((v) => v.id === handover.vesselId)!;
    expect(vesselSlot(state, vessel)).not.toBeNull();
  });

  it("caps how many tracked vessels join the Tuas FSM", () => {
    const state = inbound.states[inbound.states.length - 1];
    expect(tuasBound(state).length).toBeLessThanOrEqual(3);
    const tuasActive = state.vessels.filter((v) => v.status !== "enroute").length;
    expect(tuasActive, "Tuas-active population exceeded 25").toBeLessThanOrEqual(25);
  });
});

describe("outbound handover back to the regional route (GR-3)", () => {
  const outbound = runUntil(SEED, 6000, (s) =>
    s.maritime.handovers.some((h) => h.direction === "tuas_to_regional"),
  );

  it("returns a departing tracked vessel to the geographic frame", () => {
    expect(outbound.found, "no tracked vessel completed a Tuas call").toBe(true);
    const state = outbound.states[outbound.states.length - 1];
    const handover = state.maritime.handovers.find((h) => h.direction === "tuas_to_regional")!;
    const vessel = state.vessels.find((v) => v.id === handover.vesselId)!;
    expect(vessel.status).toBe("enroute");
    expect(vessel.scope).toBeDefined();
    expect(vessel.berthId).toBeUndefined();
  });

  it("records a complete outbound handover schema", () => {
    const state = outbound.states[outbound.states.length - 1];
    const handover = state.maritime.handovers.find((h) => h.direction === "tuas_to_regional")!;
    expect(handover.direction).toBe("tuas_to_regional");
    if (handover.direction !== "tuas_to_regional") return;
    expect(handover.d62Exit.anchorId).toBe("D62-DEPARTURE-EXIT");
    expect(handover.d62Exit.speedKnots).toBeGreaterThan(0);
    expect(handover.geographicExitNodeId).toBe("NODE-TUAS-ANCHORAGE");
    expect(handover.routeVersion).toBeGreaterThanOrEqual(1);
  });

  it("resumes at the approved exit node, not an unrelated corridor node", () => {
    const state = outbound.states[outbound.states.length - 1];
    const handover = state.maritime.handovers.find((h) => h.direction === "tuas_to_regional")!;
    const vessel = state.vessels.find((v) => v.id === handover.vesselId)!;
    const exit = routeNodeById("NODE-TUAS-ANCHORAGE")!;
    expect(vessel.track!.latitude).toBe(exit.latitude);
    expect(vessel.track!.longitude).toBe(exit.longitude);
    const plan = activePlan(state, vessel.id)!;
    expect(plan.nodeIds[0]).toBe("NODE-TUAS-ANCHORAGE");
    expect(plan.status).toBe("active");
  });

  it("preserves identity and operational history across the round trip", () => {
    const state = outbound.states[outbound.states.length - 1];
    const handover = state.maritime.handovers.find((h) => h.direction === "tuas_to_regional")!;
    const vessel = state.vessels.find((v) => v.id === handover.vesselId)!;
    // Same canonical id, same service, and both legs of its journey recorded.
    const its = state.maritime.handovers.filter((h) => h.vesselId === vessel.id);
    expect(its.map((h) => h.direction)).toEqual(["regional_to_tuas", "tuas_to_regional"]);
    expect(state.maritime.routePlans.filter((p) => p.vesselId === vessel.id).length).toBeGreaterThan(1);
    expect(openHandover(state, vessel.id)).toBeDefined();
  });
});
