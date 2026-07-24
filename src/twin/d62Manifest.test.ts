import { describe, expect, it } from "vitest";
import { generateWorld } from "../sim";
import type { EntityRef, VesselStatus } from "../sim";
import {
  D62_MANIFEST,
  D62_PREVIEW,
  SNAP_TOLERANCE_WORLD,
  f4SnapDeviations,
  previewToWorld,
  worldToPreview,
} from "./d62Manifest";
import {
  SPATIAL_BINDINGS,
  VESSEL_STATUS_RESOLVERS,
  bindingFor,
  resolveBinding,
  vesselSlot,
} from "./bindings";
import { F4_OUTLINE, FINGER_TIP_Z, FINGER_X, GROUND, QUAY_Z, fingerBox } from "./layout";

describe("D-62 preview↔world transform (GR-1A)", () => {
  it("maps every D-62 pentagon point onto its shipped world vertex within tolerance", () => {
    // The world constants were snapped when D-63 landed, so this is a bounded
    // agreement, not an identity — the bound is what stops future drift.
    for (const { index, deviation } of f4SnapDeviations()) {
      expect(deviation, `F4 P${index + 1} drifted ${deviation.toFixed(3)} from its D-62 origin`)
        .toBeLessThanOrEqual(SNAP_TOLERANCE_WORLD);
    }
  });

  it("round-trips world→preview→world exactly", () => {
    for (const point of D62_PREVIEW.f4Pentagon) {
      const back = worldToPreview(previewToWorld(point));
      expect(back[0]).toBeCloseTo(point[0], 10);
      expect(back[1]).toBeCloseTo(point[1], 10);
    }
    for (const vertex of F4_OUTLINE) {
      const back = previewToWorld(worldToPreview(vertex));
      expect(back.x).toBeCloseTo(vertex.x, 10);
      expect(back.z).toBeCloseTo(vertex.z, 10);
    }
  });

  it("pins the D-63 axis swap, not a straight scale", () => {
    // Preview-Y drives world-X; preview-X drives negated world-Z. Getting this
    // backwards is the handover.md §2 discrepancy the manifest exists to settle.
    const originOnly = previewToWorld([D62_MANIFEST.transform.originPx, D62_MANIFEST.transform.originPy]);
    expect(originOnly).toEqual({ x: 0, z: -0 });
    const eastward = previewToWorld([300, 447.5]); // +100 preview-y
    expect(eastward.x).toBe(25); // → +x (east)
    expect(eastward.z).toBe(-0);
    const northward = previewToWorld([400, 347.5]); // +100 preview-x
    expect(northward.z).toBe(-25); // → −z (north)
    expect(northward.x).toBe(0);
  });

  it("declares the approved D-62 preview frame", () => {
    expect(D62_MANIFEST.layoutId).toBe("D-62");
    expect(D62_MANIFEST.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(D62_MANIFEST.transform.sourceWidth).toBe(900);
    expect(D62_MANIFEST.transform.sourceHeight).toBe(700);
    expect(D62_PREVIEW.f4Pentagon).toEqual([
      [300, 525], [760, 525], [760, 590], [560, 665], [300, 635],
    ]);
  });
});

describe("D-62 locked structure via the manifest (GR-1A)", () => {
  it("exposes the shipped world geometry as the canonical frame", () => {
    // The manifest composes over layout.ts rather than restating it, so there is
    // exactly one copy of every coordinate. This asserts the wiring is intact.
    expect(D62_MANIFEST.world.f4Outline).toBe(F4_OUTLINE);
    expect(D62_MANIFEST.world.fingerX).toBe(FINGER_X);
    expect(D62_MANIFEST.world.ground).toBe(GROUND);
    expect(D62_MANIFEST.world.quayZ).toBe(QUAY_Z);
  });

  it("keeps F1–F3 at equal seaward reach", () => {
    const reaches = ["F1", "F2", "F3"].map((f) => Math.abs(fingerBox(f).z - fingerBox(f).d / 2));
    expect(new Set(reaches).size).toBe(1);
    expect(fingerBox("F1").d).toBe(fingerBox("F2").d);
    expect(fingerBox("F2").d).toBe(fingerBox("F3").d);
  });

  it("keeps F4 a five-sided pentagon and the longest finger", () => {
    expect(D62_MANIFEST.world.f4Outline).toHaveLength(5);
    expect(fingerBox("F4").d).toBeGreaterThan(fingerBox("F1").d);
    expect(Math.abs(FINGER_TIP_Z)).toBeLessThan(fingerBox("F4").d);
  });

  it("keeps three gate anchors over one logical gate", () => {
    expect(D62_MANIFEST.world.gateHouses).toHaveLength(3);
    expect(bindingFor("gate")?.note).toContain("1 logical entity");
  });

  it("keeps eight inland yard blocks and one AGV branch per finger", () => {
    expect(D62_MANIFEST.world.yardOrder).toHaveLength(8);
    expect(D62_MANIFEST.world.agvBranches).toHaveLength(4);
  });
});

describe("entity-to-spatial binding registry (GR-1A)", () => {
  const sim = generateWorld(20260710);

  it("binds every operational entity type exactly once", () => {
    const types = SPATIAL_BINDINGS.map((b) => b.entityType);
    expect(new Set(types).size).toBe(types.length);
    for (const type of ["vessel", "berth", "yardBlock", "crane", "gate", "cargoLot", "customer", "portHub"] as const) {
      expect(bindingFor(type), `no binding declared for ${type}`).toBeDefined();
    }
  });

  it("resolves every berth, yard block and crane to a world anchor", () => {
    for (const berth of sim.berths) {
      expect(resolveBinding(sim, { entityType: "berth", entityId: berth.id }), berth.id).not.toBeNull();
    }
    for (const block of sim.yardBlocks) {
      expect(resolveBinding(sim, { entityType: "yardBlock", entityId: block.id }), block.id).not.toBeNull();
    }
    for (const crane of sim.cranes) {
      expect(resolveBinding(sim, { entityType: "crane", entityId: crane.id }), crane.id).not.toBeNull();
    }
    expect(sim.berths).toHaveLength(12);
    expect(sim.yardBlocks).toHaveLength(8);
    expect(sim.cranes).toHaveLength(40);
  });

  it("places every genesis vessel that belongs in the D-62 frame", () => {
    // Every Tuas-baseline vessel must resolve. This previously tolerated one
    // that could not — the genesis DEPARTING vessel (V-144), which holds no
    // berthId and so returned null from the berth-bound resolver, vanishing
    // from the twin. That was not a genesis quirk: tick.ts clears berthId at
    // the instant it sets the departing status, so EVERY departing vessel hit
    // it. Departures now bind to their own outbound lane, so nothing in this
    // frame is unplaceable.
    const unplaceable: string[] = [];
    // Only the Tuas baseline belongs to this frame; tracked maritime vessels are
    // asserted to resolve to nothing in the enroute test below.
    for (const vessel of sim.vessels.filter((v) => v.scope === undefined)) {
      const anchor = resolveBinding(sim, { entityType: "vessel", entityId: vessel.id });
      const berthBound = VESSEL_STATUS_RESOLVERS[vessel.status] === "berthVesselSlot";
      if (berthBound && !vessel.berthId) {
        unplaceable.push(vessel.id);
        continue;
      }
      expect(anchor, `${vessel.id} (${vessel.status}) has no anchor`).not.toBeNull();
    }
    expect(unplaceable, "no baseline vessel may be unplaceable").toEqual([]);
  });

  it("keeps a departing vessel visible once it leaves the berth", () => {
    // The regression this guards: a vessel finishing its call had its berthId
    // cleared and its slot resolve to null, so it disappeared off the quay
    // instead of steaming out. It must resolve to a slot in open water, clear
    // of the berth it just left.
    const alongside = sim.vessels.find((v) => v.status === "alongside" && v.berthId)!;
    const berthAnchor = resolveBinding(sim, { entityType: "vessel", entityId: alongside.id })!;
    expect(berthAnchor).not.toBeNull();

    // Exactly what tick.ts does when the call completes.
    const departing = { ...alongside, status: "departing" as const, berthId: undefined };
    const state = { ...sim, vessels: sim.vessels.map((v) => (v.id === alongside.id ? departing : v)) };

    const anchor = resolveBinding(state, { entityType: "vessel", entityId: alongside.id });
    expect(anchor, "a departing vessel must still be placeable").not.toBeNull();
    expect(anchor![0]).not.toBeCloseTo(berthAnchor[0], 1);
  });

  it("declares a resolver for every vessel status, and none for enroute", () => {
    const statuses: VesselStatus[] = [
      "enroute", "approaching", "anchored", "berthing", "alongside", "departing", "diverted",
    ];
    for (const status of statuses) {
      expect(VESSEL_STATUS_RESOLVERS[status], `no resolver for ${status}`).toBeDefined();
    }
    // Enroute vessels live in the lat/long frame; placing them in D-62 would be
    // exactly the frame-mixing GR-D6 forbids.
    expect(VESSEL_STATUS_RESOLVERS.enroute).toBe("none");
    const enroute = { ...sim.vessels[0], id: "V-TRACKED", status: "enroute" as const, berthId: undefined };
    const withEnroute = { ...sim, vessels: [...sim.vessels, enroute] };
    expect(vesselSlot(withEnroute, enroute)).toBeNull();
    expect(resolveBinding(withEnroute, { entityType: "vessel", entityId: "V-TRACKED" })).toBeNull();
  });

  it("returns null for unknown ids rather than a default position", () => {
    const missing: EntityRef[] = [
      { entityType: "berth", entityId: "B-NOPE" },
      { entityType: "crane", entityId: "STS-NOPE" },
      { entityType: "vessel", entityId: "V-NOPE" },
      { entityType: "yardBlock", entityId: "YB-NOPE" },
      { entityType: "portHub", entityId: "PORT-TUAS" }, // real id, but not a D-62 entity
    ];
    for (const ref of missing) expect(resolveBinding(sim, ref), ref.entityId).toBeNull();
  });
});
