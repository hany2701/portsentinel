import { describe, expect, it } from "vitest";
import { generateWorld, assertInvariants } from "../sim";
import { VESSEL_COUNT } from "../sim/config";
import {
  DEEPSEA_VESSEL_COUNT,
  REGIONAL_VESSEL_COUNT,
  TUAS_BOUND_TRACKED_MAX,
} from "./config";
import { clusterCellDeg, clusterVessels } from "./clustering";
import { isConnectedSequence } from "./graph";
import { inSingaporeApproach } from "./geofence";
import { routeNodeById } from "./network";
import {
  activePlanFor,
  edgeConditions,
  globalKpis,
  planPolyline,
  regionalVessels,
  remainingPolyline,
  trackedVessels,
  tuasBaselineVessels,
  weatherSpeedFactor,
} from "./selectors";

const SEED = 20260710;
const TOTAL = VESSEL_COUNT + REGIONAL_VESSEL_COUNT + DEEPSEA_VESSEL_COUNT;

describe("inter-port lanes carry real origins in both directions", () => {
  const sim = generateWorld(SEED);
  const onLane = (id: string) => sim.vessels.filter((v) => v.serviceId === id && v.track);

  it("sails each inter-port lane in both directions", () => {
    // The network used to be a star: every corridor began at Tuas and every
    // tracked vessel pointed outward from it, so no ship ever sailed between two
    // other ports. These lanes are what make Hong Kong -> Los Angeles (and back)
    // an actual voyage rather than two unrelated spokes.
    for (const serviceId of ["SVC-TPX", "SVC-SGN"]) {
      const vessels = onLane(serviceId);
      expect(vessels.length, `${serviceId} has no vessels`).toBeGreaterThan(1);
      const pairs = new Set(
        vessels.map((v) => `${v.homePortId}>${v.destinationPortId}`),
      );
      expect(pairs.size, `${serviceId} only runs one way: ${[...pairs]}`).toBeGreaterThan(1);
      // Each direction is the reverse of the other, not two unrelated routes.
      const [a, b] = [...pairs].map((p) => p.split(">"));
      expect(a[0]).toBe(b[1]);
      expect(a[1]).toBe(b[0]);
    }
  });

  it("gives inter-port vessels a real origin port and never routes them via Tuas", () => {
    for (const serviceId of ["SVC-TPX", "SVC-SGN"]) {
      for (const v of onLane(serviceId)) {
        expect(v.homePortId, `${v.id} has no origin port`).toBeDefined();
        expect(v.homePortId!.startsWith("PORT-")).toBe(true);
        expect(v.destinationPortId).toBeDefined();
        expect(v.homePortId).not.toBe("PORT-TUAS");
        expect(v.destinationPortId).not.toBe("PORT-TUAS");
        const plan = activePlanFor(sim, v.id);
        expect(plan!.nodeIds).not.toContain("PORT-TUAS");
      }
    }
  });

  it("puts ships to sea from Hong Kong, Los Angeles and Ho Chi Minh City", () => {
    const origins = new Set(sim.vessels.filter((v) => v.track).map((v) => v.homePortId));
    for (const port of ["PORT-HONGKONG", "PORT-LONGBEACH", "PORT-HCMC"]) {
      expect(origins.has(port), `no vessel originates at ${port}`).toBe(true);
    }
  });
});

describe("tracked vessel population (GR-2)", () => {
  const sim = generateWorld(SEED);

  it("seeds one authoritative population of 130 unique vessels", () => {
    expect(sim.vessels).toHaveLength(TOTAL);
    expect(TOTAL).toBe(130);
    const ids = sim.vessels.map((v) => v.id);
    expect(new Set(ids).size, "vessel ids are not unique").toBe(ids.length);
  });

  it("leaves the 22-vessel Tuas baseline untouched and unscoped", () => {
    expect(tuasBaselineVessels(sim)).toHaveLength(VESSEL_COUNT);
    for (const v of tuasBaselineVessels(sim)) {
      expect(v.scope).toBeUndefined();
      expect(v.track).toBeUndefined();
      expect(v.status).not.toBe("enroute");
    }
  });

  it("splits the tracked population into the configured scopes", () => {
    const tracked = trackedVessels(sim);
    expect(tracked).toHaveLength(REGIONAL_VESSEL_COUNT + DEEPSEA_VESSEL_COUNT);
    expect(tracked.filter((v) => v.scope === "regional")).toHaveLength(REGIONAL_VESSEL_COUNT);
    expect(tracked.filter((v) => v.scope === "deepSea")).toHaveLength(DEEPSEA_VESSEL_COUNT);
    for (const v of tracked) {
      expect(v.status).toBe("enroute");
      expect(v.berthId).toBeUndefined();
      expect(v.track).toBeDefined();
    }
  });

  it("gives every tracked vessel exactly one active, connected route plan", () => {
    for (const v of trackedVessels(sim)) {
      const plan = activePlanFor(sim, v.id);
      expect(plan, `${v.id} has no active plan`).toBeDefined();
      expect(plan!.id).toBe(v.track!.routePlanId);
      expect(plan!.routeVersion).toBe(1);
      expect(isConnectedSequence(plan!.nodeIds), `${v.id} plan is not connected`).toBe(true);
      expect(plan!.totalDistanceNm).toBeGreaterThan(0);
      expect(v.track!.edgeIndex).toBeLessThan(plan!.nodeIds.length - 1);
      expect(v.track!.progressNm).toBeGreaterThanOrEqual(0);
    }
    expect(sim.maritime.routePlans).toHaveLength(trackedVessels(sim).length);
  });

  it("caps the vessels that will enter the Tuas FSM", () => {
    const tuasBound = trackedVessels(sim).filter((v) => v.destinationPortId === "PORT-TUAS");
    expect(tuasBound.length).toBeLessThanOrEqual(TUAS_BOUND_TRACKED_MAX);
    expect(tuasBound.length).toBe(TUAS_BOUND_TRACKED_MAX);
    // Tuas-active can therefore reach 22 + 3 = 25 and no more.
    expect(VESSEL_COUNT + tuasBound.length).toBe(25);
  });

  it("keeps every other tracked vessel out of the Tuas approach fence", () => {
    for (const v of trackedVessels(sim)) {
      if (v.destinationPortId === "PORT-TUAS") continue;
      const plan = activePlanFor(sim, v.id)!;
      for (const nodeId of plan.nodeIds) {
        const node = routeNodeById(nodeId)!;
        expect(
          inSingaporeApproach(node),
          `${v.id} routes through ${nodeId}, inside the handover fence`,
        ).toBe(false);
      }
    }
  });

  it("only carries cargo on vessels that will actually call at Tuas", () => {
    for (const v of trackedVessels(sim)) {
      if (v.destinationPortId === "PORT-TUAS") expect(v.manifest.length).toBeGreaterThan(0);
      else expect(v.manifest).toHaveLength(0);
    }
  });

  it("places every tracked vessel at a valid position", () => {
    for (const v of trackedVessels(sim)) {
      const t = v.track!;
      expect(t.latitude).toBeGreaterThanOrEqual(-90);
      expect(t.latitude).toBeLessThanOrEqual(90);
      expect(t.longitude).toBeGreaterThanOrEqual(-180);
      expect(t.longitude).toBeLessThanOrEqual(180);
      expect(t.speedKnots).toBeGreaterThan(0);
      expect(t.courseDeg).toBeGreaterThanOrEqual(0);
      expect(t.courseDeg).toBeLessThan(360);
    }
  });

  it("is deterministic from the seed", () => {
    const a = generateWorld(SEED);
    const b = generateWorld(SEED);
    expect(a.maritime).toEqual(b.maritime);
    expect(a.vessels).toEqual(b.vessels);
    expect(generateWorld(SEED + 1).maritime).not.toEqual(a.maritime);
  });

  it("satisfies the engine invariants at genesis", () => {
    expect(() => assertInvariants(sim)).not.toThrow();
  });
});

describe("multi-resolution derivation (GR-2)", () => {
  const sim = generateWorld(SEED);

  it("derives regional vessels from position, not from trade scope", () => {
    const regional = regionalVessels(sim);
    expect(regional.length).toBeGreaterThan(0);
    expect(regional.length).toBeLessThanOrEqual(trackedVessels(sim).length);
    // Position-based, so the set is not simply the regional-scope vessels.
    for (const v of regional) {
      expect(v.track!.latitude).toBeGreaterThanOrEqual(-9);
      expect(v.track!.latitude).toBeLessThanOrEqual(16);
      expect(v.track!.longitude).toBeGreaterThanOrEqual(94);
      expect(v.track!.longitude).toBeLessThanOrEqual(122);
    }
  });

  it("clusters vessels without inventing or losing any", () => {
    const items = trackedVessels(sim).map((v) => ({
      id: v.id,
      latitude: v.track!.latitude,
      longitude: v.track!.longitude,
    }));
    for (const zoom of [1, 2.5, 3.5, 6]) {
      const clusters = clusterVessels(items, clusterCellDeg(zoom));
      const counted = clusters.reduce((s, c) => s + c.count, 0);
      expect(counted, `zoom ${zoom} cluster counts do not sum to the population`).toBe(items.length);
      const members = clusters.flatMap((c) => c.memberIds);
      expect(new Set(members).size).toBe(items.length);
    }
  });

  it("clusters more coarsely as the map zooms out", () => {
    const items = trackedVessels(sim).map((v) => ({
      id: v.id,
      latitude: v.track!.latitude,
      longitude: v.track!.longitude,
    }));
    const world = clusterVessels(items, clusterCellDeg(1)).length;
    const closer = clusterVessels(items, clusterCellDeg(6)).length;
    expect(world).toBeLessThanOrEqual(closer);
  });

  it("is deterministic and rejects a non-positive cell size", () => {
    const items = [{ id: "a", latitude: 1, longitude: 2 }, { id: "b", latitude: 1.1, longitude: 2.1 }];
    expect(clusterVessels(items, 5)).toEqual(clusterVessels(items, 5));
    expect(() => clusterVessels(items, 0)).toThrow();
  });

  it("draws a route line that starts at the vessel's actual position", () => {
    const v = trackedVessels(sim)[0];
    const line = remainingPolyline(sim, v);
    expect(line[0]).toEqual([v.track!.longitude, v.track!.latitude]);
    expect(line.length).toBeGreaterThan(1);
    expect(planPolyline(activePlanFor(sim, v.id)!).length).toBe(
      activePlanFor(sim, v.id)!.nodeIds.length,
    );
  });

  it("derives edge conditions for the whole network", () => {
    const conditions = edgeConditions(sim);
    for (const [, c] of conditions) {
      expect(c.weatherRisk).toBeGreaterThanOrEqual(0);
      expect(c.weatherRisk).toBeLessThanOrEqual(100);
      expect(c.congestionRisk).toBeGreaterThanOrEqual(0);
      expect(c.congestionRisk).toBeLessThanOrEqual(100);
    }
    // Calm genesis weather blocks nothing.
    expect([...conditions.values()].every((c) => !c.blocked)).toBe(true);
  });

  it("slows vessels by weather band and stops them when blocked", () => {
    expect(weatherSpeedFactor(0)).toBe(1);
    expect(weatherSpeedFactor(50)).toBeLessThan(1);
    expect(weatherSpeedFactor(70)).toBeLessThan(weatherSpeedFactor(50));
    expect(weatherSpeedFactor(90)).toBe(0);
  });

  it("reports global KPIs from the authoritative entities", () => {
    const kpis = globalKpis(sim);
    expect(kpis.activeVessels).toBe(trackedVessels(sim).length);
    expect(kpis.reroutesPending).toBe(0);
    expect(kpis.reroutesExecuted).toBe(0);
    expect(kpis.averageDelayAvoidedMinutes).toBe(0);
  });
});
