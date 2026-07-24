// Deterministic scene geometry (§7 scene layout; INT-2 D-62/D-63 Tuas footprint).
// The sim entities are abstract (no coordinates), so this module is the single
// source of truth for where each berth, finger, yard block, crane, gate and
// anchored vessel sits in world space.
//
// Frame: X = east(+)/west(−), Z = north(−)/south(+), Y = up. Water/anchorage lie
// north (−Z); four finger piers project north from the quay-root line Z = QUAY_Z;
// the inland platform (yard + gates) sits south of it; F4 is the long eastern
// finger with the tapered seaward pentagon. Geometry follows the locked D-62
// scaffold (docs/previews/tuas-spatial-preview.svg) rotated into this frame at
// s = 0.25 world-units/preview-px (D-63), snapped to clean numbers.
//
// The transform is implemented in d62Manifest.ts (previewToWorld/worldToPreview)
// and the snapping is bounded by a tolerance test there — these world values
// stay canonical (GR-D8); the manifest versions them and records their lineage.

// minZ runs to −205 rather than −190 so the water plane still extends past the
// HULL of the northernmost queued vessel, not just past its centre point. At
// −190 the deepest anchorage slot (−184) and the approach entry anchor (−185)
// put a 15.6-unit hull over the edge of the rendered sea.
export const GROUND = { minX: -95, maxX: 95, minZ: -205, maxZ: 75 } as const;

export const QUAY_Z = 0; // finger-root line; fingers project north from here
export const FINGER_TIP_Z = -80; // F1–F3 tips (F4 runs to −115)
export const FINGER_HALF_W = 15;
export const FINGER_X = [-62, -21, 20, 61] as const; // F1..F4 west→east (pitch 41 → basins 11 wide)

// Inland platform (yard + gates) footprint south of the quay root.
export const PLATFORM = { minX: -77, maxX: 72, minZ: 0, maxZ: 65 } as const;

// F4 pentagon (D-62 P1..P5): straight west quay face, tapered east seaward
// boundary, apex east-of-centre, flat backland (taper never cuts the platform).
export const F4_OUTLINE: readonly { x: number; z: number }[] = [
  { x: 46, z: 0 }, // P1 west root
  { x: 46, z: -115 }, // P2 west tip
  { x: 61, z: -115 }, // P3 tip east corner
  { x: 79, z: -65 }, // P4 apex (east of centre)
  { x: 72, z: 0 }, // P5 east root
];

// One continuous comb landmass (D-61/D-62): platform + F1–F3 slabs + F4 pentagon
// as a single polygon; the three basins are genuine negative space between the
// fingers. Traced from the preview SVG path under the D-63 transform.
export const COMB_OUTLINE: readonly { x: number; z: number }[] = [
  { x: -77, z: 65 }, // platform SW corner
  { x: -77, z: -80 }, // F1 west face → tip
  { x: -47, z: -80 },
  { x: -47, z: 0 }, // basin 1 root
  { x: -36, z: 0 },
  { x: -36, z: -80 }, // F2
  { x: -6, z: -80 },
  { x: -6, z: 0 }, // basin 2 root
  { x: 5, z: 0 },
  { x: 5, z: -80 }, // F3
  { x: 35, z: -80 },
  { x: 35, z: 0 }, // basin 3 root
  ...F4_OUTLINE, // F4 pentagon P1..P5
  { x: 72, z: 65 }, // platform SE corner
];

export type Slot = { x: number; z: number; angleY: number };

export function fingerIndex(fingerId: string): number {
  return Number(fingerId.slice(1)) - 1;
}
export function berthNumber(berthId: string): number {
  return Number(berthId.slice(1));
}

// A finger pier's footprint (centered box; F4 = the pentagon's bounding box).
export function fingerBox(fingerId: string): { x: number; z: number; w: number; d: number } {
  if (fingerId === "F4") return { x: 62.5, z: -57.5, w: 33, d: 115 };
  const fx = FINGER_X[fingerIndex(fingerId)];
  const z = (QUAY_Z + FINGER_TIP_Z) / 2;
  return { x: fx, z, w: FINGER_HALF_W * 2, d: QUAY_Z - FINGER_TIP_Z };
}

// Where a berth's vessel lies alongside + which finger face it's on. F1–F3: two
// berths on the west face (inner/outer), one on the east face (mid, staggered
// between them so opposing hulls across a basin never lie beam-to-beam) —
// matches worldGen (local 0,1 = west, 2 = east). F4 (D-62): all three berths on
// the straight west face, spread along the longest finger; B12 nearest the tip,
// clear of the east-side taper.
const WEST_Z = [-21, -56] as const; // local 0 (inner) / 1 (outer)
const EAST_Z = -39; // local 2, staggered between the opposing west berths
const F4_Z = [-21, -56, -99] as const;
// Vessel centreline off the quay face: half-beam 1.5 + fender. Trimmed from 2.5
// so the two moored lines in a basin sit far enough apart for a transiting hull
// to thread between them — a basin is only 11 wide, and at 2.5 the three hulls
// left no gap at all. Ships lie against their fenders in reality anyway.
const VESSEL_OFF = 1.8;

export function berthLayout(berthId: string): {
  fingerX: number;
  west: boolean;
  faceX: number; // quay-edge strip x
  vesselX: number; // vessel centerline x
  z: number;
} {
  const n = berthNumber(berthId);
  const fi = Math.floor((n - 1) / 3);
  const local = (n - 1) % 3;
  const fx = FINGER_X[fi];
  const west = fi === 3 ? true : local < 2;
  const faceX = fx + (west ? -FINGER_HALF_W : FINGER_HALF_W);
  const vesselX = faceX + (west ? -VESSEL_OFF : VESSEL_OFF);
  const z = fi === 3 ? F4_Z[local] : west ? WEST_Z[local] : EAST_Z;
  return { fingerX: fx, west, faceX, vesselX, z };
}

// A vessel berthed here lies parallel to the finger (length along Z).
export function berthVesselSlot(berthId: string): Slot {
  const b = berthLayout(berthId);
  return { x: b.vesselX, z: b.z, angleY: 0 };
}

/**
 * The x of the transit lane a vessel uses to reach or leave this berth.
 *
 * A ship must not run ALONG its own mooring line to get to its berth — that
 * line is where its neighbours are tied up. Approaching B1 down x −79.5 drove
 * the hull straight through B2, and the same held for every same-face pair
 * (B4/B5, B7/B8, B10/B11/B12). Vessels instead run up the middle of the basin
 * and turn in only at their own berth's z.
 *
 * The lane is the basin centreline — midway between this finger and its
 * neighbour — which is the only water wide enough. F1's west face has open sea
 * instead of a basin, so it gets a proper stand-off.
 */
export function berthApproachX(berthId: string): number {
  const b = berthLayout(berthId);
  const fi = Math.floor((berthNumber(berthId) - 1) / 3);
  if (b.west) {
    // Basin between this finger and the one west of it; F1 has open water.
    return fi === 0 ? FINGER_X[0] - FINGER_HALF_W - 9 : (FINGER_X[fi] + FINGER_X[fi - 1]) / 2;
  }
  return (FINGER_X[fi] + FINGER_X[fi + 1]) / 2;
}

const BERTH_IDS_ALL = Array.from({ length: 12 }, (_, i) => `B${i + 1}`);

/**
 * If `p` sits at a berth, the transit lane that berth uses; otherwise null.
 *
 * Lets the travel planner (motion.ts) pull a ship off the quay face before it
 * starts moving along it, in BOTH directions, without needing to be told which
 * berth is involved — a departing vessel has already had its berthId cleared.
 */
export function berthLaneAt(p: { x: number; z: number }): number | null {
  if (p.z > QUAY_Z || p.z < -115) return null; // not alongside a finger at all
  for (const id of BERTH_IDS_ALL) {
    const slot = berthVesselSlot(id);
    if (Math.abs(p.x - slot.x) < 1.5 && Math.abs(p.z - slot.z) < 2) return berthApproachX(id);
  }
  return null;
}

// STS crane rail positions for a berth: two gantries straddling the quay edge,
// offset fore/aft along the berth. index 0/1 selects which of the two.
export function stsCraneSlot(berthId: string, index: number): { x: number; z: number } {
  const b = berthLayout(berthId);
  return { x: b.faceX, z: b.z + (index === 0 ? -6 : 6) };
}

// Yard blocks on the inland platform: near-quay row (YB-A..YB-D, reefer A/B
// nearest the quay) then far row (YB-E..YB-H, hazmat YB-H far SE corner).
// Columns align under the fingers.
export const YARD_ORDER = ["YB-A", "YB-B", "YB-C", "YB-D", "YB-E", "YB-F", "YB-G", "YB-H"] as const;
export const BLOCK_W = 15;
// Shortened from 15 so the two rows can sit closer together while still leaving
// a real cross-aisle between them, instead of the 3-unit slot they used to have.
export const BLOCK_D = 13;

// Row centres. Tightened from 20/38: the yard now runs 9.5→22.5 and 29.5→42.5,
// which leaves a 7-unit cross-aisle between the rows, ~9 units between the quay
// root and the near row for the main spine, and room south of the far row for
// the rear circulation lane — all of which the AGV grid needs and none of which
// existed before.
const ROW_Z = [16, 36] as const;

export function yardBlockBox(blockId: string): { x: number; z: number; w: number; d: number } {
  const idx = YARD_ORDER.indexOf(blockId as (typeof YARD_ORDER)[number]);
  const col = idx % 4;
  const row = Math.floor(idx / 4);
  return { x: FINGER_X[col], z: ROW_Z[row], w: BLOCK_W, d: BLOCK_D };
}

/**
 * The AGV transfer bay for a block: a stopping position on the northbound
 * feeder lane, directly beside the block's WEST face.
 *
 * Every block uses the same face, in both rows, so the grid reads consistently
 * and one lane serves a whole column. The bay is 2.5 units off the block edge —
 * close enough that the yard crane reaches straight from the stack onto the
 * deck, which is the whole point: the old yard lanes sat ~15 units away in the
 * gaps BETWEEN columns, so a container had nowhere visible to come from.
 */
export const BAY_OFFSET = 10; // from block centre to the bay (block half-width is 7.5)

export function yardBayPos(blockId: string): { x: number; z: number } {
  const b = yardBlockBox(blockId);
  return { x: b.x - BAY_OFFSET, z: b.z };
}

// The yard crane spans its block AND the transfer bay beside it, so a box is
// carried between the stack and the AGV by a visible machine rather than
// crossing open ground on its own.
export function rtgSpan(blockId: string): { centreX: number; width: number } {
  const b = yardBlockBox(blockId);
  const west = b.x - BAY_OFFSET - 1.6;
  const east = b.x + b.w / 2;
  return { centreX: (west + east) / 2, width: east - west };
}

// RTG cranes sit at the ends of a block, spanning its width.
export function rtgCraneSlot(blockId: string, index: number): { x: number; z: number } {
  const b = yardBlockBox(blockId);
  return { x: b.x, z: b.z + (index === 0 ? -b.d / 2 + 1.5 : b.d / 2 - 1.5) };
}

// Container stack grid inside a block footprint (representative, not per-container).
//
// Widened from 6×3 so the stacks actually FILL the block. At 6×3 they occupied a
// 7.5 × 3 patch in the middle of a 15 × 15 pad, which left the nearest container
// ~6.75 units from even a tight lane — a container had to cross a wide empty
// apron to reach an AGV, which is what made the handoff read as teleporting. At
// 8×5 they span 10.5 × 6, leaving a ~2.25-unit margin to the block edge and
// putting the transfer column within reach of the bay.
export const STACK_COLS = 8;
export const STACK_ROWS = 5;
export const MAX_STACK = 4; // tallest container stack (levels)
export const BOX = 1.15; // world size of one container box
export function stackOrigin(blockId: string): { x0: number; z0: number } {
  const b = yardBlockBox(blockId);
  const spanX = (STACK_COLS - 1) * (BOX + 0.35);
  const spanZ = (STACK_ROWS - 1) * (BOX + 0.35);
  return { x0: b.x - spanX / 2, z0: b.z - spanZ / 2 };
}
export function stackPos(blockId: string, col: number, row: number): { x: number; z: number } {
  const { x0, z0 } = stackOrigin(blockId);
  return { x: x0 + col * (BOX + 0.35), z: z0 + row * (BOX + 0.35) };
}

/**
 * The stack the yard crane works when serving the transfer bay: the column
 * closest to the bay, mid-row. Keeping the handoff to one known slot is what
 * makes the move short and repeatable — the box always comes off (or onto) the
 * same corner of the block, beside the lane, rather than somewhere in the middle.
 */
export function transferStackPos(blockId: string): { x: number; z: number } {
  return stackPos(blockId, 0, Math.floor(STACK_ROWS / 2));
}

// Hull length of the largest vessel class, used for spacing guarantees below.
// Mirrors Vessels.tsx CLASS_LEN (neopanamax 13.5) — rendering-only sizes.
export const MAX_VESSEL_LEN = 13.5;

// Anchorage offshore NE, well seaward of the finger tips (D-63): anchored
// vessels queue in a staggered grid, order = queue rank. Row pitch 18 and
// column pitch 10 exceed hull length/beam so waiting vessels never overlap.
export function anchorageSlot(rank: number): Slot {
  const col = rank % 3;
  const row = Math.floor(rank / 3);
  return { x: 20 + col * 10, z: -130 - row * 18, angleY: 0.15 };
}

// Requeue / offshore-exit fix (owner-reported: vessels joining or leaving the
// anchorage cut straight across it instead of going around). The anchorage's
// own footprint, DERIVED from its slot formula rather than hardcoded, so the
// bypass below can never drift out of step with the grid it routes around.
// Depth 12 matches the rank count already exercised elsewhere (motion.test.ts,
// validateLayout's queue loop).
const ANCHORAGE_DEPTH = 12;
function anchorageBounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const ranks = Array.from({ length: ANCHORAGE_DEPTH }, (_, i) => anchorageSlot(i));
  return {
    minX: Math.min(...ranks.map((r) => r.x)),
    maxX: Math.max(...ranks.map((r) => r.x)),
    minZ: Math.min(...ranks.map((r) => r.z)),
    maxZ: Math.max(...ranks.map((r) => r.z)),
  };
}
const ANCHORAGE_BOUNDS = anchorageBounds();
// Clearance beyond the queue's own footprint: a hull half-length plus a safety
// gap, so the bypass line never grazes the outermost moored ship.
const QUEUE_CLEARANCE = 10;

function inAnchorageZone(p: { x: number; z: number }): boolean {
  const b = ANCHORAGE_BOUNDS;
  return (
    p.x >= b.minX - QUEUE_CLEARANCE &&
    p.x <= b.maxX + QUEUE_CLEARANCE &&
    p.z >= b.minZ - QUEUE_CLEARANCE &&
    p.z <= b.maxZ + QUEUE_CLEARANCE
  );
}

/**
 * Requeue / offshore-exit bypass.
 *
 * Fires only for the ENTRY direction — a vessel arriving to join the queue
 * (`approaching → anchored`, the only way a vessel enters it). It returns two
 * waypoints that route the hull FARTHER SEAWARD than the whole queue (z past
 * its outermost row) before turning in from whichever side is closer to the
 * vessel's approach, merging in from outside instead of cutting across the
 * grid. `anchorageQueue` (derive.ts) already ranks a freshly-anchored vessel
 * LAST by `anchoredSinceTick`, so it is always assigned the queue's own TAIL —
 * this only fixes the PATH there, not the assignment. Because every rank below
 * the tail is already filled and none above it exist yet, the vertical leg up
 * the tail's own column and the lateral leg behind the whole grid never cross
 * an occupied slot, at any queue depth.
 *
 * Deliberately NOT applied to the exit direction (`anchored → berthing`).
 * `assignBerths` (tick.ts) always serves from the FRONT of the queue (index 0,
 * occasionally a later index if the front is weather/tide/hold-ineligible) —
 * the front is already the position closest to the corridor, so it needs no
 * offshore loop. Forcing one is actively worse: it drags the hull BACKWARD
 * through its own trailing ranks (confirmed by motion.test.ts) before turning
 * toward the berth, instead of proceeding directly the way it already can. The
 * existing berth-lane logic already routes this leg clear of land; a queue
 * skipped ahead of its front-most member (the rarer hold/tide case) can still
 * in principle cross a nearer rank — pre-existing before this change and not
 * introduced by it, left as a known limitation rather than papered over here.
 *
 * Both endpoints in the zone (a vessel's rank shifting as others ahead leave,
 * while it stays `anchored` throughout — not a state transition at all) or
 * neither (an unrelated trip) also return null: short local moves that do not
 * need a detour.
 */
export function requeueBypass(
  from: { x: number; z: number },
  to: { x: number; z: number },
): [{ x: number; z: number }, { x: number; z: number }] | null {
  const fromIn = inAnchorageZone(from);
  const toIn = inAnchorageZone(to);
  if (fromIn || !toIn) return null;
  const b = ANCHORAGE_BOUNDS;
  const centreX = (b.minX + b.maxX) / 2;
  // Deterministic: the side is read off the approaching vessel's own x, never
  // randomised, so a replay of the same seed takes the same route (D-18). A
  // tie (exactly centred) resolves west, which cannot occur for any real
  // approach slot given its formula, but keeps the function total.
  const sideX = from.x <= centreX ? b.minX - QUEUE_CLEARANCE : b.maxX + QUEUE_CLEARANCE;
  const behindZ = b.minZ - QUEUE_CLEARANCE;
  const outer = { x: sideX, z: behindZ };
  const aligned = { x: to.x, z: behindZ };
  return [outer, aligned];
}

/**
 * Approaching vessels wait in the northwest approaches, staggered by arrival
 * order: five abreast, then a second row further seaward.
 *
 * It used to march east in ONE line (`x = -45 + rank * 8`), which at rank 8
 * reached x 19 — inside the anchorage's first column at x 20 — so a ninth
 * inbound vessel parked on top of a waiting one. Wrapping into rows keeps the
 * whole queue west of the anchorage however deep it gets. Row pitch clears the
 * hull; the second row also stays clear of APPROACH_ENTRY at z −185.
 */
export function approachSlot(rank: number): Slot {
  return { x: -45 + (rank % 5) * 9, z: -149 - Math.floor(rank / 5) * 18, angleY: 0 };
}

// GR-3: the approved D-62 approach entry anchor — where a vessel handed over
// from the geographic frame appears. It sits north of the approach queue, on the
// seaward edge of the frame, and a vessel occupies it for exactly one tick (its
// handover tick) before joining the normal approach queue. Its orientation is
// the tangent of the approach path (heading in, southward), which is what
// orients the vessel — the geographic heading is never copied across frames.
export const APPROACH_ENTRY: Slot = { x: -45, z: -185, angleY: 0 };

/**
 * Diverted vessels peel off to the open water EAST of the terminal, bows east,
 * marching seaward.
 *
 * One column, not two. These slots are rotated a quarter turn, so a hull's
 * LENGTH (15.6 with the bow wedge) lies along X while its beam (3) lies along
 * Z — the previous two-column layout spaced them 8 apart in X, which drove
 * 5.5 units of one hull through the next, and pushed the outer column's bow
 * past GROUND.maxX. Spacing them along Z instead costs only the beam, so a
 * 6-unit pitch clears comfortably and ten ranks still fit inside GROUND.
 */
export function divertSlot(rank: number): Slot {
  return { x: 84, z: -128 - rank * 6, angleY: -Math.PI / 2 };
}

/**
 * Vessels that have finished their call and are steaming out, bows west.
 *
 * A departing vessel used to bind to `berthVesselSlot`, but the tick clears
 * `berthId` at the very moment it sets the status (tick.ts), so the slot always
 * resolved to null and the ship VANISHED off the quay instead of leaving it.
 * Giving departures their own outbound lane means the slot changes from the
 * berth to open water, and the D-72 travel path glides the hull out through the
 * seaward corridor — which is what "leaves from berth" actually looks like.
 *
 * Rotated like the divert lane so the queue costs beam, not length, in Z; well
 * west of the approach queue so inbound and outbound traffic never share water.
 */
export function departureSlot(rank: number): Slot {
  return { x: -75, z: -140 - rank * 6, angleY: Math.PI / 2 };
}

// Gate complex on the platform's south edge: three visual gate houses over the
// single GATE-1 sim entity (D-63 ruling 3). GATE anchors the middle house.
export const GATE_HOUSES = [
  { x: -51, z: 58, w: 11.5, d: 10.5 },
  { x: -10, z: 58, w: 11.5, d: 10.5 },
  { x: 31, z: 58, w: 11.5, d: 10.5 },
] as const;
export const GATE = GATE_HOUSES[1];

// A few decorative warehouses along the south edge between/east of the gates.
export const WAREHOUSES = [
  { x: 8, z: 60, w: 9, d: 5 },
  { x: 48, z: 60, w: 10, d: 5 },
  { x: 62, z: 59, w: 8, d: 5 },
] as const;

// AGV network (D-63 ruling 5): the MANIFEST topology — the main loop runs the
// quay-root road and the yard lanes on the platform; one branch loop per finger
// carries AGVs from the spine up the finger centreline and back. Density stays
// GateState-driven (D-38), and `opsDerive.agvMetrics` indexes its per-finger
// branch pressure off this array.
//
// These are the declared topology, NOT what the twin draws. The rendered lanes
// live in agv.ts, which routes the same four branches along the quay APRONS
// instead of the centreline so a vehicle ends up under the crane portal rather
// than 15 units inboard of it. agv.test.ts keeps the two in step.
export const TRUCK_PATH: { x: number; z: number }[] = [
  { x: -70, z: 4 },
  { x: 66, z: 4 },
  { x: 66, z: 50 },
  { x: -70, z: 50 },
];
export const TRUCK_BRANCHES: { x: number; z: number }[][] = [
  [{ x: -65, z: 4 }, { x: -65, z: -72 }, { x: -59, z: -72 }, { x: -59, z: 4 }], // F1
  [{ x: -24, z: 4 }, { x: -24, z: -72 }, { x: -18, z: -72 }, { x: -18, z: 4 }], // F2
  [{ x: 17, z: 4 }, { x: 17, z: -72 }, { x: 23, z: -72 }, { x: 23, z: 4 }], // F3
  [{ x: 55, z: 4 }, { x: 55, z: -108 }, { x: 61, z: -108 }, { x: 61, z: 4 }], // F4 (longest)
];

// ---------------------------------------------------------------------------
// validateLayout (D-63): dev-time + tested placement checks, mirroring the
// assertInvariants pattern. Throws on the first violation.
// ---------------------------------------------------------------------------

const FINGERS = ["F1", "F2", "F3", "F4"] as const;
const BERTH_IDS = Array.from({ length: 12 }, (_, i) => `B${i + 1}`);

type Box = { x: number; z: number; w: number; d: number };

function boxesOverlap(a: Box, b: Box): boolean {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.z - b.z) * 2 < a.d + b.d;
}

function insideBox(p: { x: number; z: number }, b: Box, margin = 0): boolean {
  return Math.abs(p.x - b.x) * 2 < b.w + margin * 2 && Math.abs(p.z - b.z) * 2 < b.d + margin * 2;
}

// Rendered hull dimensions (Vessels.tsx): the largest hull is MAX_VESSEL_LEN
// long and HULL_BEAM wide, and the bow wedge adds BOW_OVERHANG ahead of it.
const HULL_BEAM = 3;
const BOW_OVERHANG = 2.1;

/**
 * The footprint a moored/queued vessel actually occupies at a slot.
 *
 * Checking slot CENTRES is what let the old divert queue ship: two slots 8
 * apart passed every point-based test while their quarter-turned 15.6-unit
 * hulls overlapped by 5.5. Anything spacing- or bounds-related has to be
 * checked against this box, not the point.
 */
function hullBox(slot: Slot): Box {
  const len = MAX_VESSEL_LEN + BOW_OVERHANG;
  // A slot is either roughly bow-north (length along Z) or quarter-turned
  // (length along X); the anchorage's slight 0.15 rad skew stays the former.
  const lengthAlongX = Math.abs(Math.sin(slot.angleY)) > 0.5;
  return {
    x: slot.x,
    z: slot.z,
    w: lengthAlongX ? len : HULL_BEAM,
    d: lengthAlongX ? HULL_BEAM : len,
  };
}

function boxInsideGround(b: Box): boolean {
  return (
    b.x - b.w / 2 >= GROUND.minX &&
    b.x + b.w / 2 <= GROUND.maxX &&
    b.z - b.d / 2 >= GROUND.minZ &&
    b.z + b.d / 2 <= GROUND.maxZ
  );
}

function fail(msg: string): never {
  throw new Error(`validateLayout: ${msg}`);
}

export function validateLayout(): void {
  const minPitch = MAX_VESSEL_LEN + 4; // hull + clearance

  // Structure: 4 fingers × 3 berths, 8 yard blocks.
  if (FINGERS.length !== 4 || BERTH_IDS.length !== 12) fail("expected 4 fingers × 3 berths");
  if (YARD_ORDER.length !== 8) fail("expected 8 yard blocks");

  const fingerBoxes = FINGERS.map((f) => fingerBox(f));
  const landBoxes: Box[] = [
    ...fingerBoxes,
    { x: (PLATFORM.minX + PLATFORM.maxX) / 2, z: (PLATFORM.minZ + PLATFORM.maxZ) / 2, w: PLATFORM.maxX - PLATFORM.minX, d: PLATFORM.maxZ - PLATFORM.minZ },
  ];

  // Yard blocks: fully inside the platform, never on a finger, non-overlapping.
  for (const id of YARD_ORDER) {
    const b = yardBlockBox(id);
    if (b.x - b.w / 2 < PLATFORM.minX || b.x + b.w / 2 > PLATFORM.maxX || b.z - b.d / 2 < PLATFORM.minZ || b.z + b.d / 2 > PLATFORM.maxZ)
      fail(`${id} not fully inside the platform`);
    for (const f of fingerBoxes) if (boxesOverlap(b, f)) fail(`${id} overlaps a finger`);
    for (const other of YARD_ORDER)
      if (other !== id && boxesOverlap(b, yardBlockBox(other))) fail(`${id} overlaps ${other}`);
  }

  // Berths + cranes: on their finger's quay face, spaced, hulls in open water.
  for (const bid of BERTH_IDS) {
    const n = berthNumber(bid);
    const fi = Math.floor((n - 1) / 3);
    const lay = berthLayout(bid);
    const expectedFace = lay.fingerX + (lay.west ? -FINGER_HALF_W : FINGER_HALF_W);
    if (lay.faceX !== expectedFace) fail(`${bid} faceX off the quay face`);
    const zMin = fi === 3 ? -115 : FINGER_TIP_Z;
    if (lay.z < zMin || lay.z > QUAY_Z) fail(`${bid} z outside its finger`);
    // Vessel centreline must sit in water: outside every finger footprint.
    for (const f of fingerBoxes) if (insideBox({ x: lay.vesselX, z: lay.z }, f)) fail(`${bid} vessel slot on land`);
    for (let i = 0; i < 2; i++) {
      const s = stsCraneSlot(bid, i);
      if (s.x !== lay.faceX) fail(`${bid} STS crane off the quay face`);
      if (s.z < zMin || s.z > QUAY_Z) fail(`${bid} STS crane beyond the finger`);
    }
    if (!lay.west && fi === 3) fail("F4 berths must all be west-face (D-62)");
    if (!insideBox({ x: lay.vesselX, z: lay.z }, { x: 0, z: (GROUND.minZ + GROUND.maxZ) / 2, w: GROUND.maxX - GROUND.minX, d: GROUND.maxZ - GROUND.minZ }))
      fail(`${bid} vessel slot outside GROUND`);
  }

  // Same-face berth pitch ≥ hull + clearance; opposing hulls across a basin
  // must stagger (z-spans disjoint) so vessels never lie beam-to-beam.
  for (const [a, b] of [[WEST_Z[0], WEST_Z[1]], [F4_Z[0], F4_Z[1]], [F4_Z[1], F4_Z[2]]]) {
    if (Math.abs(a - b) < minPitch) fail(`same-face berth pitch ${Math.abs(a - b)} < ${minPitch}`);
  }
  for (const w of WEST_Z) {
    if (Math.abs(w - EAST_Z) * 2 < MAX_VESSEL_LEN * 2) {
      const [aMin, aMax] = [w - MAX_VESSEL_LEN / 2, w + MAX_VESSEL_LEN / 2];
      const [bMin, bMax] = [EAST_Z - MAX_VESSEL_LEN / 2, EAST_Z + MAX_VESSEL_LEN / 2];
      if (aMin < bMax && bMin < aMax) fail("opposing basin hulls overlap in z (no stagger)");
    }
  }

  // F4 pentagon: 5 vertices, apex east of centre between root and tip, flat
  // backland — the taper never cuts the platform (YB-D/YB-H stay inside).
  if (F4_OUTLINE.length !== 5) fail("F4 must have 5 vertices");
  const apex = F4_OUTLINE.reduce((m, v) => (v.x > m.x ? v : m));
  if (apex.x <= FINGER_X[3]) fail("F4 apex not east of centre");
  if (apex.z >= QUAY_Z || apex.z <= -115) fail("F4 apex z outside root..tip");
  for (const v of F4_OUTLINE) if (v.z > QUAY_Z) fail("F4 taper cuts into the platform");

  // Waiting/approach/divert/departure slots: open water (clear of all land),
  // with the whole HULL inside GROUND — not merely the slot's centre point.
  const QUEUES = ["anchorage", "approach", "divert", "departure"] as const;
  const queueSlot = (name: (typeof QUEUES)[number], rank: number): Slot =>
    name === "anchorage" ? anchorageSlot(rank)
    : name === "approach" ? approachSlot(rank)
    : name === "divert" ? divertSlot(rank)
    : departureSlot(rank);

  const placed: { label: string; box: Box }[] = [];
  for (const name of QUEUES) {
    for (let rank = 0; rank < 10; rank++) {
      const slot = queueSlot(name, rank);
      const box = hullBox(slot);
      for (const land of landBoxes) {
        if (insideBox(slot, land, 3)) fail(`${name} slot rank ${rank} on/near land`);
        if (boxesOverlap(box, land)) fail(`${name} rank ${rank} hull overlaps land`);
      }
      if (!boxInsideGround(box)) fail(`${name} rank ${rank} hull outside GROUND`);
      placed.push({ label: `${name} ${rank}`, box });
    }
  }
  placed.push({ label: "approach entry", box: hullBox(APPROACH_ENTRY) });

  // No two queued vessels may share water — within a queue OR across queues.
  // This is the check the old two-column divert layout could not have passed.
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      if (boxesOverlap(placed[i].box, placed[j].box))
        fail(`hulls overlap: ${placed[i].label} and ${placed[j].label}`);
    }
  }
  // GR-3 approach entry anchor: open water inside GROUND, and clear of the
  // approach queue so a handing-over vessel never lands on top of a waiting one.
  for (const land of landBoxes) if (insideBox(APPROACH_ENTRY, land, 3)) fail("approach entry anchor on/near land");
  if (APPROACH_ENTRY.z < GROUND.minZ || APPROACH_ENTRY.z > GROUND.maxZ || APPROACH_ENTRY.x < GROUND.minX || APPROACH_ENTRY.x > GROUND.maxX)
    fail("approach entry anchor outside GROUND");
  for (let rank = 0; rank < 10; rank++) {
    const s = approachSlot(rank);
    if (Math.hypot(s.x - APPROACH_ENTRY.x, s.z - APPROACH_ENTRY.z) < minPitch)
      fail(`approach entry anchor too close to approach slot ${rank}`);
  }

  // Anchorage spacing: rows ≥ hull + clearance apart, columns ≥ 2 beams.
  if (Math.abs(anchorageSlot(0).z - anchorageSlot(3).z) < minPitch) fail("anchorage row pitch too small");
  if (Math.abs(anchorageSlot(0).x - anchorageSlot(1).x) < 6) fail("anchorage column pitch too small");
  // Seaward: every anchorage slot lies beyond the F1–F3 finger tips.
  if (anchorageSlot(0).z >= FINGER_TIP_Z - 10) fail("anchorage not seaward of the finger tips");

  // AGV: main loop on the platform; one branch per finger reaching up it.
  if (TRUCK_PATH.length < 4) fail("TRUCK_PATH must be a closed loop of ≥ 4 points");
  for (const p of TRUCK_PATH)
    if (p.x < PLATFORM.minX || p.x > PLATFORM.maxX || p.z < PLATFORM.minZ || p.z > PLATFORM.maxZ)
      fail("TRUCK_PATH leaves the platform");
  if (TRUCK_BRANCHES.length !== 4) fail("expected one AGV branch per finger");
  TRUCK_BRANCHES.forEach((branch, i) => {
    const f = fingerBoxes[i];
    const northmost = Math.min(...branch.map((p) => p.z));
    if (northmost > -40) fail(`AGV branch F${i + 1} does not reach up the finger`);
    for (const p of branch) {
      if (p.z < QUAY_Z && (p.x < f.x - f.w / 2 || p.x > f.x + f.w / 2)) fail(`AGV branch F${i + 1} leaves its finger`);
    }
  });
}
