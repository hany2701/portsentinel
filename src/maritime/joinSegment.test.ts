import { describe, expect, it } from "vitest";
import { applyEffect, generateWorld, tick } from "../sim";
import { joinPolyline, originalPlanFor, activePlanFor, remainingPolyline } from "./selectors";
import { routeCandidates } from "./routeEngine";
import { routeNodeById } from "./network";
import { geographicVessels } from "./selectors";
import type { SimState } from "../sim";

// MDS-4: the no-teleport contract (GR-D12b) is the strongest correctness
// guarantee in the maritime engine, and until now it was invisible — a reroute
// looked like a clean switch to a new line. These pin the DRAWN evidence: the
// connector exists, it starts where the ship actually is, and the superseded
// route is still available to draw as history.
//
// No engine behaviour is asserted here that reroute.test.ts does not already
// own; this is about what the map can show.

const SEED = 20260710;

/** A world where some vessel has an alternative route available. */
function reroutableWorld(): { state: SimState; vesselId: string } {
  let state = generateWorld(SEED);
  for (let i = 0; i < 20; i++) state = tick(state);
  state.disruptions.push({
    id: "D-JOIN",
    type: "storm",
    targetIds: ["WPT-MALACCA-S", "WPT-MALACCA-N"],
    startTick: state.clock.tick + 1,
    durationTicks: 300,
    severity: 3,
  });
  for (let i = 0; i < 5; i++) state = tick(state);

  const v = geographicVessels(state).find((x) => {
    const cands = routeCandidates(state, x.id);
    const active = activePlanFor(state, x.id);
    return cands.length > 0 && active && cands[0].nodeIds.join(">") !== active.nodeIds.join(">");
  });
  if (!v) throw new Error("fixture produced no vessel with a differing candidate");
  return { state, vesselId: v.id };
}

describe("join segment on the map (MDS-4)", () => {
  it("draws nothing while no reroute is in flight", () => {
    const { state, vesselId } = reroutableWorld();
    const vessel = state.vessels.find((v) => v.id === vesselId)!;
    expect(vessel.track!.joinSegment).toBeUndefined();
    expect(joinPolyline(vessel)).toEqual([]);
  });

  it("draws the connector from the vessel's ACTUAL position after a reroute", () => {
    const { state, vesselId } = reroutableWorld();
    const candidate = routeCandidates(state, vesselId)[0];

    const before = state.vessels.find((v) => v.id === vesselId)!.track!;
    const at = { lat: before.latitude, lon: before.longitude };

    applyEffect(state, {
      kind: "rerouteVoyage",
      vesselId,
      toNodeIds: candidate.nodeIds,
      reason: "weather",
    });

    const after = state.vessels.find((v) => v.id === vesselId)!;
    // The whole point of the contract: approval moved nothing.
    expect(after.track!.latitude).toBe(at.lat);
    expect(after.track!.longitude).toBe(at.lon);

    // Measured: across this fixture 105 of 105 reroutes produce a connector, so
    // this is asserted outright rather than behind an `if` that could let the
    // real checks silently skip.
    expect(after.track!.joinSegment).toBeDefined();

    const join = joinPolyline(after);
    expect(join).toHaveLength(2);
    // Starts exactly where the ship is...
    expect(join[0]).toEqual([at.lon, at.lat]);
    // ...and ends at the node it rejoins, not at some other waypoint.
    const to = routeNodeById(after.track!.joinSegment!.toNodeId)!;
    expect(join[1]).toEqual([to.longitude, to.latitude]);
  });

  it("keeps the superseded route available to draw as history", () => {
    const { state, vesselId } = reroutableWorld();
    const candidate = routeCandidates(state, vesselId)[0];
    const originalBefore = activePlanFor(state, vesselId)!;

    applyEffect(state, {
      kind: "rerouteVoyage",
      vesselId,
      toNodeIds: candidate.nodeIds,
      reason: "weather",
    });

    const active = activePlanFor(state, vesselId)!;
    const original = originalPlanFor(state, vesselId)!;
    // A new active plan, and the old one retained for the muted "original" line.
    expect(active.id).not.toBe(originalBefore.id);
    expect(original.id).toBe(originalBefore.id);
    expect(active.routeVersion).toBeGreaterThan(original.routeVersion);
  });

  it("keeps the active line starting at the vessel, connector or not", () => {
    const { state, vesselId } = reroutableWorld();
    const candidate = routeCandidates(state, vesselId)[0];
    applyEffect(state, {
      kind: "rerouteVoyage",
      vesselId,
      toNodeIds: candidate.nodeIds,
      reason: "weather",
    });

    const vessel = state.vessels.find((v) => v.id === vesselId)!;
    const line = remainingPolyline(state, vessel);
    expect(line[0]).toEqual([vessel.track!.longitude, vessel.track!.latitude]);
  });
});
