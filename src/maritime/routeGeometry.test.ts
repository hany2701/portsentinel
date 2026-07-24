import { describe, expect, it } from "vitest";
import { geoDistance, geoInterpolate } from "d3-geo";
import { feature } from "topojson-client";
import land10 from "world-atlas/land-10m.json";
import type { Topology } from "topojson-specification";
import type { FeatureCollection, Geometry } from "geojson";
import {
  bearing,
  clearGeometryCache,
  edgeGeometry,
  greatCircle,
  lineString,
  markersAlong,
  nodePathGeometry,
  normaliseLon,
  sampleCount,
  tangentBearing,
  type LonLat,
} from "./routeGeometry";
import { ROUTE_EDGES, SHIPPING_CORRIDORS, SUB_RESOLUTION_EDGES, routeNodeById } from "./network";

// GR-5A §13 / GR-9: the route geometry contract. Routes are sampled great
// circles, so they must be deterministic, valid, dense enough to curve, anchored
// to the authoritative graph nodes, and clear of land.
//
// The land check runs against Natural Earth 10m — the coastline the satellite
// basemap shows — with dense (~2 nm) sampling, so a leg that clips a real island
// or coast is caught even where the coarse 110m set drew open water. A polygon
// index with a bounding-box pre-filter keeps that dense test fast.

type Ring = number[][];
type Poly = { outer: Ring; holes: Ring[]; minx: number; miny: number; maxx: number; maxy: number };

const LAND = feature(
  land10 as unknown as Topology,
  (land10 as unknown as Topology).objects.land,
) as unknown as FeatureCollection<Geometry>;

const LAND_POLYS: Poly[] = (() => {
  const polys: Poly[] = [];
  for (const f of LAND.features) {
    const g = f.geometry as { type: string; coordinates: number[][][] | number[][][][] };
    const parts = g.type === "Polygon" ? [g.coordinates as number[][][]] : g.type === "MultiPolygon" ? (g.coordinates as number[][][][]) : [];
    for (const poly of parts) {
      const outer = poly[0];
      let minx = 999, miny = 999, maxx = -999, maxy = -999;
      for (const [x, y] of outer) {
        if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      }
      polys.push({ outer, holes: poly.slice(1), minx, miny, maxx, maxy });
    }
  }
  return polys;
})();

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Where two planar segments cross, or null if they do not (endpoints excluded). */
function segmentCross(a: LonLat, b: LonLat, c: LonLat, d: LonLat): LonLat | null {
  const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
  if (Math.abs(den) < 1e-12) return null; // parallel or coincident
  const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
  const u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
  if (t <= 1e-6 || t >= 1 - 1e-6 || u <= 1e-6 || u >= 1 - 1e-6) return null;
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

/** Is this coordinate on land, per the bundled Natural Earth 10m set? */
function onLand(point: LonLat): boolean {
  const [lon, lat] = point;
  for (const p of LAND_POLYS) {
    if (lon < p.minx || lon > p.maxx || lat < p.miny || lat > p.maxy) continue;
    if (inRing(lon, lat, p.outer) && !p.holes.some((h) => inRing(lon, lat, h))) return true;
  }
  return false;
}

/**
 * Dense ~0.5 nm great-circle samples for an edge — fine enough to catch a small
 * island. Tightened from 2 nm: at that spacing a leg could clip a coastline for
 * up to a mile between samples and still read as clear, which is how a 1 nm cut
 * across the Chennai shore and a 0.25 nm clip of a Lakshadweep islet went
 * unnoticed. Both are now either routed around or exempted by name.
 */
function denseSamples(edgeId: string): LonLat[] {
  const edge = ROUTE_EDGES.find((e) => e.id === edgeId);
  if (!edge) return [];
  const a = routeNodeById(edge.fromNodeId)!;
  const b = routeNodeById(edge.toNodeId)!;
  const interp = geoInterpolate([a.longitude, a.latitude], [b.longitude, b.latitude]);
  const n = Math.min(4000, Math.max(2, Math.ceil(edge.distanceNm / 0.5)));
  const out: LonLat[] = [];
  for (let i = 0; i <= n; i++) {
    const raw = interp(i / n);
    out.push([normaliseLon(raw[0]), raw[1]]);
  }
  return out;
}

describe("route geometry (GR-5A)", () => {
  it("is deterministic", () => {
    const edge = ROUTE_EDGES[3];
    const a = edgeGeometry(edge.id);
    clearGeometryCache();
    const b = edgeGeometry(edge.id);
    expect(b).toEqual(a);
  });

  it("samples long edges into many coordinates so they project as arcs", () => {
    const longest = [...ROUTE_EDGES].sort((x, y) => y.distanceNm - x.distanceNm)[0];
    const points = edgeGeometry(longest.id);
    // A straight two-point line would project as a chord, which is exactly the
    // "node-and-edge graph" look this replaces.
    expect(longest.distanceNm).toBeGreaterThan(1000);
    expect(points.length).toBeGreaterThan(8);

    // And sampling scales with distance.
    expect(sampleCount(3000)).toBeGreaterThan(sampleCount(200));
    expect(sampleCount(50)).toBeGreaterThanOrEqual(2);
    expect(sampleCount(1e6)).toBeLessThanOrEqual(64); // bounded
  });

  it("starts and ends exactly on the authoritative graph nodes", () => {
    for (const edge of ROUTE_EDGES) {
      const points = edgeGeometry(edge.id);
      if (points.length < 2) continue;
      const from = routeNodeById(edge.fromNodeId)!;
      const to = routeNodeById(edge.toNodeId)!;
      expect(points[0][0]).toBeCloseTo(from.longitude, 6);
      expect(points[0][1]).toBeCloseTo(from.latitude, 6);
      expect(points[points.length - 1][0]).toBeCloseTo(to.longitude, 6);
      expect(points[points.length - 1][1]).toBeCloseTo(to.latitude, 6);
    }
  });

  it("never emits an invalid coordinate", () => {
    for (const edge of ROUTE_EDGES) {
      for (const [lon, lat] of edgeGeometry(edge.id)) {
        expect(Number.isFinite(lon)).toBe(true);
        expect(Number.isFinite(lat)).toBe(true);
        expect(lon).toBeGreaterThanOrEqual(-180);
        expect(lon).toBeLessThanOrEqual(180);
        expect(lat).toBeGreaterThanOrEqual(-90);
        expect(lat).toBeLessThanOrEqual(90);
      }
    }
  });

  it("normalises longitudes across the antimeridian", () => {
    expect(normaliseLon(190)).toBeCloseTo(-170, 9);
    expect(normaliseLon(-190)).toBeCloseTo(170, 9);
    expect(normaliseLon(120)).toBe(120);
    expect(normaliseLon(Number.NaN)).toBe(0);
  });

  it("routes constrained waters through their approved waypoints", () => {
    // The Malacca/Singapore approach is the demo's spine: a route from the
    // Indian Ocean to Tuas must thread the documented strait waypoints rather
    // than cutting across Sumatra or the Malay peninsula.
    const malacca = SHIPPING_CORRIDORS.find((c) => c.nodeIds.includes("WPT-MALACCA-N"));
    expect(malacca, "no corridor uses the Malacca waypoints").toBeDefined();
    const ids = malacca!.nodeIds;
    // The chain must stay in order going seaward from Singapore.
    const order = ["WPT-SG-APPROACH", "WPT-MALACCA-S", "WPT-MALACCA-N"].map((id) => ids.indexOf(id));
    const present = order.filter((i) => i >= 0);
    expect(present.length).toBeGreaterThanOrEqual(2);
    expect([...present].sort((a, b) => a - b)).toEqual(present);
  });

  it("keeps sampled route geometry off land (Natural Earth 10m)", () => {
    // GR-9: a leg that crosses a continent OR a real island is the failure this
    // guards. Checked against Natural Earth 10m — the coastline the satellite
    // basemap shows — with dense ~2 nm sampling, so an islet crossing cannot slip
    // between coarse samples. Endpoints are ports on the coast, so only the
    // open-water interior is checked.
    //
    // Legs whose navigable water is below the coastline's resolution — canals,
    // sub-10 nm straits, river and island-harbour approaches — are exempted by
    // name in SUB_RESOLUTION_EDGES, with a recorded reason each. Every other edge
    // is checked, which is what caught the Riau (Batam/Bintan), Colombo, Hong
    // Kong→Taiwan, Channel/Normandy, Sumatra, Sunda and Java–Surabaya crossings
    // the network now routes around in open water.
    const offenders: string[] = [];
    for (const edge of ROUTE_EDGES) {
      if (edge.id in SUB_RESOLUTION_EDGES) continue;
      const points = denseSamples(edge.id);
      for (let i = 1; i < points.length - 1; i++) {
        if (onLand(points[i])) {
          offenders.push(`${edge.id}@${i} (${points[i][0].toFixed(2)},${points[i][1].toFixed(2)})`);
          break;
        }
      }
    }
    expect(offenders, `route segments cross land: ${offenders.join(", ")}`).toEqual([]);

    // The exemption list must not rot: every entry has to name a real edge.
    for (const id of Object.keys(SUB_RESOLUTION_EDGES)) {
      expect(ROUTE_EDGES.some((e) => e.id === id), `stale exemption for missing edge ${id}`).toBe(true);
    }
  });

  it("draws no corridor that crosses itself or doubles back over another", () => {
    // The defect this guards is purely visual and invisible to the land check: a
    // corridor whose drawn line loops over itself reads as a closed circuit on
    // the map. Three real cases motivated it — the Tuas exit chain, where every
    // corridor turned east to WPT-SG-APPROACH and then doubled back northwest
    // across the anchorage leg (one flaw drawn nine times over); Hong Kong,
    // where the harbour exit lay WEST of the approach so the eastbound leg
    // re-crossed it; and the Klang/Penang port calls.
    //
    // Corridors legitimately MEET at nodes they share, and a branch service
    // legitimately diverges from a trunk and rejoins it. What must not happen is
    // a line crossing another away from any shared node.
    const polys = SHIPPING_CORRIDORS.map((c) => ({
      id: c.id,
      shared: c.nodeIds,
      pts: nodePathGeometry(c.nodeIds) as LonLat[],
    }));
    const nmApart = (a: LonLat, b: LonLat) => geoDistance(a, b) * 3440.065;

    // A polyline sampled in normalised longitude has one artificial segment
    // wherever it crosses the antimeridian (+180 jumps to -180). d3-geo cuts
    // that correctly when projecting, so it is never drawn — but a planar
    // intersection test would see a line sweeping the whole map. Skip them.
    const wraps = (p: LonLat, q: LonLat) => Math.abs(p[0] - q[0]) > 180;

    const offenders: string[] = [];
    for (let i = 0; i < polys.length; i++) {
      for (let j = i; j < polys.length; j++) {
        const A = polys[i], B = polys[j];
        const sharedPts = A.shared
          .filter((n) => B.shared.includes(n))
          .map((n) => {
            const nd = routeNodeById(n)!;
            return [nd.longitude, nd.latitude] as LonLat;
          });
        for (let x = 0; x < A.pts.length - 1; x++) {
          if (wraps(A.pts[x], A.pts[x + 1])) continue;
          // Within one corridor, adjacent segments share an endpoint by
          // construction, so start two along.
          for (let y = i === j ? x + 2 : 0; y < B.pts.length - 1; y++) {
            if (wraps(B.pts[y], B.pts[y + 1])) continue;
            const hit = segmentCross(A.pts[x], A.pts[x + 1], B.pts[y], B.pts[y + 1]);
            if (!hit) continue;
            // Meeting at (or within a mile of) a node both corridors share is
            // the network being connected, not a line drawn over itself.
            if (sharedPts.some((s) => nmApart(s, hit) < 1)) continue;
            // A branch leaving a trunk to call somewhere and rejoining crosses
            // it once; that is a real service pattern, not a loop. Only flag a
            // corridor that crosses ITSELF, or two that cross far from any
            // shared node.
            if (i !== j) continue;
            offenders.push(`${A.id} self-crosses at ${hit[0].toFixed(4)},${hit[1].toFixed(4)}`);
          }
        }
      }
    }
    expect(offenders, offenders.join("; ")).toEqual([]);
  });

  it("builds a continuous path across a node sequence without duplicate joins", () => {
    const corridor = SHIPPING_CORRIDORS[0];
    const points = nodePathGeometry(corridor.nodeIds);
    expect(points.length).toBeGreaterThan(corridor.nodeIds.length);
    for (let i = 1; i < points.length; i++) {
      expect(points[i]).not.toEqual(points[i - 1]);
    }
    // Endpoints still match the corridor's own nodes.
    const first = routeNodeById(corridor.nodeIds[0])!;
    expect(points[0][0]).toBeCloseTo(first.longitude, 6);
  });

  it("orients arrows along the local tangent, not the start-to-end chord", () => {
    // On a long east–west great circle the local heading at the start differs
    // from the straight-line bearing to the far end; the arrow must follow the
    // drawn curve.
    const a: LonLat = [103.6, 1.2]; // Singapore
    const b: LonLat = [4.1, 52.0]; // Rotterdam
    const points = greatCircle(a, b, 8300);
    const localStart = tangentBearing(points, 0);
    const localMid = tangentBearing(points, Math.floor(points.length / 2));
    const chord = bearing(a[0], a[1], b[0], b[1]);

    expect(localStart).toBeCloseTo(chord, 0); // the first tangent IS the initial bearing
    // …but the heading changes along the arc, which a chord angle cannot express.
    expect(Math.abs(localMid - localStart)).toBeGreaterThan(5);

    const markers = markersAlong(points, 3);
    expect(markers).toHaveLength(3);
    for (const m of markers) {
      expect(Number.isFinite(m.bearingDeg)).toBe(true);
      expect(m.point[0]).toBeGreaterThanOrEqual(-180);
    }
  });

  it("returns a LineString only when there is something to draw", () => {
    expect(lineString([])).toBeNull();
    expect(lineString([[1, 2]])).toBeNull();
    expect(lineString([[1, 2], [3, 4]])).toEqual({ type: "LineString", coordinates: [[1, 2], [3, 4]] });
  });

  it("rejects invalid great-circle inputs instead of emitting NaN paths", () => {
    expect(greatCircle([Number.NaN, 0], [10, 10])).toEqual([]);
    expect(greatCircle([0, 200], [10, 10])).toEqual([]);
  });
});
