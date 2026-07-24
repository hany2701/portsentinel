import { geoInterpolate } from "d3-geo";
import { ROUTE_EDGES, routeNodeById, type RouteEdge } from "./network";
import { edgeBetween } from "./graph";

// GR-5A: geographic route geometry.
//
// The route graph is authoritative for ROUTING; this module is authoritative for
// how a route LOOKS. A straight screen-space line between two projected nodes is
// wrong on a Mercator map — a Singapore→Rotterdam leg is a great circle, and
// drawing it as one segment makes the network read as a node-and-edge graph
// rather than a shipping chart.
//
// So every edge is sampled in GEOGRAPHIC space with geoInterpolate and handed to
// geoPath as a LineString: the projection then bends it correctly, and the same
// coordinates drive arrowheads, so direction always follows the local tangent.
//
// Sampling is distance-aware and the results are cached: the static graph never
// changes, so an edge's geometry is computed once per session, never per tick.

export type LonLat = [number, number];

/** Great-circle sampling density. Long legs get more points, short ones stay cheap. */
const NM_PER_SAMPLE = 120;
const MIN_SAMPLES = 2;
const MAX_SAMPLES = 64;

export function sampleCount(distanceNm: number): number {
  const wanted = Math.ceil(distanceNm / NM_PER_SAMPLE) + 1;
  return Math.min(MAX_SAMPLES, Math.max(MIN_SAMPLES, wanted));
}

function isValid(p: LonLat): boolean {
  return (
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1]) &&
    p[0] >= -180 &&
    p[0] <= 180 &&
    p[1] >= -90 &&
    p[1] <= 90
  );
}

/**
 * Sample one edge as a great-circle arc in geographic coordinates.
 * Deterministic: same edge in, same coordinates out, every time.
 */
function sampleEdge(edge: RouteEdge): LonLat[] {
  const from = routeNodeById(edge.fromNodeId);
  const to = routeNodeById(edge.toNodeId);
  if (!from || !to) return [];

  const a: LonLat = [from.longitude, from.latitude];
  const b: LonLat = [to.longitude, to.latitude];
  const interpolate = geoInterpolate(a, b);
  const n = sampleCount(edge.distanceNm);

  const points: LonLat[] = [];
  for (let i = 0; i <= n; i++) {
    const raw = interpolate(i / n);
    // geoInterpolate can return a longitude a hair outside ±180 at the seam;
    // normalise so the projection clips cleanly instead of drawing a world-wide
    // horizontal streak.
    const point: LonLat = [normaliseLon(raw[0]), raw[1]];
    if (isValid(point)) points.push(point);
  }
  return points;
}

export function normaliseLon(lon: number): number {
  if (!Number.isFinite(lon)) return 0;
  let x = lon;
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
}

// Static graph ⇒ compute once, reuse forever. Keyed by edge id.
const edgeCache = new Map<string, LonLat[]>();

export function edgeGeometry(edgeId: string): LonLat[] {
  const cached = edgeCache.get(edgeId);
  if (cached) return cached;
  const edge = ROUTE_EDGES.find((e) => e.id === edgeId);
  const points = edge ? sampleEdge(edge) : [];
  edgeCache.set(edgeId, points);
  return points;
}

/**
 * The full geographic path through a node sequence. Consecutive duplicate points
 * at each edge join are dropped so the LineString stays clean.
 */
export function nodePathGeometry(nodeIds: readonly string[]): LonLat[] {
  const out: LonLat[] = [];
  for (let i = 0; i < nodeIds.length - 1; i++) {
    const edge = edgeBetween(nodeIds[i], nodeIds[i + 1]);
    // Nodes that are not edge-connected (a temporary join, say) still deserve a
    // line: fall back to a direct great-circle between them.
    const points = edge ? geometryForEdgeInDirection(edge, nodeIds[i]) : directGeometry(nodeIds[i], nodeIds[i + 1]);
    for (const p of points) {
      const last = out[out.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
    }
  }
  return out;
}

/** Edges are undirected; return the samples running the way the vessel travels. */
function geometryForEdgeInDirection(edge: RouteEdge, fromNodeId: string): LonLat[] {
  const points = edgeGeometry(edge.id);
  return edge.fromNodeId === fromNodeId ? points : [...points].reverse();
}

function directGeometry(fromNodeId: string, toNodeId: string): LonLat[] {
  const from = routeNodeById(fromNodeId);
  const to = routeNodeById(toNodeId);
  if (!from || !to) return [];
  return greatCircle([from.longitude, from.latitude], [to.longitude, to.latitude]);
}

/**
 * A sampled great circle between two arbitrary positions — used for the live
 * leg from a vessel's actual position to the next node, and for a reroute's
 * temporary joinSegment. Not cached: the start point moves every tick.
 */
export function greatCircle(a: LonLat, b: LonLat, distanceNm?: number): LonLat[] {
  if (!isValid(a) || !isValid(b)) return [];
  const interpolate = geoInterpolate(a, b);
  const n = sampleCount(distanceNm ?? 300);
  const points: LonLat[] = [];
  for (let i = 0; i <= n; i++) {
    const raw = interpolate(i / n);
    const point: LonLat = [normaliseLon(raw[0]), raw[1]];
    if (isValid(point)) points.push(point);
  }
  return points;
}

/** A GeoJSON LineString, ready for geoPath. Null when there is nothing to draw. */
export function lineString(points: LonLat[]): GeoJSON.LineString | null {
  return points.length > 1 ? { type: "LineString", coordinates: points } : null;
}

/**
 * The local tangent bearing at the end of a path, in degrees clockwise from
 * north. Arrowheads use this so they sit along the drawn curve rather than
 * pointing at the far endpoint.
 */
export function tangentBearing(points: LonLat[], index: number): number {
  if (points.length < 2) return 0;
  const i = Math.max(0, Math.min(points.length - 2, index));
  const [lon1, lat1] = points[i];
  const [lon2, lat2] = points[i + 1];
  return bearing(lon1, lat1, lon2, lat2);
}

export function bearing(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const toRad = Math.PI / 180;
  const φ1 = lat1 * toRad;
  const φ2 = lat2 * toRad;
  const Δλ = (lon2 - lon1) * toRad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/** Evenly spaced positions along a path, for direction ticks on a long route. */
export function markersAlong(points: LonLat[], count: number): Array<{ point: LonLat; bearingDeg: number }> {
  if (points.length < 2 || count < 1) return [];
  const out: Array<{ point: LonLat; bearingDeg: number }> = [];
  for (let k = 1; k <= count; k++) {
    const t = k / (count + 1);
    const idx = Math.min(points.length - 2, Math.floor(t * (points.length - 1)));
    out.push({ point: points[idx], bearingDeg: tangentBearing(points, idx) });
  }
  return out;
}

/** Test seam: drop cached geometry so sampling can be re-exercised. */
export function clearGeometryCache(): void {
  edgeCache.clear();
}
