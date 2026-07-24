import {
  BLOCK_D,
  BLOCK_W,
  COMB_OUTLINE,
  FINGER_HALF_W,
  FINGER_TIP_Z,
  FINGER_X,
  F4_OUTLINE,
  GATE_HOUSES,
  GROUND,
  PLATFORM,
  QUAY_Z,
  TRUCK_BRANCHES,
  TRUCK_PATH,
  YARD_ORDER,
} from "./layout";

// GR-1A: the D-62 spatial contract as versioned, machine-readable data.
//
// CANONICAL FRAME (GR-D8): the SHIPPED WORLD COORDINATES in layout.ts are the
// authority. They were approved under D-62/D-63, are covered by 13 geometry
// tests, and are what the twin renders today. This module does NOT restate them
// — it composes over them, so there is exactly one copy of every coordinate and
// no way for a manifest and a renderer to drift apart. What the manifest adds is
// what layout.ts lacked: a version, the 900×700 preview lineage, the transform
// as executable code rather than a comment, and a tolerance check tying the two
// frames together.
//
// AXIS CONVENTION (pinned): the D-63 transform is authoritative where it
// disagrees with handover.md §2 prose. Preview-Y maps to world-X and preview-X
// maps to negated world-Z — an axis SWAP, not a straight scale:
//
//   world.x =  s · (previewY − originPy)
//   world.z = −s · (previewX − originPx)
//
// The approved north-frame rotation is an implementation transform, not a
// redesign of D-62.

export type PreviewPoint = readonly [px: number, py: number];
export type WorldPoint = { x: number; z: number };

export const D62_TRANSFORM = {
  sourceWidth: 900,
  sourceHeight: 700,
  worldScale: 0.25, // world units per preview px
  originPx: 300, // preview x that maps to world z = 0 (the quay-root line)
  originPy: 347.5, // preview y that maps to world x = 0 (the frame centreline)
  orientation: "north-frame-rotated",
} as const;

/** The single deterministic preview→world transform (D-63). */
export function previewToWorld(point: PreviewPoint): WorldPoint {
  const [px, py] = point;
  const { worldScale, originPx, originPy } = D62_TRANSFORM;
  return { x: worldScale * (py - originPy), z: -worldScale * (px - originPx) };
}

/** Exact inverse, kept reversible for debugging and test snapshots. */
export function worldToPreview(point: WorldPoint): PreviewPoint {
  const { worldScale, originPx, originPy } = D62_TRANSFORM;
  return [-point.z / worldScale + originPx, point.x / worldScale + originPy];
}

// The shipped world constants were snapped to clean numbers when D-63 was
// implemented, so previewToWorld reproduces them only within this tolerance.
// The snap is history, not licence to drift: the tolerance test fails if any
// future edit moves a vertex further than this from its D-62 preview origin.
// 3 world units ≈ 12 preview px ≈ 0.4% of the terminal's 265-unit north-south
// extent — below what the render resolves, above the recorded snapping.
export const SNAP_TOLERANCE_WORLD = 3;

// D-62 preview-frame lineage. These are the approved scaffold coordinates from
// docs/previews/tuas-spatial-preview.svg; they are the ORIGIN of the world
// geometry, never a second source of truth for it.
export const D62_PREVIEW = {
  f4Pentagon: [
    [300, 525], // P1 west root
    [760, 525], // P2 west tip
    [760, 590], // P3 tip east corner
    [560, 665], // P4 apex (east of centre)
    [300, 635], // P5 east root
  ],
  platformInlandXRange: [40, 300],
  fingerRootX: 300,
  f1ToF3TipX: 620,
} as const satisfies { f4Pentagon: readonly PreviewPoint[]; [k: string]: unknown };

export type D62SpatialManifest = {
  layoutId: "D-62";
  version: string;
  transform: typeof D62_TRANSFORM;
  preview: typeof D62_PREVIEW;
  snapToleranceWorld: number;
  world: {
    ground: typeof GROUND;
    platform: typeof PLATFORM;
    quayZ: number;
    fingerTipZ: number;
    fingerHalfW: number;
    fingerX: typeof FINGER_X;
    f4Outline: typeof F4_OUTLINE;
    combOutline: typeof COMB_OUTLINE;
    gateHouses: typeof GATE_HOUSES;
    yardOrder: typeof YARD_ORDER;
    blockW: number;
    blockD: number;
    agvSpine: typeof TRUCK_PATH;
    agvBranches: typeof TRUCK_BRANCHES;
  };
};

export const D62_MANIFEST: D62SpatialManifest = {
  layoutId: "D-62",
  // Bump on any approved geometry change. 1.0.0 = the footprint as shipped
  // under D-62/D-63 and signed off in INT-2.
  version: "1.0.0",
  transform: D62_TRANSFORM,
  preview: D62_PREVIEW,
  snapToleranceWorld: SNAP_TOLERANCE_WORLD,
  world: {
    ground: GROUND,
    platform: PLATFORM,
    quayZ: QUAY_Z,
    fingerTipZ: FINGER_TIP_Z,
    fingerHalfW: FINGER_HALF_W,
    fingerX: FINGER_X,
    f4Outline: F4_OUTLINE,
    combOutline: COMB_OUTLINE,
    gateHouses: GATE_HOUSES,
    yardOrder: YARD_ORDER,
    blockW: BLOCK_W,
    blockD: BLOCK_D,
    agvSpine: TRUCK_PATH,
    agvBranches: TRUCK_BRANCHES,
  },
};

/**
 * How far each shipped F4 vertex sits from the D-62 preview point it came from.
 * Exposed (not just asserted) so the dev inspector can show the lineage.
 */
export function f4SnapDeviations(): { index: number; deviation: number }[] {
  return D62_PREVIEW.f4Pentagon.map((p, index) => {
    const expected = previewToWorld(p);
    const actual = F4_OUTLINE[index];
    return {
      index,
      deviation: Math.hypot(expected.x - actual.x, expected.z - actual.z),
    };
  });
}
