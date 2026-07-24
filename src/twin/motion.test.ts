// D-72 geometry proof: a vessel path may never cross land. Every berth slot ×
// every anchorage/approach slot is sampled point-by-point against the finger
// footprints and the inland platform — the corridor claim is tested, not
// eyeballed. Pure TS, no rendering.
import { describe, it, expect } from "vitest";
import { plannedPath, pathLength, pointAt, CORRIDOR_Z } from "./motion";
import { anchorageSlot, approachSlot, berthVesselSlot, departureSlot, fingerBox, PLATFORM } from "./layout";

const ANCHORAGE_BEAM = 3;
const ANCHORAGE_HULL = 13.5 + 2.1;

/** True if `p` is on top of a moored/waiting hull at `slot`. */
function onHull(p: { x: number; z: number }, slot: { x: number; z: number }): boolean {
  return Math.abs(p.x - slot.x) < ANCHORAGE_BEAM && Math.abs(p.z - slot.z) < ANCHORAGE_HULL / 2 + ANCHORAGE_BEAM / 2;
}

const BERTH_IDS = Array.from({ length: 12 }, (_, i) => `B${i + 1}`);
const FINGER_BOXES = ["F1", "F2", "F3", "F4"].map((f) => fingerBox(f));
const PLATFORM_BOX = {
  x: (PLATFORM.minX + PLATFORM.maxX) / 2,
  z: (PLATFORM.minZ + PLATFORM.maxZ) / 2,
  w: PLATFORM.maxX - PLATFORM.minX,
  d: PLATFORM.maxZ - PLATFORM.minZ,
};
const LAND = [...FINGER_BOXES, PLATFORM_BOX];

// Strictly inside a land box grown by `margin` — endpoints sit 1.8 off a quay
// face, so margin 1 both proves clearance and tolerates the fender gap.
function onLand(p: { x: number; z: number }, margin = 1): boolean {
  return LAND.some((b) => Math.abs(p.x - b.x) * 2 < b.w + margin * 2 && Math.abs(p.z - b.z) * 2 < b.d + margin * 2);
}

function assertClearPath(from: { x: number; z: number }, to: { x: number; z: number }): void {
  const path = plannedPath(from, to);
  const total = pathLength(path);
  for (let d = 0; d <= total; d += 0.5) {
    const { p } = pointAt(path, d);
    if (onLand(p)) {
      throw new Error(`path ${JSON.stringify(from)} → ${JSON.stringify(to)} crosses land at ${JSON.stringify(p)}`);
    }
  }
}

describe("vessel motion paths (D-72)", () => {
  it("keeps the corridor seaward of every finger tip", () => {
    expect(CORRIDOR_Z).toBeLessThanOrEqual(-115 - 5); // F4 tip −115 + margin
  });

  it("never crosses land: every berth × every anchorage slot, both directions", () => {
    for (const bid of BERTH_IDS) {
      const berth = berthVesselSlot(bid);
      for (let rank = 0; rank < 12; rank++) {
        const anchor = anchorageSlot(rank);
        assertClearPath(anchor, berth);
        assertClearPath(berth, anchor);
      }
    }
  });

  it("never crosses land: approach → anchorage and approach → berth", () => {
    for (let a = 0; a < 10; a++) {
      const approach = approachSlot(a);
      for (let rank = 0; rank < 12; rank++) assertClearPath(approach, anchorageSlot(rank));
      for (const bid of BERTH_IDS) assertClearPath(approach, berthVesselSlot(bid));
    }
  });

  it("handles a degenerate same-point path", () => {
    const p = { x: 20, z: -130 };
    const path = plannedPath(p, p);
    expect(pathLength(path)).toBe(0);
    expect(pointAt(path, 5).p).toEqual(p);
    expect(pointAt(path, 5).dir).toEqual({ x: 0, z: 0 });
  });

  it("clamps beyond the path end and reports segment direction", () => {
    const path = plannedPath({ x: 20, z: -130 }, { x: 40, z: -130 });
    const beyond = pointAt(path, 999);
    expect(beyond.p).toEqual({ x: 40, z: -130 });
    const mid = pointAt(path, 10);
    expect(mid.p.x).toBeCloseTo(30);
    expect(mid.dir).toEqual({ x: 1, z: 0 });
  });

  // A ship must not travel along its own mooring line — that is where its
  // neighbours are tied up. This shipped broken: gliding into B1 ran the hull
  // straight through B2, and the same held for B4/B5, B7/B8 and B10/B11/B12.
  it("never drives a moving vessel through a berthed one", () => {
    const BEAM = 3;
    const HULL = 13.5 + 2.1; // largest hull plus its bow wedge
    const moored = BERTH_IDS.map((id) => ({ id, slot: berthVesselSlot(id) }));

    const trips: { label: string; from: { x: number; z: number }; to: { x: number; z: number } }[] = [];
    for (const { id, slot } of moored) {
      trips.push({ label: `arrive ${id}`, from: approachSlot(0), to: slot });
      trips.push({ label: `depart ${id}`, from: slot, to: departureSlot(0) });
    }

    for (const trip of trips) {
      const path = plannedPath(trip.from, trip.to);
      const total = pathLength(path);
      for (let d = 0; d <= total; d += 0.5) {
        const { p } = pointAt(path, d);
        for (const other of moored) {
          // Skip the berth this trip starts or ends at.
          const isOwn =
            (Math.abs(trip.to.x - other.slot.x) < 0.01 && Math.abs(trip.to.z - other.slot.z) < 0.01) ||
            (Math.abs(trip.from.x - other.slot.x) < 0.01 && Math.abs(trip.from.z - other.slot.z) < 0.01);
          if (isOwn) continue;
          const clash =
            Math.abs(p.x - other.slot.x) < BEAM && Math.abs(p.z - other.slot.z) < HULL / 2 + BEAM / 2;
          expect(
            clash,
            `${trip.label} passes through ${other.id} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`,
          ).toBe(false);
        }
      }
    }
  });

  // Owner-reported: vessels joining/leaving the anchorage cut straight across
  // the grid of waiting ships instead of going around it. A vessel enters the
  // queue exclusively via approaching → anchored, and leaves it via
  // anchored → berthing — both directions must route around, not through.
  describe("requeue / offshore-exit bypass", () => {
    const anchored = Array.from({ length: 10 }, (_, rank) => ({ rank, slot: anchorageSlot(rank) }));

    // A fresh arrival is always assigned the queue's own TAIL — anchorageQueue
    // (derive.ts) sorts a newly-anchored vessel last by anchoredSinceTick — so
    // the realistic scenario at every depth is ranks 0..d-2 already occupied
    // and the new entrant landing at rank d-1. It never backfills an occupied
    // rank with others still ahead of it (that's not what this bug is about).
    it("never cuts through another waiting vessel when joining the queue at its assigned tail", () => {
      for (let depth = 1; depth <= 10; depth++) {
        const tail = anchored[depth - 1];
        const alreadyWaiting = anchored.slice(0, depth - 1);
        for (let a = 0; a < 6; a++) {
          const path = plannedPath(approachSlot(a), tail.slot);
          const total = pathLength(path);
          for (let d = 0; d <= total; d += 0.5) {
            const { p } = pointAt(path, d);
            for (const other of alreadyWaiting) {
              expect(
                onHull(p, other.slot),
                `approach ${a} → tail (depth ${depth}) passes through rank ${other.rank} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`,
              ).toBe(false);
            }
          }
        }
      }
    });

    // The berth server always releases the queue's FRONT (assignBerths starts
    // at index 0) — the realistic scenario is rank 0 leaving while the rest of
    // the queue (ranks 1..9) is still waiting behind it. The front needs no
    // offshore loop: it is already the position closest to the corridor, and
    // this is exactly what requeueBypass now declines to route (see its doc
    // comment) rather than dragging the hull backward through its own queue.
    it("never cuts through the rest of the queue when the front leaves for a berth", () => {
      const front = anchored[0];
      const stillWaiting = anchored.slice(1);
      for (const bid of BERTH_IDS.slice(0, 4)) {
        const berth = berthVesselSlot(bid);
        const path = plannedPath(front.slot, berth);
        const total = pathLength(path);
        for (let d = 0; d <= total; d += 0.5) {
          const { p } = pointAt(path, d);
          for (const other of stillWaiting) {
            expect(
              onHull(p, other.slot),
              `front → ${bid} passes through rank ${other.rank} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`,
            ).toBe(false);
          }
        }
      }
    });

    it("passes farther seaward than the whole queue, not between it and the port", () => {
      // "Behind the queue" means more negative z than every waiting vessel —
      // never a z that sits between the queue and the port (i.e. never on the
      // shoreward side, closer to 0, than the queue's own footprint).
      const queueMinZ = Math.min(...anchored.map((a) => a.slot.z));
      const path = plannedPath(approachSlot(0), anchorageSlot(2));
      const bypassPoints = path.filter((p) => p.z < queueMinZ - 1);
      expect(bypassPoints.length, "path never goes farther seaward than the queue").toBeGreaterThan(0);
    });

    it("keeps a short local move when a vessel's rank shifts within the queue", () => {
      // Not a state transition — both ends are inside the anchorage footprint,
      // so this must stay a direct slide, not a detour around itself.
      const path = plannedPath(anchorageSlot(3), anchorageSlot(1));
      expect(pathLength(path)).toBeCloseTo(
        Math.hypot(anchorageSlot(3).x - anchorageSlot(1).x, anchorageSlot(3).z - anchorageSlot(1).z),
      );
    });

    it("merges from a deterministic side — same trip, same route, every time", () => {
      const a = plannedPath(approachSlot(4), anchorageSlot(5));
      const b = plannedPath(approachSlot(4), anchorageSlot(5));
      expect(a).toEqual(b);
    });

    it("aligns with the queue heading before the final approach into the slot", () => {
      // The last leg into an anchorage slot must run along z at the slot's own
      // x (angleY 0.15 is a near-north heading) — not a diagonal final approach.
      const target = anchorageSlot(4);
      const path = plannedPath(approachSlot(0), target);
      const last = path[path.length - 1];
      const prev = path[path.length - 2];
      expect(prev.x).toBeCloseTo(last.x);
    });
  });
});
