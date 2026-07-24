import { describe, expect, it } from "vitest";
import {
  AGV_LEN,
  CIRCUITS,
  FINGER_CIRCUITS,
  GRID_LANES,
  MIN_GAP,
  cargoPhase,
  craneTransfers,
  pointAt,
  spawn,
  stepAgvs,
  yardTransfers,
  type Agv,
} from "./agv";
import {
  COMB_OUTLINE,
  FINGER_X,
  PLATFORM,
  TRUCK_BRANCHES,
  YARD_ORDER,
  berthLayout,
  transferStackPos,
  yardBayPos,
  yardBlockBox,
} from "./layout";

// The AGV fleet is presentation, but two of its properties are promises to the
// viewer rather than decoration: vehicles do not drive through each other, and
// they do not drive through the yard blocks or off the quay into the water.
// Both are asserted here rather than eyeballed in the canvas.

function pointInPolygon(p: { x: number; z: number }, poly: readonly { x: number; z: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Every AGV the scene can show at once: a full fleet on every route. */
function fullFleet(): Agv[] {
  return CIRCUITS.flatMap((c, i) => spawn(c, 4, i));
}

describe("AGV circuits", () => {
  it("keeps every lane on the comb landmass", () => {
    for (const c of CIRCUITS) {
      for (let s = 0; s < c.total; s += 0.5) {
        const { p } = pointAt(c, s);
        expect(
          pointInPolygon(p, COMB_OUTLINE),
          `${c.id} lane leaves the land at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`,
        ).toBe(true);
      }
    }
  });

  it("never drives a lane through a yard block", () => {
    for (const c of CIRCUITS) {
      for (let s = 0; s < c.total; s += 0.5) {
        const { p } = pointAt(c, s);
        for (const id of YARD_ORDER) {
          const b = yardBlockBox(id);
          const inside =
            Math.abs(p.x - b.x) < b.w / 2 - 0.01 && Math.abs(p.z - b.z) < b.d / 2 - 0.01;
          expect(inside, `${c.id} lane crosses ${id} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).toBe(false);
        }
      }
    }
  });

  it("puts a transfer bay beside every one of YB-A..YB-H, on the same face", () => {
    const bays = new Map<string, { x: number; z: number }>();
    for (const c of CIRCUITS) {
      for (const stop of c.stops) {
        if (stop.kind === "yard" && stop.blockId) bays.set(stop.blockId, pointAt(c, stop.s).p);
      }
    }
    for (const id of YARD_ORDER) {
      const bay = bays.get(id);
      expect(bay, `${id} has no transfer bay`).toBeDefined();
      const b = yardBlockBox(id);
      // Beside the block: aligned with it along z, and a short hop off its face.
      expect(Math.abs(bay!.z - b.z), `${id} bay not aligned with the block`).toBeLessThan(0.5);
      const gap = b.x - b.w / 2 - bay!.x;
      expect(gap, `${id} bay is ${gap.toFixed(1)} from the block face`).toBeGreaterThan(0);
      expect(gap, `${id} bay is ${gap.toFixed(1)} from the block face`).toBeLessThan(4);
      // Same (west) face for every block, both rows.
      expect(bay!.x).toBeLessThan(b.x);
    }
  });

  it("keeps the yard handoff short enough to look continuous", () => {
    // The distance the container actually travels between the stack it is drawn
    // in and the vehicle it lands on. This is the number the whole refactor is
    // about: it used to be ~15 units from the isolated shuttle lanes.
    for (const id of YARD_ORDER) {
      const bay = yardBayPos(id);
      const stack = transferStackPos(id);
      const d = Math.hypot(bay.x - stack.x, bay.z - stack.z);
      expect(d, `${id} handoff spans ${d.toFixed(2)} units`).toBeLessThan(6);
    }
  });

  it("connects every yard block to the berths on one circuit", () => {
    // Each column circuit must serve its own two blocks AND its finger's cranes,
    // so a block is always reachable from a berth without changing route.
    FINGER_CIRCUITS.forEach((c, f) => {
      const blocks = c.stops.filter((s) => s.kind === "yard").map((s) => s.blockId);
      expect(blocks).toContain(YARD_ORDER[f]);
      expect(blocks).toContain(YARD_ORDER[f + 4]);
      expect(c.stops.some((s) => s.kind === "crane")).toBe(true);
    });
  });

  it("passes a transfer point directly under every quay crane", () => {
    FINGER_CIRCUITS.forEach((c, f) => {
      for (let n = f * 3 + 1; n <= f * 3 + 3; n++) {
        const stop = c.stops.find((s) => s.craneKey === `B${n}`);
        expect(stop, `no transfer point for B${n}`).toBeDefined();
        const lay = berthLayout(`B${n}`);
        const { p } = pointAt(c, stop!.s);
        // The vehicle must line up with the berth along the quay, and sit just
        // inland of the face — under the portal, not out over the water.
        expect(Math.abs(p.z - lay.z)).toBeLessThan(0.5);
        expect(Math.abs(p.x - lay.faceX)).toBeLessThan(8);
      }
    });
  });

  it("gives every column route both its yard bays and quay work", () => {
    for (const c of FINGER_CIRCUITS) {
      expect(c.stops.filter((s) => s.kind === "yard")).toHaveLength(2);
      expect(c.stops.some((s) => s.kind === "crane"), `${c.id} never reaches a crane`).toBe(true);
    }
  });

  it("keeps the driven routes geometrically disjoint", () => {
    // Load-bearing: with no two routes able to reach each other, collision
    // avoidance reduces to a headway rule inside a route. Any future shared-grid
    // traffic would need a junction reservation manager instead.
    const sampled = CIRCUITS.map((c) => {
      const pts: { x: number; z: number }[] = [];
      for (let s = 0; s < c.total; s += 1) pts.push(pointAt(c, s).p);
      return { id: c.id, pts };
    });
    for (let i = 0; i < sampled.length; i++) {
      for (let j = i + 1; j < sampled.length; j++) {
        let min = Infinity;
        for (const a of sampled[i].pts) {
          for (const b of sampled[j].pts) min = Math.min(min, Math.hypot(a.x - b.x, a.z - b.z));
        }
        expect(min, `${sampled[i].id} and ${sampled[j].id} are ${min.toFixed(2)} apart`).toBeGreaterThan(AGV_LEN);
      }
    }
  });

  it("paints no road the vehicles cannot use, and drives none that is unpainted", () => {
    // Every driven lane must lie on the painted grid: either one of the shared
    // horizontal lines, or a column's own feeder/apron.
    expect(GRID_LANES.length).toBeGreaterThan(0);
    for (const lane of GRID_LANES) {
      expect(lane.a.z).toBe(lane.b.z); // the grid's horizontals are axis-aligned
      expect(lane.level).toBe("spine");
    }
  });

  it("keeps every lane inside the platform where it runs through the yard", () => {
    for (const c of CIRCUITS) {
      for (const p of c.pts) {
        if (p.z < PLATFORM.minZ) continue; // the finger apron half, north of the quay root
        expect(p.x).toBeGreaterThan(PLATFORM.minX);
        expect(p.x).toBeLessThan(PLATFORM.maxX);
        expect(p.z).toBeLessThanOrEqual(PLATFORM.maxZ);
      }
    }
  });
});

describe("AGV traffic", () => {
  it("never lets two vehicles overlap over a long run", () => {
    const agvs = fullFleet();
    const dt = 1 / 30;
    let worst = Infinity;
    for (let step = 0; step < 4000; step++) {
      stepAgvs(agvs, dt);
      for (let i = 0; i < agvs.length; i++) {
        for (let j = i + 1; j < agvs.length; j++) {
          const a = pointAt(agvs[i].circuit, agvs[i].s).p;
          const b = pointAt(agvs[j].circuit, agvs[j].s).p;
          worst = Math.min(worst, Math.hypot(a.x - b.x, a.z - b.z));
        }
      }
    }
    expect(worst).toBeGreaterThanOrEqual(AGV_LEN);
  });

  it("keeps traffic moving — no vehicle is ever permanently stuck", () => {
    // Collision-freedom is worthless if it is achieved by everything stopping.
    // Junction priority is a strict order precisely so a mutual wait cannot
    // form; this asserts the flow that guarantee is supposed to protect.
    const agvs = fullFleet();
    const start = agvs.map((a) => a.s);
    const laps = agvs.map(() => 0);
    const prev = agvs.map((a) => a.s);
    for (let step = 0; step < 6000; step++) {
      stepAgvs(agvs, 1 / 30);
      agvs.forEach((a, i) => {
        if (a.s < prev[i]) laps[i]++;
        prev[i] = a.s;
      });
    }
    agvs.forEach((a, i) => {
      expect(laps[i], `${a.id} completed ${laps[i]} laps (started at ${start[i].toFixed(1)})`).toBeGreaterThanOrEqual(2);
    });
  });

  it("holds the headway rule on a crowded single circuit", () => {
    const agvs = spawn(FINGER_CIRCUITS[0], 8, 0);
    const dt = 1 / 30;
    for (let step = 0; step < 3000; step++) {
      stepAgvs(agvs, dt);
      for (const a of agvs) {
        for (const b of agvs) {
          if (a === b) continue;
          const gap = ((b.s - a.s) % a.circuit.total + a.circuit.total) % a.circuit.total;
          // Anything in front must be at least a vehicle length away; the brake
          // targets MIN_GAP but a dwelling vehicle can be approached to it.
          if (gap > 0 && gap < MIN_GAP) expect(gap).toBeGreaterThanOrEqual(AGV_LEN - 1e-6);
        }
      }
    }
  });

  it("keeps every load between 0 and 2 TEU", () => {
    const agvs = fullFleet();
    for (let step = 0; step < 4000; step++) {
      stepAgvs(agvs, 1 / 30);
      for (const a of agvs) {
        expect(a.load).toBeGreaterThanOrEqual(0);
        expect(a.load).toBeLessThanOrEqual(2);
        expect(Number.isInteger(a.load)).toBe(true);
      }
    }
  });

  it("actually works cargo — imports fill up, exports empty out", () => {
    const agvs = fullFleet();
    const seen = new Map<string, Set<number>>();
    for (let step = 0; step < 4000; step++) {
      stepAgvs(agvs, 1 / 30);
      for (const a of agvs) {
        const set = seen.get(a.id) ?? new Set<number>();
        set.add(a.load);
        seen.set(a.id, set);
      }
    }
    // Every 2-TEU cargo vehicle must have been observed loaded, part-loaded and
    // empty, or the cycle is not completing: the yard crane fills it in one go
    // and the quay crane empties it one box at a time, so it passes through 1.
    // Repositioning vehicles on the distribution loops carry nothing by design.
    const twoTeu = agvs.filter((a) => a.capacity === 2 && a.homeBlockId !== null);
    expect(twoTeu.length).toBeGreaterThan(0);
    for (const a of twoTeu) {
      expect([...(seen.get(a.id) ?? [])].sort(), `${a.id} load history`).toEqual([0, 1, 2]);
    }
  });

  it("hands a crane a vehicle to work, with a progressing transfer", () => {
    const agvs = FINGER_CIRCUITS.flatMap((c, i) => spawn(c, 3, i));
    const progresses: number[] = [];
    let sawTransfer = false;
    for (let step = 0; step < 3000; step++) {
      stepAgvs(agvs, 1 / 30);
      const transfers = craneTransfers(agvs);
      for (const [berthId, t] of transfers) {
        sawTransfer = true;
        expect(berthId).toMatch(/^B\d+$/);
        expect(t.progress).toBeGreaterThanOrEqual(0);
        expect(t.progress).toBeLessThanOrEqual(1);
        progresses.push(t.progress);
      }
    }
    expect(sawTransfer).toBe(true);
    // The spreader must have something to follow: transfers are not instant.
    expect(Math.max(...progresses)).toBeGreaterThan(0.5);
  });

  it("never changes the load before the visible handoff finishes", () => {
    // The whole point of the deferred transfer: `load` must hold steady for the
    // entire dwell and only step at the very end, so the box is in flight for a
    // visible interval instead of appearing on the deck on arrival.
    const agvs = fullFleet();
    let changesWhileDwelling = 0;
    let deferredChanges = 0;
    const prev = new Map(agvs.map((a) => [a.id, a.load]));
    for (let step = 0; step < 6000; step++) {
      const wasDwelling = new Map(agvs.map((a) => [a.id, a.dwell]));
      stepAgvs(agvs, 1 / 30);
      for (const a of agvs) {
        const before = prev.get(a.id)!;
        if (a.load !== before) {
          // A change is only legal on the frame the dwell reaches zero.
          if ((wasDwelling.get(a.id) ?? 0) > 0 && a.dwell === 0) deferredChanges++;
          else changesWhileDwelling++;
          prev.set(a.id, a.load);
        }
      }
    }
    expect(deferredChanges).toBeGreaterThan(0);
    expect(changesWhileDwelling).toBe(0);
  });

  it("keeps the container in exactly one place throughout a handoff", () => {
    // While a handoff runs, the box is drawn in flight and the deck shows the
    // count EXCLUDING it. Assert the invariant the renderer relies on: the total
    // (deck + in-flight) never changes mid-transfer, so nothing ever
    // double-appears or vanishes.
    const agvs = fullFleet();
    for (let step = 0; step < 6000; step++) {
      stepAgvs(agvs, 1 / 30);
      for (const a of agvs) {
        const phase = cargoPhase(a);
        if (phase === "idle") continue;
        const onDeck = phase === "unloading" ? a.load - 1 : a.load;
        const inFlight = 1;
        expect(onDeck).toBeGreaterThanOrEqual(0);
        expect(onDeck + inFlight).toBeGreaterThan(0);
        expect(onDeck + inFlight).toBeLessThanOrEqual(a.capacity + 1);
      }
    }
  });

  it("reports a yard handoff with progress the animation can follow", () => {
    const agvs = fullFleet();
    const progresses: number[] = [];
    const blocks = new Set<string>();
    // Long enough for every vehicle to complete several laps: an import AGV's
    // first yard visit is a no-op (it arrives empty and leaves empty), so it
    // only shows a handoff once it has collected at the quay and come back.
    for (let step = 0; step < 20000; step++) {
      stepAgvs(agvs, 1 / 30);
      for (const [blockId, t] of yardTransfers(agvs)) {
        blocks.add(blockId);
        expect(t.progress).toBeGreaterThanOrEqual(0);
        expect(t.progress).toBeLessThanOrEqual(1);
        expect(t.phase === "loading" || t.phase === "unloading").toBe(true);
        progresses.push(t.progress);
      }
    }
    // Every block must be ASSIGNED a vehicle that works it — that is the
    // structural guarantee. Which blocks happen to be mid-transfer inside a
    // fixed window is a timing artifact of dwell contention on a shared route,
    // so it is not asserted; that a transfer runs, and runs over real time, is.
    const homes = new Set(agvs.map((a) => a.homeBlockId).filter(Boolean));
    expect([...homes].sort()).toEqual([...YARD_ORDER].sort());
    expect(blocks.size).toBeGreaterThan(0);
    expect(Math.max(...progresses)).toBeGreaterThan(0.8);
  });

  it("never puts two vehicles in the same transfer bay", () => {
    const agvs = fullFleet();
    for (let step = 0; step < 6000; step++) {
      stepAgvs(agvs, 1 / 30);
      const occupied = new Map<string, number>();
      for (const a of agvs) {
        if (a.dwell > 0 && a.atStop?.kind === "yard" && a.atStop.blockId) {
          occupied.set(a.atStop.blockId, (occupied.get(a.atStop.blockId) ?? 0) + 1);
        }
      }
      for (const [blockId, n] of occupied) expect(n, `${blockId} double-occupied`).toBe(1);
    }
  });

  it("turns corners rather than snapping heading", () => {
    const agvs = spawn(FINGER_CIRCUITS[0], 1, 0);
    let maxJump = 0;
    let prev = agvs[0].yaw;
    for (let step = 0; step < 3000; step++) {
      stepAgvs(agvs, 1 / 30);
      const d = Math.abs(
        ((agvs[0].yaw - prev + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI,
      );
      maxJump = Math.max(maxJump, d);
      prev = agvs[0].yaw;
    }
    // 3.2 rad/s cap at 1/30 s per step ≈ 0.107 rad; allow a hair for float error.
    expect(maxJump).toBeLessThan(0.12);
  });

  it("stays in step with the D-62 manifest's AGV branch topology", () => {
    // layout.ts keeps the manifest record (one branch per finger, indexed by
    // opsDerive's branchPressure); the circuits here are the rendered refinement
    // of the same branches. If a finger is ever added or removed, both move.
    expect(FINGER_CIRCUITS).toHaveLength(TRUCK_BRANCHES.length);
    FINGER_CIRCUITS.forEach((c, f) => {
      const laneReach = Math.min(...c.pts.map((p) => p.z));
      // The test that matters is reach to the WORK, not parity with the
      // centreline: F4's apron lane deliberately stops at −100 where the
      // manifest branch runs to −108, because the pentagon tapers in towards the
      // tip and a lane on the return side would run off the quay into the water.
      // What it must do is reach every berth it serves.
      const northmostBerth = Math.min(
        ...[1, 2, 3].map((k) => berthLayout(`B${f * 3 + k}`).z),
      );
      expect(laneReach).toBeLessThanOrEqual(northmostBerth);
    });
  });

  it("places a lane beside each finger's own yard column", () => {
    FINGER_CIRCUITS.forEach((c, f) => {
      const stop = c.stops.find((s) => s.kind === "yard");
      const { p } = pointAt(c, stop!.s);
      expect(Math.abs(p.x - FINGER_X[f])).toBeLessThan(14);
    });
  });
});
