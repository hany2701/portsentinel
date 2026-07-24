import type { LonLat } from "./routeGeometry";
import type { SimState } from "../sim";

// GR-5A §6: short movement trails.
//
// A trail is PRESENTATION HISTORY. It is a bounded ring buffer of canonical
// positions the simulation already produced — never a decorative curve, never
// stored in SimState (which is structuredCloned every tick and persisted), and
// never an input to routing or movement. Dropping this module entirely would
// change nothing about the simulation.

/** Positions kept per vessel. Enough to read direction, short enough to stay cheap. */
export const TRAIL_LENGTH = 12;

type TrailBuffer = Map<string, LonLat[]>;

/**
 * Append the current positions of the given vessels to their trails.
 *
 * Returns a NEW map so React sees a changed reference. Vessels not in the list
 * are dropped, so a trail cannot outlive the vessel being rendered individually
 * (at global zoom, where clusters replace markers, trails disappear).
 */
export function advanceTrails(
  previous: TrailBuffer,
  sim: SimState,
  vesselIds: readonly string[],
): TrailBuffer {
  const next: TrailBuffer = new Map();
  for (const id of vesselIds) {
    const vessel = sim.vessels.find((v) => v.id === id);
    if (!vessel?.track) continue;
    const point: LonLat = [vessel.track.longitude, vessel.track.latitude];
    const history = previous.get(id) ?? [];
    const last = history[history.length - 1];
    // A stationary vessel stops extending its trail rather than piling up
    // duplicate points at one spot.
    if (last && last[0] === point[0] && last[1] === point[1]) {
      next.set(id, history);
      continue;
    }
    const appended = [...history, point];
    next.set(id, appended.length > TRAIL_LENGTH ? appended.slice(appended.length - TRAIL_LENGTH) : appended);
  }
  return next;
}

/** Trails long enough to draw. */
export function drawableTrails(trails: TrailBuffer): TrailBuffer {
  const out: TrailBuffer = new Map();
  for (const [id, points] of trails) if (points.length > 1) out.set(id, points);
  return out;
}
