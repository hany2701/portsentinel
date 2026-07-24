import { anchorageQueue } from "../sim";
import { isHandoverTick, openHandover } from "../sim/maritimeStep";
import type { EntityRef, EntityType, SimState, Vessel, VesselStatus } from "../sim";
import {
  APPROACH_ENTRY,
  anchorageSlot,
  approachSlot,
  berthLayout,
  berthVesselSlot,
  departureSlot,
  divertSlot,
  rtgCraneSlot,
  stsCraneSlot,
  yardBlockBox,
  type Slot,
} from "./layout";

// GR-1A: the entity-to-spatial binding registry (§5B.5).
//
// Before this, placement was implicit: components and entityAnchor each called
// whichever layout function matched an id, and the coupling between an entity's
// generation order in worldGen and its position was undocumented. This module
// makes the binding explicit and enumerable, so a mapping-completeness test can
// assert that EVERY operational entity resolves to a spatial feature — and so a
// missing binding fails loudly instead of rendering at the origin.
//
// The registry describes bindings; it does not re-derive geometry. Every
// resolver below delegates to layout.ts, which stays the canonical world frame
// (GR-D8). Components must never infer placement from array order.

export type SpatialResolver =
  | "berthQuayFace"
  | "berthVesselSlot"
  | "yardBlockBox"
  | "stsCraneSlot"
  | "rtgCraneSlot"
  | "gateHouse"
  | "anchorageSlot"
  | "approachSlot"
  | "divertSlot"
  | "departureSlot"
  | "none";

export type SpatialBinding = {
  entityType: EntityType;
  // For vessels the resolver depends on operational status, so the binding is a
  // map rather than a single value.
  resolver: SpatialResolver | Record<VesselStatus, SpatialResolver>;
  // Label/focus height above the feature, in world units.
  anchorHeight: number;
  note?: string;
};

// A vessel's spatial home follows its status. "enroute" resolves to nothing:
// those vessels are owned by the maritime engine in the lat/long frame and are
// never placed in the D-62 world (GR-D6 keeps the frames separate).
export const VESSEL_STATUS_RESOLVERS: Record<VesselStatus, SpatialResolver> = {
  enroute: "none",
  approaching: "approachSlot",
  anchored: "anchorageSlot",
  berthing: "berthVesselSlot",
  alongside: "berthVesselSlot",
  // A departing vessel has already had its berthId cleared by the tick, so a
  // berth-bound resolver could only ever return null and the ship vanished off
  // the quay. It now steams out through its own lane.
  departing: "departureSlot",
  diverted: "divertSlot",
};

export const SPATIAL_BINDINGS: readonly SpatialBinding[] = [
  { entityType: "berth", resolver: "berthQuayFace", anchorHeight: 3.2, note: "B1–B12 on their finger's quay face" },
  { entityType: "yardBlock", resolver: "yardBlockBox", anchorHeight: 6.5, note: "YB-A–YB-H, inland platform only" },
  { entityType: "crane", resolver: "stsCraneSlot", anchorHeight: 9, note: "STS on quay edges; RTG inside yard blocks (kind selects)" },
  {
    entityType: "gate",
    resolver: "gateHouse",
    anchorHeight: 5,
    // D-63 ruling 3: three visual gate houses over one logical GATE-1 entity.
    note: "3 visual anchors, 1 logical entity",
  },
  { entityType: "vessel", resolver: VESSEL_STATUS_RESOLVERS, anchorHeight: 3.5 },
  // Non-spatial entities: they exist in the operational model but have no place
  // in the terminal geometry. Listed so the completeness test is exhaustive
  // rather than silently skipping them.
  { entityType: "cargoLot", resolver: "none", anchorHeight: 0, note: "located via its yard block" },
  { entityType: "customer", resolver: "none", anchorHeight: 0, note: "commercial entity, not spatial" },
  { entityType: "portHub", resolver: "none", anchorHeight: 0, note: "lives in the geographic frame, not D-62" },
] as const;

const BINDING_BY_TYPE = new Map(SPATIAL_BINDINGS.map((b) => [b.entityType, b]));

export function bindingFor(entityType: EntityType): SpatialBinding | undefined {
  return BINDING_BY_TYPE.get(entityType);
}

/** Which resolver a vessel currently binds to — the status-driven lookup. */
export function vesselResolver(v: Vessel): SpatialResolver {
  return VESSEL_STATUS_RESOLVERS[v.status];
}

/**
 * The world slot a vessel occupies. Shared by <Vessels> and the label/focus
 * resolver so both agree; null when the vessel has no place in this frame.
 */
export function vesselSlot(sim: SimState, v: Vessel): Slot | null {
  // GR-3: on the tick a vessel crosses into this frame it sits at the approved
  // approach entry anchor — oriented by the approach path's tangent, not by the
  // geographic heading it arrived with. It joins the normal approach queue from
  // the next tick, so no engine moves it during the crossing.
  if (isHandoverTick(sim, v.id)) {
    const handover = openHandover(sim, v.id);
    if (handover?.direction === "regional_to_tuas") return APPROACH_ENTRY;
  }

  switch (vesselResolver(v)) {
    case "berthVesselSlot":
      return v.berthId ? berthVesselSlot(v.berthId) : null;
    case "anchorageSlot":
      return anchorageSlot(anchorageQueue(sim).indexOf(v));
    case "approachSlot": {
      const list = sim.vessels
        .filter((x) => x.status === "approaching")
        .sort((a, b) => a.etaTick - b.etaTick);
      return approachSlot(list.indexOf(v));
    }
    case "divertSlot": {
      const list = sim.vessels.filter((x) => x.status === "diverted");
      return divertSlot(list.indexOf(v));
    }
    case "departureSlot": {
      const list = sim.vessels.filter((x) => x.status === "departing");
      return departureSlot(list.indexOf(v));
    }
    default:
      return null;
  }
}

/**
 * Resolve an entity to a world-space anchor for hover/selection labels and the
 * double-click focus tween. Returns null when the entity cannot be placed —
 * either because it does not exist, or because its type has no D-62 binding.
 */
export function resolveBinding(sim: SimState, ref: EntityRef): [number, number, number] | null {
  const binding = bindingFor(ref.entityType);
  if (!binding) return null;

  switch (ref.entityType) {
    case "berth": {
      const berth = sim.berths.find((x) => x.id === ref.entityId);
      if (!berth) return null;
      const lay = berthLayout(berth.id);
      return [lay.faceX, binding.anchorHeight, lay.z];
    }
    case "yardBlock": {
      if (!sim.yardBlocks.some((x) => x.id === ref.entityId)) return null;
      const box = yardBlockBox(ref.entityId);
      return [box.x, binding.anchorHeight, box.z];
    }
    case "crane": {
      const crane = sim.cranes.find((x) => x.id === ref.entityId);
      if (!crane) return null;
      if (crane.kind === "STS") {
        const berth = sim.berths.find((b) => b.id === crane.locationId);
        const idx = berth ? berth.craneIds.indexOf(crane.id) : 0;
        const slot = stsCraneSlot(crane.locationId, Math.max(0, idx));
        return [slot.x, 9, slot.z];
      }
      const block = sim.yardBlocks.find((b) => b.id === crane.locationId);
      const idx = block ? block.craneIds.indexOf(crane.id) : 0;
      const slot = rtgCraneSlot(crane.locationId, Math.max(0, idx));
      return [slot.x, 6, slot.z];
    }
    case "vessel": {
      const vessel = sim.vessels.find((x) => x.id === ref.entityId);
      if (!vessel) return null;
      const slot = vesselSlot(sim, vessel);
      return slot ? [slot.x, binding.anchorHeight, slot.z] : null;
    }
    default:
      return null;
  }
}
