import { describe, expect, it } from "vitest";
import { geoContains, geoDistance } from "d3-geo";
import { feature } from "topojson-client";
import land110 from "world-atlas/land-110m.json";
import type { Topology } from "topojson-specification";
import type { FeatureCollection, Geometry } from "geojson";
import { generateWorld, tick } from "../sim";
import { EARTH_RADIUS_NM } from "./config";
import { activePlanFor, trackedVessels } from "./selectors";
import { nodePathGeometry } from "./routeGeometry";
import { clusterCellDeg, clusterVessels } from "./clustering";
import { TRAIL_LENGTH, advanceTrails, drawableTrails } from "./trails";
import { SUB_RESOLUTION_EDGES, routeNodeById } from "./network";
import { edgeBetween } from "./graph";
import { nmPerTick } from "./config";
import type { SimState, Vessel } from "../sim";

// GR-5A §13: the vessel-placement contract. Placement must be seeded,
// reproducible, corridor-constrained and operationally plausible — never
// independent lat/lon draws, never Math.random.

const SEED = 20260710;
const LAND = feature(
  land110 as unknown as Topology,
  (land110 as unknown as Topology).objects.land,
) as unknown as FeatureCollection<Geometry>;

function onLand(lon: number, lat: number): boolean {
  return LAND.features.some((f) => geoContains(f, [lon, lat]));
}

function nmBetween(a: [number, number], b: [number, number]): number {
  return geoDistance(a, b) * EARTH_RADIUS_NM;
}

/** Shortest distance from a point to a sampled path, in nautical miles. */
function distanceToPathNm(point: [number, number], path: [number, number][]): number {
  let best = Infinity;
  for (const p of path) best = Math.min(best, nmBetween(point, p));
  return best;
}

describe("strategic vessel placement (GR-5A)", () => {
  it("is reproducible from the seed", () => {
    const a = generateWorld(SEED);
    const b = generateWorld(SEED);
    expect(trackedVessels(b).map((v) => v.track)).toEqual(trackedVessels(a).map((v) => v.track));
  });

  it("produces a different but still valid layout from a different seed", () => {
    const a = generateWorld(SEED);
    const b = generateWorld(SEED + 1);
    const posA = trackedVessels(a).map((v) => `${v.track!.latitude},${v.track!.longitude}`);
    const posB = trackedVessels(b).map((v) => `${v.track!.latitude},${v.track!.longitude}`);
    expect(posB).not.toEqual(posA);
    // Still the same population, and still on valid routes.
    expect(posB).toHaveLength(posA.length);
    for (const v of trackedVessels(b)) {
      expect(Number.isFinite(v.track!.latitude)).toBe(true);
      expect(activePlanFor(b, v.id)).toBeDefined();
    }
  });

  it("places every vessel on its own assigned route", () => {
    const state = generateWorld(SEED);
    for (const v of trackedVessels(state)) {
      const plan = activePlanFor(state, v.id)!;
      const path = nodePathGeometry(plan.nodeIds);
      const distance = distanceToPathNm([v.track!.longitude, v.track!.latitude], path);
      // Within one sampling interval of the drawn route — i.e. on the line.
      expect(distance, `${v.id} sits ${distance.toFixed(0)} nm off its route`).toBeLessThan(70);
    }
  });

  it("never starts a vessel on land", () => {
    const state = generateWorld(SEED);
    // A vessel sailing a canal, a sub-10 nm strait or a river approach reads as
    // "on land" against the 110m coastline — the same resolution limit the
    // route-geometry check documents. Those legs are skipped by name; every
    // other position must be genuinely at sea.
    const offenders = trackedVessels(state)
      .filter((v) => {
        const plan = activePlanFor(state, v.id);
        if (!plan) return true;
        const edge = edgeBetween(plan.nodeIds[v.track!.edgeIndex], plan.nodeIds[v.track!.edgeIndex + 1]);
        if (edge && edge.id in SUB_RESOLUTION_EDGES) return false;
        return onLand(v.track!.longitude, v.track!.latitude);
      })
      .map((v) => `${v.id} (${v.track!.longitude.toFixed(1)},${v.track!.latitude.toFixed(1)})`);
    expect(offenders, `vessels seeded on land: ${offenders.join(", ")}`).toEqual([]);
  });

  it("gives no two vessels identical coordinates", () => {
    const state = generateWorld(SEED);
    const keys = trackedVessels(state).map((v) => `${v.track!.latitude.toFixed(6)},${v.track!.longitude.toFixed(6)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("respects minimum separation between vessels sharing a route leg", () => {
    const state = generateWorld(SEED);
    // Group by (route, edge) and check the spacing inside each group.
    const byLeg = new Map<string, Vessel[]>();
    for (const v of trackedVessels(state)) {
      const plan = activePlanFor(state, v.id);
      if (!plan) continue;
      const key = `${plan.nodeIds.join(">")}#${v.track!.edgeIndex}`;
      byLeg.set(key, [...(byLeg.get(key) ?? []), v]);
    }
    for (const [key, group] of byLeg) {
      if (group.length < 2) continue;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const d = nmBetween(
            [group[i].track!.longitude, group[i].track!.latitude],
            [group[j].track!.longitude, group[j].track!.latitude],
          );
          expect(d, `${group[i].id}/${group[j].id} only ${d.toFixed(1)} nm apart on ${key}`).toBeGreaterThan(1);
        }
      }
    }
  });

  it("starts the three Tuas-bound vessels at different journey stages", () => {
    const state = generateWorld(SEED);
    const inbound = trackedVessels(state).filter((v) => v.destinationPortId === "PORT-TUAS");
    expect(inbound.length).toBeGreaterThan(0);
    expect(inbound.length).toBeLessThanOrEqual(3);

    // Remaining distance to Tuas must differ markedly — they must not all be
    // sitting outside Singapore at tick 0.
    const remaining = inbound.map((v) => {
      const plan = activePlanFor(state, v.id)!;
      const dest = routeNodeById(plan.destinationNodeId)!;
      return nmBetween([v.track!.longitude, v.track!.latitude], [dest.longitude, dest.latitude]);
    });
    if (remaining.length >= 2) {
      const spread = Math.max(...remaining) - Math.min(...remaining);
      expect(spread, `Tuas-bound vessels bunched: ${remaining.map((r) => r.toFixed(0)).join(", ")} nm`).toBeGreaterThan(200);
    }
  });

  it("keeps heading, progress, remaining distance and ETA mutually consistent", () => {
    const state = generateWorld(SEED);
    for (const v of trackedVessels(state)) {
      const plan = activePlanFor(state, v.id)!;
      const track = v.track!;
      expect(track.courseDeg).toBeGreaterThanOrEqual(0);
      expect(track.courseDeg).toBeLessThan(360);
      expect(track.progressNm).toBeGreaterThanOrEqual(0);
      expect(track.edgeIndex).toBeLessThan(plan.nodeIds.length - 1);
      expect(track.speedKnots).toBeGreaterThan(0);

      // ETA must be reachable at the vessel's own speed from where it actually is.
      const dest = routeNodeById(plan.destinationNodeId)!;
      const remainingNm = nmBetween([track.longitude, track.latitude], [dest.longitude, dest.latitude]);
      const ticksNeeded = remainingNm / nmPerTick(track.speedKnots);
      const ticksClaimed = plan.etaTick - state.clock.tick;
      expect(ticksClaimed).toBeGreaterThanOrEqual(0);
      // Route distance ≥ straight-line distance, so the claim can exceed the
      // direct estimate but must not undercut it.
      expect(ticksClaimed, `${v.id} ETA is sooner than physically reachable`).toBeGreaterThanOrEqual(
        Math.floor(ticksNeeded) - 1,
      );
    }
  });

  it("spreads deep-sea vessels across corridors rather than stacking them", () => {
    const state = generateWorld(SEED);
    const deepSea = trackedVessels(state).filter((v) => v.scope === "deepSea");
    const corridors = new Set(deepSea.map((v) => activePlanFor(state, v.id)!.nodeIds.join(">")));
    expect(corridors.size).toBeGreaterThan(3);

    // And along each corridor, not clumped in one stretch.
    const byCorridor = new Map<string, number[]>();
    for (const v of deepSea) {
      const plan = activePlanFor(state, v.id)!;
      const key = plan.nodeIds.join(">");
      byCorridor.set(key, [...(byCorridor.get(key) ?? []), v.track!.edgeIndex]);
    }
    const multi = [...byCorridor.values()].filter((idx) => idx.length >= 4);
    expect(multi.length).toBeGreaterThan(0);
    for (const indices of multi) {
      expect(new Set(indices).size, "all vessels on one corridor share an edge").toBeGreaterThan(1);
    }
  });
});

describe("cluster and trail presentation (GR-5A)", () => {
  it("always sums cluster counts back to the tracked population", () => {
    const state = generateWorld(SEED);
    const tracked = trackedVessels(state);
    const points = tracked.map((v) => ({
      id: v.id,
      latitude: v.track!.latitude,
      longitude: v.track!.longitude,
    }));
    for (const zoom of [0.8, 1.4, 2, 3, 3.9]) {
      const clusters = clusterVessels(points, clusterCellDeg(zoom));
      const total = clusters.reduce((s, c) => s + c.count, 0);
      expect(total, `cluster total drifted at zoom ${zoom}`).toBe(tracked.length);
    }
  });

  it("bounds trail history", () => {
    let state = generateWorld(SEED);
    const ids = trackedVessels(state).slice(0, 5).map((v) => v.id);
    let trails = new Map<string, [number, number][]>();
    for (let i = 0; i < TRAIL_LENGTH * 4; i++) {
      state = tick(state);
      trails = advanceTrails(trails, state, ids);
    }
    for (const [id, points] of trails) {
      expect(points.length, `${id} trail grew past its bound`).toBeLessThanOrEqual(TRAIL_LENGTH);
    }
    expect(drawableTrails(trails).size).toBeGreaterThan(0);
  });

  it("keeps trails out of simulation state", () => {
    let state = generateWorld(SEED);
    const ids = trackedVessels(state).map((v) => v.id);
    let trails = new Map<string, [number, number][]>();
    const before = structuredClone(state);
    for (let i = 0; i < 5; i++) trails = advanceTrails(trails, state, ids);
    expect(state).toEqual(before);
    expect(JSON.stringify(state)).not.toContain("trail");
  });

  it("follows real simulated movement, not a decorative curve", () => {
    let state = generateWorld(SEED);
    const vessel = trackedVessels(state).find((v) => v.status === "enroute")!;
    let trails = new Map<string, [number, number][]>();
    const seen: Array<[number, number]> = [];
    for (let i = 0; i < 6; i++) {
      state = tick(state);
      const v = state.vessels.find((x) => x.id === vessel.id)!;
      if (v.track) seen.push([v.track.longitude, v.track.latitude]);
      trails = advanceTrails(trails, state, [vessel.id]);
    }
    // Every trail point is a position the vessel actually occupied.
    for (const point of trails.get(vessel.id) ?? []) {
      expect(seen.some((s) => s[0] === point[0] && s[1] === point[1])).toBe(true);
    }
  });

  it("does not move canonical coordinates when rendering", () => {
    // Marker presentation must never write back to the vessel's position.
    const state = generateWorld(SEED);
    const canonical = trackedVessels(state).map((v) => [v.track!.longitude, v.track!.latitude] as [number, number]);
    const points = trackedVessels(state).map((v) => ({
      id: v.id,
      latitude: v.track!.latitude,
      longitude: v.track!.longitude,
    }));
    clusterVessels(points, clusterCellDeg(1));
    advanceTrails(new Map(), state, trackedVessels(state).map((v) => v.id));
    expect(trackedVessels(state).map((v) => [v.track!.longitude, v.track!.latitude])).toEqual(canonical);
  });
});

describe("Tuas baseline is untouched by the visual pass (GR-5A)", () => {
  it("keeps the 22 baseline vessels and the genesis fingerprint intact", () => {
    const state: SimState = generateWorld(SEED);
    const baseline = state.vessels.filter((v) => v.scope === undefined);
    expect(baseline).toHaveLength(22);
    // No baseline vessel gained maritime tracking state.
    for (const v of baseline) {
      expect(v.track).toBeUndefined();
      expect(v.destinationPortId).toBeUndefined();
    }
    // The dedicated fingerprint test owns the full genesis assertion; this is
    // the cheap guard that the visual pass did not disturb it.
    expect(state.berths).toHaveLength(12);
    expect(state.yardBlocks).toHaveLength(8);
  });
});
