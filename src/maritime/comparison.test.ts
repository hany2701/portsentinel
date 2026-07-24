import { describe, expect, it } from "vitest";
import { generateWorld, tick } from "../sim";
import { activeRouteSummary, routeCandidates } from "./routeEngine";
import { edgeConditions, geographicVessels } from "./selectors";
import { nodePathGeometry } from "./routeGeometry";
import { edgeBetween, sequenceDistanceNm } from "./graph";
import type { Disruption, SimState } from "../sim";

// MDS-2: the comparison table and the drawn alternatives must both be pure
// readings of the routing engine. The failure this guards against is a view
// layer that "helpfully" recomputes a figure its own way — then the table and
// the route the Approve button would execute quietly disagree.

const SEED = 20260710;

function stormAt(targetIds: string[], startTick: number): Disruption {
  return { id: "D-CMP", type: "storm", targetIds, startTick, durationTicks: 300, severity: 3 };
}

/** A world with a hazard on the Malacca approach and a vessel routed through it. */
function worldWithCandidates(): { state: SimState; vesselId: string } {
  let state = generateWorld(SEED);
  for (let i = 0; i < 20; i++) state = tick(state);
  state.disruptions.push(stormAt(["WPT-MALACCA-S", "WPT-MALACCA-N"], state.clock.tick + 1));
  for (let i = 0; i < 3; i++) state = tick(state);

  const withOptions = geographicVessels(state).find((v) => routeCandidates(state, v.id).length > 0);
  if (!withOptions) throw new Error("fixture produced no vessel with route candidates");
  return { state, vesselId: withOptions.id };
}

describe("route comparison (MDS-2)", () => {
  it("measures the current route the same way it measures the candidates", () => {
    const { state, vesselId } = worldWithCandidates();
    const active = activeRouteSummary(state, vesselId);
    expect(active).not.toBeNull();

    // The "Current" column must describe the REMAINING voyage, not the whole
    // plan — otherwise it is compared against candidates that start from here.
    const vessel = state.vessels.find((v) => v.id === vesselId)!;
    const plan = state.maritime.routePlans.find(
      (p) => p.vesselId === vesselId && p.status === "active",
    )!;
    const remainder = plan.nodeIds.slice(vessel.track!.edgeIndex + 1);
    expect(active!.nodeIds).toEqual(remainder);
    expect(active!.distanceNm).toBeCloseTo(sequenceDistanceNm(remainder), 6);
  });

  it("derives every candidate figure from the engine, not from the view", () => {
    const { state, vesselId } = worldWithCandidates();
    const conditions = edgeConditions(state);
    const candidates = routeCandidates(state, vesselId, conditions);
    expect(candidates.length).toBeGreaterThan(0);

    for (const c of candidates) {
      // Distance is the graph's own measure of the node sequence.
      expect(c.distanceNm).toBeCloseTo(sequenceDistanceNm(c.nodeIds), 6);
      // Risk figures come from the shared edge conditions.
      let worstWeather = 0;
      for (let i = 0; i < c.nodeIds.length - 1; i++) {
        // Look the edge up through the graph rather than rebuilding its id from
        // the sorted node pair: ids are minted in LINKS declaration order, so a
        // sorted guess silently misses any edge declared the other way round and
        // quietly drops that leg's risk from the comparison.
        const edge = edgeBetween(c.nodeIds[i], c.nodeIds[i + 1]);
        const cond = edge ? conditions.get(edge.id) : undefined;
        if (cond) worstWeather = Math.max(worstWeather, cond.weatherRisk);
      }
      expect(c.weatherRisk).toBe(worstWeather);
      expect(c.travelMinutes).toBeGreaterThan(0);
    }
  });

  it("gives every candidate a drawable line that starts at the vessel", () => {
    const { state, vesselId } = worldWithCandidates();
    const vessel = state.vessels.find((v) => v.id === vesselId)!;
    const here: [number, number] = [vessel.track!.longitude, vessel.track!.latitude];

    for (const c of routeCandidates(state, vesselId)) {
      const line = [here, ...nodePathGeometry(c.nodeIds)];
      expect(line.length).toBeGreaterThan(1);
      // The drawn route must begin where the ship actually is (§6.5).
      expect(line[0]).toEqual(here);
      for (const [lon, lat] of line) {
        expect(Number.isFinite(lon) && Number.isFinite(lat)).toBe(true);
        expect(Math.abs(lat)).toBeLessThanOrEqual(90);
        expect(Math.abs(lon)).toBeLessThanOrEqual(180);
      }
    }
  });

  it("returns no summary for a vessel that has no geographic track", () => {
    // The 22 baseline Tuas vessels are selectable from Operations and from alert
    // links, and they have no track at all. Anything the map derives for a
    // selected vessel has to tolerate that rather than assume a position.
    let state = generateWorld(SEED);
    for (let i = 0; i < 20; i++) state = tick(state);
    const baseline = state.vessels.find((v) => v.scope === undefined)!;
    expect(baseline.track).toBeUndefined();
    expect(activeRouteSummary(state, baseline.id)).toBeNull();
    expect(routeCandidates(state, baseline.id)).toEqual([]);
  });
});
