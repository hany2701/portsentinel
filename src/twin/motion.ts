import { berthLaneAt, requeueBypass } from "./layout";

// D-72: pure vessel travel paths for frame-level interpolation. A ship moving
// between its authoritative slots never cuts across a finger: any endpoint in
// the basin region (south of the corridor) is entered/exited straight along its
// own water column, and the east-west transit happens on a seaward corridor
// clear of every finger tip (F1–F3 end at z −80, F4 at −115). Geometry is
// proven by motion.test.ts, not eyeballed. Presentation-only — no sim state.

export type Pt = { x: number; z: number };

export const CORRIDOR_Z = -125; // seaward of F4's tip (−115) with margin

/**
 * A ship never travels along its own mooring line — that line is where its
 * neighbours are tied up. If either end of the trip is a berth, the path pulls
 * out to that berth's basin transit lane first (`berthLaneAt`), runs along the
 * lane, and only turns in at the berth's own z. Without this, gliding into B1
 * ran the hull straight through B2, and the same held for every same-face pair.
 *
 * The same principle applies to a vessel JOINING the anchorage queue
 * (`approaching → anchored`): it must not cut straight across the grid of
 * waiting ships to reach its slot. `requeueBypass` inserts two waypoints that
 * route farther seaward than the whole queue and turn in from outside. It
 * fires only for that entry direction — see its own doc comment for why the
 * exit direction (`anchored → berthing`) is deliberately left alone.
 */
export function plannedPath(from: Pt, to: Pt): Pt[] {
  const fromLane = berthLaneAt(from);
  const toLane = berthLaneAt(to);
  const bypass = requeueBypass(from, to);
  const raw: Pt[] = [{ x: from.x, z: from.z }];
  // Off the berth, square out into the basin before moving along the quay.
  if (fromLane !== null) raw.push({ x: fromLane, z: from.z });
  if (from.z > CORRIDOR_Z) raw.push({ x: fromLane ?? from.x, z: CORRIDOR_Z });
  // Round the anchorage queue rather than cross it, before resuming toward
  // whichever corridor/lane logic the destination needs.
  if (bypass) raw.push(bypass[0], bypass[1]);
  if (to.z > CORRIDOR_Z) raw.push({ x: toLane ?? to.x, z: CORRIDOR_Z });
  // Down the basin to the berth's z, then turn in.
  if (toLane !== null) raw.push({ x: toLane, z: to.z });
  raw.push({ x: to.x, z: to.z });

  const pts: Pt[] = [raw[0]];
  for (const p of raw.slice(1)) {
    const last = pts[pts.length - 1];
    if (Math.hypot(p.x - last.x, p.z - last.z) > 1e-6) pts.push(p);
  }
  return pts;
}

export function pathLength(path: Pt[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  return total;
}

// Point at `dist` along the path plus the unit direction of the segment it is
// on. Clamps to the endpoints; a degenerate path has direction (0, 0).
export function pointAt(path: Pt[], dist: number): { p: Pt; dir: Pt } {
  if (path.length === 1) return { p: { ...path[0] }, dir: { x: 0, z: 0 } };
  let d = Math.max(0, dist);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const dir = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
    if (d <= len || i === path.length - 1) {
      const t = Math.min(1, d / len);
      return { p: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, dir };
    }
    d -= len;
  }
  const end = path[path.length - 1];
  return { p: { ...end }, dir: { x: 0, z: 0 } };
}

export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}
