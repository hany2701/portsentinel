// INT-2 twin-geometry tests (D-63; extends D-46's sim-core test policy per the
// approved ruling). Pure TS on layout.ts — no R3F/rendering involved.
import { describe, it, expect } from "vitest";
import { generateWorld } from "../sim/worldGen";
import {
  BLOCK_W,
  BLOCK_D,
  COMB_OUTLINE,
  F4_OUTLINE,
  FINGER_HALF_W,
  FINGER_TIP_Z,
  FINGER_X,
  GROUND,
  MAX_VESSEL_LEN,
  PLATFORM,
  QUAY_Z,
  TRUCK_BRANCHES,
  YARD_ORDER,
  anchorageSlot,
  approachSlot,
  berthLayout,
  berthVesselSlot,
  divertSlot,
  fingerBox,
  stsCraneSlot,
  validateLayout,
  yardBlockBox,
} from "./layout";

describe("Tuas footprint (D-62/D-63)", () => {
  it("validateLayout passes on the shipped layout", () => {
    expect(() => validateLayout()).not.toThrow();
  });

  it("berthLayout west/east matches worldGen side for all 12 berths", () => {
    const world = generateWorld(20260710);
    for (const b of world.berths) {
      expect(berthLayout(b.id).west ? "west" : "east").toBe(b.side);
    }
  });

  it("12 berths resolve onto their finger's quay faces", () => {
    for (let n = 1; n <= 12; n++) {
      const lay = berthLayout(`B${n}`);
      const fi = Math.floor((n - 1) / 3);
      expect(lay.fingerX).toBe(FINGER_X[fi]);
      expect(Math.abs(lay.faceX - lay.fingerX)).toBe(FINGER_HALF_W);
      expect(lay.z).toBeLessThan(QUAY_Z);
    }
  });

  it("yard blocks sit inside the platform, never on a finger, no overlaps", () => {
    for (const id of YARD_ORDER) {
      const b = yardBlockBox(id);
      expect(b.x - b.w / 2).toBeGreaterThanOrEqual(PLATFORM.minX);
      expect(b.x + b.w / 2).toBeLessThanOrEqual(PLATFORM.maxX);
      expect(b.z - b.d / 2).toBeGreaterThanOrEqual(PLATFORM.minZ);
      expect(b.z + b.d / 2).toBeLessThanOrEqual(PLATFORM.maxZ);
      // Fingers all lie north of the quay root; blocks south of it.
      expect(b.z - b.d / 2).toBeGreaterThanOrEqual(QUAY_Z);
      expect(b.w).toBe(BLOCK_W);
      expect(b.d).toBe(BLOCK_D);
    }
    // Hazmat YB-H in the far SE corner; reefer YB-A/B on the near-quay row.
    expect(yardBlockBox("YB-H").z).toBeGreaterThan(yardBlockBox("YB-A").z);
    expect(yardBlockBox("YB-H").x).toBe(Math.max(...YARD_ORDER.map((b) => yardBlockBox(b).x)));
  });

  it("same-face berth spacing exceeds the largest hull plus clearance", () => {
    // West-face pairs on F1–F3 and the three F4 berths.
    const b1 = berthLayout("B1").z;
    const b2 = berthLayout("B2").z;
    expect(Math.abs(b1 - b2)).toBeGreaterThanOrEqual(MAX_VESSEL_LEN + 4);
    const f4 = ["B10", "B11", "B12"].map((b) => berthLayout(b).z).sort((a, b) => a - b);
    expect(f4[1] - f4[0]).toBeGreaterThanOrEqual(MAX_VESSEL_LEN + 4);
    expect(f4[2] - f4[1]).toBeGreaterThanOrEqual(MAX_VESSEL_LEN + 4);
  });

  it("opposing hulls across a basin stagger — z-spans never overlap", () => {
    // B3 (F1 east face) faces B4/B5 (F2 west face) across basin 1.
    const east = berthVesselSlot("B3");
    for (const wid of ["B4", "B5"]) {
      const west = berthVesselSlot(wid);
      const gap = Math.abs(east.z - west.z);
      expect(gap).toBeGreaterThanOrEqual(MAX_VESSEL_LEN); // spans disjoint
    }
  });

  it("berthed vessels lie in open water clear of every finger footprint", () => {
    for (let n = 1; n <= 12; n++) {
      const slot = berthVesselSlot(`B${n}`);
      for (const fid of ["F1", "F2", "F3", "F4"]) {
        const f = fingerBox(fid);
        const insideX = Math.abs(slot.x - f.x) * 2 < f.w;
        const insideZ = Math.abs(slot.z - f.z) * 2 < f.d;
        expect(insideX && insideZ).toBe(false);
      }
    }
  });

  it("STS cranes sit on the quay face within their finger's length", () => {
    for (let n = 1; n <= 12; n++) {
      const lay = berthLayout(`B${n}`);
      const zMin = n > 9 ? -115 : FINGER_TIP_Z;
      for (const i of [0, 1]) {
        const s = stsCraneSlot(`B${n}`, i);
        expect(s.x).toBe(lay.faceX);
        expect(s.z).toBeGreaterThanOrEqual(zMin);
        expect(s.z).toBeLessThanOrEqual(QUAY_Z);
      }
    }
  });

  it("anchorage is offshore, seaward of the tips, with no hull overlap", () => {
    for (let rank = 0; rank < 10; rank++) {
      const s = anchorageSlot(rank);
      expect(s.z).toBeLessThan(FINGER_TIP_Z - 10); // well beyond the tips
      expect(s.x).toBeGreaterThanOrEqual(GROUND.minX);
      expect(s.x).toBeLessThanOrEqual(GROUND.maxX);
      expect(s.z).toBeGreaterThanOrEqual(GROUND.minZ);
    }
    // Row pitch (bow-to-stern) must exceed the longest hull + clearance.
    expect(Math.abs(anchorageSlot(0).z - anchorageSlot(3).z)).toBeGreaterThanOrEqual(MAX_VESSEL_LEN + 4);
    // Column pitch (beam-to-beam) must exceed two beams.
    expect(Math.abs(anchorageSlot(1).x - anchorageSlot(0).x)).toBeGreaterThanOrEqual(6);
  });

  it("approach and divert slots stay in open water inside GROUND", () => {
    for (let rank = 0; rank < 8; rank++) {
      for (const s of [approachSlot(rank), divertSlot(rank)]) {
        expect(s.x).toBeGreaterThanOrEqual(GROUND.minX);
        expect(s.x).toBeLessThanOrEqual(GROUND.maxX);
        expect(s.z).toBeGreaterThanOrEqual(GROUND.minZ);
        expect(s.z).toBeLessThanOrEqual(GROUND.maxZ);
        // Clear of the platform (the only land south of the quay root).
        const onPlatform = s.x >= PLATFORM.minX && s.x <= PLATFORM.maxX && s.z >= PLATFORM.minZ && s.z <= PLATFORM.maxZ;
        expect(onPlatform).toBe(false);
      }
    }
  });

  it("F4 pentagon: 5 vertices, apex east of centre, flat backland", () => {
    expect(F4_OUTLINE).toHaveLength(5);
    const apex = F4_OUTLINE.reduce((m, v) => (v.x > m.x ? v : m));
    expect(apex.x).toBeGreaterThan(FINGER_X[3]);
    expect(apex.z).toBeLessThan(QUAY_Z);
    expect(apex.z).toBeGreaterThan(-115);
    // Taper never cuts south of the quay root (platform/yard stays intact).
    for (const v of F4_OUTLINE) expect(v.z).toBeLessThanOrEqual(QUAY_Z);
  });

  it("comb outline is one continuous polygon containing all four fingers", () => {
    expect(COMB_OUTLINE.length).toBeGreaterThanOrEqual(18);
    // Every finger tip x-range appears at tip depth in the outline.
    for (const fid of ["F1", "F2", "F3"]) {
      const f = fingerBox(fid);
      const tipVerts = COMB_OUTLINE.filter((v) => v.z === FINGER_TIP_Z && Math.abs(v.x - f.x) <= f.w / 2);
      expect(tipVerts.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("AGV branches reach up each finger and stay within it", () => {
    expect(TRUCK_BRANCHES).toHaveLength(4);
    TRUCK_BRANCHES.forEach((branch, i) => {
      const f = fingerBox(`F${i + 1}`);
      expect(Math.min(...branch.map((p) => p.z))).toBeLessThan(-40);
      for (const p of branch) {
        if (p.z < QUAY_Z) {
          expect(p.x).toBeGreaterThanOrEqual(f.x - f.w / 2);
          expect(p.x).toBeLessThanOrEqual(f.x + f.w / 2);
        }
      }
    });
  });
});
