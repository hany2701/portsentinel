import { BAY_OFFSET, FINGER_X, YARD_ORDER, berthLayout, yardBayPos } from "./layout";

// AGV traffic model (D-63 ruling 5, presentation-only).
//
// Automated guided vehicles run fixed CIRCUITS between the yard and the quay.
// Everything here is pure geometry + a small state machine over elapsed seconds:
// it reads no SimState and mutates none. How MANY circuits run is still decided
// by the presentation layer (D-71), so an idle or weather-suspended port shows
// no AGVs — this module only decides how the ones that do run behave.
//
// The two guarantees this module is built to keep, both pinned by agv.test.ts:
//
//  1. AGVs never collide. Circuits are laid out with DISJOINT geometry (no two
//     circuits share a lane, and every circuit is one-way around its loop), so
//     the only vehicles that can ever meet are those on the same circuit — and
//     those are held apart by an explicit headway rule. Vehicles brake rather
//     than overlap, exactly as a real AGV fleet does under a traffic manager.
//  2. AGVs stay on the land they are drawn on. Lanes are derived from the same
//     finger/yard geometry the scenery is extruded from, and the test walks
//     every circuit checking it never leaves the comb.
//
// Relationship to layout.ts's TRUCK_PATH / TRUCK_BRANCHES: those stay the D-62
// MANIFEST record of the AGV topology (one spine, one branch per finger) and are
// what `opsDerive.agvMetrics` indexes its branch pressure by. They route up each
// finger's CENTRELINE, which is fine as a topology statement but leaves a vehicle
// 15 units from the quay face — too far for a crane to reach. The circuits here
// are the rendered refinement of the same four branches: same count, same order,
// same fingers, but run along the aprons so a crane transfer is physically
// possible. agv.test.ts pins the two together so they cannot drift apart.

export type Pt = { x: number; z: number };

/**
 * Lane offset inland from a quay face — where an AGV sits under the portal.
 *
 * 5, not 4.5, so that a finger's apron lane (faceX + APRON = FINGER_X − 10) is
 * the SAME line as that column's yard feeder lane. One straight lane now runs
 * from the finger tip all the way down past both yard blocks to the rear aisle,
 * instead of the apron and the yard lanes being separate networks.
 */
export const APRON = 5;

/**
 * The grid. Three levels, as distinct lines rather than a mesh of equals:
 *
 *   spine      z 3.5          — the main east–west route along the quay root
 *   cross      z 24.5 / 27.5  — the central aisle between the two block rows
 *   rear       z 48.5         — rear circulation behind the far row
 *   feeders    x FINGER_X ∓ 10 — north/south, berth ↔ yard, one pair per column
 *
 * Every lane is ONE-WAY and every level is two-way as a pair: the feeders run
 * north on the west lane and south on the east, and the cross-aisle runs east at
 * 24.5 and west at 27.5. The spine and the rear lane are the outer halves of the
 * two circulation loops (spine east → cross west, cross east → rear west), so
 * they need no second carriageway of their own.
 *
 * Only lanes that are actually DRIVEN are declared here, because AgvLanes paints
 * straight from these circuits — a painted road an AGV never uses would be
 * exactly the "hidden path" mismatch the grid is supposed to avoid.
 *
 * Because direction is fixed per lane, two vehicles can only ever meet
 * perpendicular at an intersection or nose-to-tail in the same lane — never
 * head-on — which is what keeps the traffic rule simple enough to prove.
 */
const SPINE_E = 3.5;
const CROSS_E = 24.5;
const CROSS_W = 27.5;
const REAR_W = 48.5;
/** East and west edge lanes, joining the three horizontal levels. */
const EDGE_W = -72;
const EDGE_E = 71;
/** Feeder lane x for a column: northbound on the west, southbound on the east. */
const feederN = (c: number) => FINGER_X[c] - BAY_OFFSET;
const feederS = (c: number) => FINGER_X[c] + BAY_OFFSET;

/** How far up each finger the AGV lane runs (F4 is the long one). */
const LANE_TIP_Z = [-72, -72, -72, -100] as const;
/** F4's pentagon tapers, so its return lane cannot mirror the west lane. */
const F4_RETURN_X = 57;

/** Vehicle body length; also the closest two AGVs may ever come. */
export const AGV_LEN = 3;
/** Headway an AGV keeps behind the one in front. */
export const MIN_GAP = 5;
const SPEED = 7; // world units per second

export type StopKind = "yard" | "crane";

export type AgvStop = {
  s: number; // arc length along the circuit
  kind: StopKind;
  /** Which crane transfer point this is, for the quay-crane choreography. */
  craneKey?: string;
  /** Which yard block this bay serves, for the yard-crane handoff. */
  blockId?: string;
  dwell: number; // seconds paused here
};

export type Circuit = {
  id: string;
  pts: Pt[]; // closed polyline, traversed in order and wrapping
  segLen: number[];
  total: number;
  stops: AgvStop[];
};

function build(id: string, pts: Pt[]): Omit<Circuit, "stops"> {
  const segLen = pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return Math.hypot(q.x - p.x, q.z - p.z);
  });
  return { id, pts, segLen, total: segLen.reduce((a, b) => a + b, 0) };
}

/** Position and unit heading at arc length `s` (wraps around the loop). */
export function pointAt(c: Circuit, s: number): { p: Pt; dir: Pt } {
  let d = ((s % c.total) + c.total) % c.total;
  for (let i = 0; i < c.pts.length; i++) {
    const len = c.segLen[i];
    if (d <= len || i === c.pts.length - 1) {
      const a = c.pts[i];
      const b = c.pts[(i + 1) % c.pts.length];
      const t = len === 0 ? 0 : d / len;
      return {
        p: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t },
        dir: len === 0 ? { x: 0, z: 1 } : { x: (b.x - a.x) / len, z: (b.z - a.z) / len },
      };
    }
    d -= len;
  }
  return { p: { ...c.pts[0] }, dir: { x: 0, z: 1 } };
}

/** Arc length of the point on the circuit closest to `target`. */
function sNearest(c: Omit<Circuit, "stops">, target: Pt): number {
  let best = 0;
  let bestD = Infinity;
  let acc = 0;
  for (let i = 0; i < c.pts.length; i++) {
    const a = c.pts[i];
    const b = c.pts[(i + 1) % c.pts.length];
    const len = c.segLen[i];
    if (len > 0) {
      const t = Math.max(
        0,
        Math.min(1, ((target.x - a.x) * (b.x - a.x) + (target.z - a.z) * (b.z - a.z)) / (len * len)),
      );
      const px = a.x + (b.x - a.x) * t;
      const pz = a.z + (b.z - a.z) * t;
      const d = Math.hypot(target.x - px, target.z - pz);
      if (d < bestD) {
        bestD = d;
        best = acc + t * len;
      }
    }
    acc += len;
  }
  return best;
}

/**
 * One circuit per finger: north up the west apron, across the head, south down
 * the east apron, then closed off south of the near yard row.
 *
 * The lanes deliberately sit APRON units inland of each quay face rather than up
 * the finger centreline, so an AGV running the loop passes DIRECTLY under every
 * crane on that face — which is what makes the transfer choreography possible at
 * all. Both aprons clear the yard blocks they run past (blocks are ±7.5 about
 * the same x, the lanes are ±10.5).
 */
/**
 * One circuit per yard column: up the west feeder from the rear aisle, past both
 * of that column's transfer bays, on up the finger apron under every crane,
 * across the head, and back down the east feeder to the rear aisle.
 *
 * This is the change that closes the gap. The bays now sit ON the route — the
 * same straight lane serves the far block, the near block and the quay — where
 * before the yard shuttles ran in the gaps BETWEEN columns and stopped ~15 units
 * from the nearest container with nothing connecting them to the berths.
 */
function columnCircuit(f: number): Circuit {
  const northX = feederN(f); // == FINGER_X[f] − 10 == faceX + APRON on the west face
  const southX = f === 3 ? F4_RETURN_X : feederS(f);
  const tipZ = LANE_TIP_Z[f];

  const pts: Pt[] =
    f === 3
      ? [
          { x: northX, z: REAR_W },
          { x: northX, z: tipZ },
          { x: F4_RETURN_X, z: tipZ },
          // F4's east boundary tapers towards the tip, so its return lane hugs
          // the west side until it is back on the platform, then jogs east
          // around YB-D/YB-H rather than driving through them.
          { x: F4_RETURN_X, z: 2 },
          { x: feederS(f), z: 2 },
          { x: feederS(f), z: REAR_W },
        ]
      : [
          { x: northX, z: REAR_W },
          { x: northX, z: tipZ },
          { x: southX, z: tipZ },
          { x: southX, z: REAR_W },
        ];

  const base = build(`C${f + 1}`, pts);

  const stops: AgvStop[] = [];
  // A transfer point under every crane on this finger.
  for (let n = f * 3 + 1; n <= f * 3 + 3; n++) {
    const lay = berthLayout(`B${n}`);
    stops.push({
      s: sNearest(base, { x: lay.faceX + (lay.west ? APRON : -APRON), z: lay.z }),
      kind: "crane",
      craneKey: `B${n}`,
      dwell: 3.2,
    });
  }
  // A bay beside BOTH of this column's blocks — near row then far row.
  for (const blockId of [YARD_ORDER[f], YARD_ORDER[f + 4]]) {
    const bay = yardBayPos(blockId);
    stops.push({ s: sNearest(base, bay), kind: "yard", blockId, dwell: 3 });
  }

  stops.sort((a, b) => a.s - b.s);
  return { ...base, stops };
}

export const FINGER_CIRCUITS: Circuit[] = [0, 1, 2, 3].map(columnCircuit);
export const CIRCUITS: Circuit[] = FINGER_CIRCUITS;

/**
 * The painted road network.
 *
 * This is the yard's ROAD LAYOUT — the compact orthogonal grid the brief asks
 * for: a main spine along the quay root, a central cross-aisle between the two
 * block rows, rear circulation behind the far row, north/south feeders serving
 * each column, and the short access stubs into the transfer bays.
 *
 * The vehicles currently run the four COLUMN routes, which are the parts of this
 * grid that connect a berth to its blocks — the roads a working AGV needs. Those
 * four routes have disjoint geometry, which is deliberate and load-bearing: no
 * two vehicles on different routes can ever reach each other, so collision
 * avoidance reduces to a headway rule within a route. A shared grid with
 * crossing traffic needs a junction reservation manager to stay both
 * collision-free AND deadlock-free, and an earlier attempt at one here
 * gridlocked (a stalled vehicle on a crossing lane held four columns hostage).
 * Drawing the full grid while running the provably safe subset is the honest
 * trade: every lane an AGV drives is painted, and no AGV drives anywhere unpainted.
 */
export const GRID_LANES: { a: Pt; b: Pt; level: LaneLevel }[] = [
  { a: { x: EDGE_W, z: SPINE_E }, b: { x: EDGE_E, z: SPINE_E }, level: "spine" },
  { a: { x: EDGE_W, z: CROSS_E }, b: { x: EDGE_E, z: CROSS_E }, level: "spine" },
  { a: { x: EDGE_W, z: CROSS_W }, b: { x: EDGE_E, z: CROSS_W }, level: "spine" },
  { a: { x: EDGE_W, z: REAR_W }, b: { x: EDGE_E, z: REAR_W }, level: "spine" },
];

/** Lane hierarchy, so the renderer can draw the three levels at their own widths. */
export type LaneLevel = "spine" | "feeder" | "access";

export function laneLevel(circuitId: string): LaneLevel {
  if (circuitId === "SPINE" || circuitId === "REAR") return "spine";
  return "feeder";
}

/** The short yard-access stub beside each bay, drawn narrower than the feeder. */
export function accessStubs(): { blockId: string; a: Pt; b: Pt }[] {
  return YARD_ORDER.map((blockId) => {
    const bay = yardBayPos(blockId);
    // From the lane centre towards the block face — a stub, not a road.
    return { blockId, a: { x: bay.x, z: bay.z }, b: { x: bay.x + BAY_OFFSET - 7.5, z: bay.z } };
  });
}

export type Agv = {
  id: string;
  circuit: Circuit;
  s: number;
  /** TEU aboard: 0, 1 or 2. */
  load: number;
  /** Import AGVs arrive empty and leave loaded; export AGVs do the reverse. */
  mode: "import" | "export";
  /** How many TEU this AGV works per yard visit (1 or 2). */
  capacity: number;
  /**
   * The one block this vehicle works. A column's lane passes TWO bays (near row
   * and far row); without an assignment every vehicle would do its business at
   * the first bay it reached and the second would never be worked. Vehicles are
   * dealt alternately between the two, so both blocks in a column stay served.
   * `null` = a repositioning vehicle on a distribution loop, which carries
   * nothing and stops nowhere.
   */
  homeBlockId: string | null;
  /** Seconds of dwell remaining; > 0 means stopped. */
  dwell: number;
  /** The stop being serviced while dwelling, for the crane choreography. */
  atStop: AgvStop | null;
  /** Smoothed heading in radians, so corners are turned rather than snapped. */
  yaw: number;
  /**
   * Whether this vehicle actually moved on the previous step.
   *
   * Junction priority ignores stalled traffic. Without that, a vehicle stopped
   * near a junction keeps its claim on it forever and everything behind the
   * crossing lane waits on a queue that is never going to move — which is
   * exactly how the grid seized up: the distribution loops crossed every feeder,
   * got stuck, and then held four columns hostage. Dropping the claim of a
   * stalled vehicle guarantees the wait graph cannot contain a permanent cycle;
   * the contact brake still prevents anyone actually touching.
   */
  movedLast: boolean;
};

/**
 * Lay `count` AGVs evenly around a circuit.
 *
 * Even spacing is what keeps the headway rule from having to do any work at
 * steady state: vehicles start more than MIN_GAP apart and only close up when
 * one is dwelling at a transfer point.
 */
export function spawn(circuit: Circuit, count: number, seedIndex: number): Agv[] {
  const n = Math.max(0, count);
  const blocks = circuit.stops.flatMap((s) => (s.kind === "yard" && s.blockId ? [s.blockId] : []));
  return Array.from({ length: n }, (_, i) => {
    const mode: Agv["mode"] = (seedIndex + i) % 2 === 0 ? "import" : "export";
    const capacity = (seedIndex + i) % 3 === 0 ? 2 : 1;
    const homeBlockId = blocks.length > 0 ? blocks[i % blocks.length] : null;
    const s = (i / Math.max(1, n)) * circuit.total;
    const { dir } = pointAt(circuit, s);
    return {
      id: `${circuit.id}-${i}`,
      circuit,
      s,
      load: mode === "export" ? capacity : 0,
      mode,
      capacity,
      homeBlockId,
      dwell: 0,
      atStop: null,
      yaw: Math.atan2(dir.x, dir.z),
      movedLast: true,
    };
  });
}

/** Shortest forward distance from `a` to `b` around the loop. */
function ahead(total: number, a: number, b: number): number {
  return ((b - a) % total + total) % total;
}

/**
 * Advance every AGV by `dt` seconds.
 *
 * Mutates in place — these are frame-level presentation vehicles held in a ref,
 * never simulation state. Returns nothing; read positions with `pointAt`.
 */
export function stepAgvs(agvs: Agv[], dt: number): void {
  // Routes have disjoint geometry (see GRID_LANES), so the only vehicles that
  // can reach each other are those on the same route. Grouping by route is what
  // lets the headway rule below be a simple, provable arc-length comparison
  // instead of a junction reservation system.
  const byCircuit = new Map<string, Agv[]>();
  for (const a of agvs) {
    const list = byCircuit.get(a.circuit.id);
    if (list) list.push(a);
    else byCircuit.set(a.circuit.id, [a]);
  }

  for (const group of byCircuit.values()) {
    for (const agv of group) {

    if (agv.dwell > 0) {
      agv.dwell = Math.max(0, agv.dwell - dt);
      // The cargo changes hands at the END of the dwell, not on arrival: the box
      // is in flight for the whole dwell and only becomes the AGV's (or the
      // yard's) once the visible move has finished.
      if (agv.dwell === 0) {
        if (agv.atStop) applyTransfer(agv, agv.atStop);
        agv.atStop = null;
      }
      continue;
    }

    let advance = SPEED * dt;

    // Headway: never close within MIN_GAP of the vehicle in front. Every route
    // is one-way, so "in front" is unambiguous, and clamping the advance means a
    // blocked AGV stops short rather than passing through — which is also the
    // queueing position for a bay that is already occupied.
    let clearance = Infinity;
    for (const other of group) {
      if (other === agv) continue;
      const gap = ahead(agv.circuit.total, agv.s, other.s);
      if (gap > 0 && gap < clearance) clearance = gap;
    }
    if (clearance !== Infinity) advance = Math.min(advance, Math.max(0, clearance - MIN_GAP));

    // Stop at the NEAREST transfer point crossed this step. Nearest by forward
    // distance, not by array order: a vehicle near the end of the loop reaches
    // the wrapped-around stop first, and picking the wrong one would teleport it
    // backwards.
    let next: AgvStop | null = null;
    let nextGap = Infinity;
    for (const stop of agv.circuit.stops) {
      // Drive past a bay that belongs to another vehicle's block — stopping
      // there would block it for no work and leave that block unserved.
      if (stop.kind === "yard" && stop.blockId !== agv.homeBlockId) continue;
      const gap = ahead(agv.circuit.total, agv.s, stop.s);
      if (gap > 1e-9 && gap <= advance && gap < nextGap) {
        next = stop;
        nextGap = gap;
      }
    }
    agv.movedLast = advance > 1e-6;
    if (next) {
      agv.s = next.s;
      agv.dwell = next.dwell;
      agv.atStop = next;
    } else {
      agv.s = (agv.s + advance) % agv.circuit.total;
    }

    const { dir } = pointAt(agv.circuit, agv.s);
    if (dir.x !== 0 || dir.z !== 0) {
      const target = Math.atan2(dir.x, dir.z);
      // Turn towards the lane heading instead of snapping, and take the short
      // way round so a 180° corner does not spin the wrong way.
      let delta = ((target - agv.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      const maxTurn = 3.2 * dt;
      delta = Math.max(-maxTurn, Math.min(maxTurn, delta));
      agv.yaw += delta;
    }
    }
  }
}

/**
 * What changes hands at a transfer point.
 *
 * Import: collect at the quay, drop in the yard. Export: the reverse. A crane
 * moves ONE box per visit, which is why a 2-TEU AGV dwells at the quay long
 * enough for two lifts and why `load` is allowed to sit at 1 in between.
 */
function applyTransfer(agv: Agv, stop: AgvStop): void {
  if (stop.kind === "yard") {
    agv.load = yardTargetLoad(agv);
    return;
  }
  // A quay crane moves ONE box per lift, which is why a 2-TEU vehicle dwells
  // long enough for two and its load legitimately sits at 1 in between.
  if (agv.mode === "import") agv.load = Math.min(agv.capacity, agv.load + 1);
  else agv.load = Math.max(0, agv.load - 1);
}

/** Progress through the current dwell, 0 → 1. Drives the crane spreader. */
export function dwellProgress(agv: Agv): number {
  if (!agv.atStop || agv.atStop.dwell <= 0) return 0;
  return 1 - agv.dwell / agv.atStop.dwell;
}

/**
 * The visible cargo state of a vehicle. `load` is what it is CARRYING — it does
 * not change until a handoff finishes — so a box is never both in the yard and
 * on the deck, and never nowhere.
 *
 *   idle              parked or running, load is settled
 *   loading           a box is in flight from the stack to the deck
 *   unloading         a box is in flight from the deck to the stack
 *
 * The renderer draws exactly one box per TEU: `load` boxes on the deck, plus one
 * in-flight box while a handoff is running. During loading the deck shows the
 * OLD count and the extra box is in the air; during unloading the deck already
 * shows the reduced count and the departing box is in the air. Either way the
 * total is constant, which is what stops the despawn/respawn.
 */
export type CargoPhase = "idle" | "loading" | "unloading";

export function cargoPhase(agv: Agv): CargoPhase {
  const stop = agv.atStop;
  if (!stop || agv.dwell <= 0) return "idle";
  if (stop.kind === "yard") {
    const target = yardTargetLoad(agv);
    if (target > agv.load) return "loading";
    if (target < agv.load) return "unloading";
    return "idle";
  }
  // At a quay crane, only report a move the vehicle can actually make: a full
  // import AGV has nothing left to receive, and an empty export AGV has nothing
  // left to give. Reporting one anyway would drive the renderer to show a box
  // that does not exist.
  if (agv.mode === "import") return agv.load < agv.capacity ? "loading" : "idle";
  return agv.load > 0 ? "unloading" : "idle";
}

/** What a yard visit will leave aboard once the handoff completes. */
function yardTargetLoad(agv: Agv): number {
  if (agv.circuit.stops.some((s) => s.kind === "crane")) {
    return agv.mode === "export" ? agv.capacity : 0;
  }
  return agv.load > 0 ? 0 : agv.capacity;
}

/**
 * Yard handoffs in flight, keyed by block id, for the yard-crane animation.
 * `progress` runs 0 → 1 across the dwell and is what the box position is
 * interpolated along, so the crane, the box and the vehicle all move together.
 */
export function yardTransfers(
  agvs: Agv[],
): Map<string, { agv: Agv; progress: number; phase: CargoPhase }> {
  const out = new Map<string, { agv: Agv; progress: number; phase: CargoPhase }>();
  for (const agv of agvs) {
    const stop = agv.atStop;
    if (agv.dwell > 0 && stop?.kind === "yard" && stop.blockId) {
      const phase = cargoPhase(agv);
      if (phase !== "idle") out.set(stop.blockId, { agv, progress: dwellProgress(agv), phase });
    }
  }
  return out;
}

/**
 * The AGV currently under each quay crane, keyed by berth id.
 *
 * The crane renderer reads this to decide whether to lower its spreader, and how
 * far — so the box only ever moves while a vehicle is actually there to take it.
 */
export function craneTransfers(agvs: Agv[]): Map<string, { agv: Agv; progress: number }> {
  const out = new Map<string, { agv: Agv; progress: number }>();
  for (const agv of agvs) {
    if (agv.dwell > 0 && agv.atStop?.kind === "crane" && agv.atStop.craneKey) {
      out.set(agv.atStop.craneKey, { agv, progress: dwellProgress(agv) });
    }
  }
  return out;
}

/** The lane geometry, for drawing the painted carriageways on the ground. */
export function laneSegments(): { a: Pt; b: Pt }[] {
  const out: { a: Pt; b: Pt }[] = [];
  for (const c of CIRCUITS) {
    for (let i = 0; i < c.pts.length; i++) {
      out.push({ a: c.pts[i], b: c.pts[(i + 1) % c.pts.length] });
    }
  }
  return out;
}
