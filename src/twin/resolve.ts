import { resolveBinding, vesselSlot } from "./bindings";
import type { EntityRef, SimState } from "../sim";

// Entity → world placement. The mapping itself now lives in the D-62 binding
// registry (bindings.ts) so it is enumerable and testable for completeness;
// this module keeps the call sites' existing surface.

export { vesselSlot };

// Reverse-lookup an entity ref from a bare id (hover carries only the id).
export function findRef(sim: SimState, id: string | null): EntityRef | null {
  if (!id) return null;
  if (sim.vessels.some((v) => v.id === id)) return { entityType: "vessel", entityId: id };
  if (sim.berths.some((b) => b.id === id)) return { entityType: "berth", entityId: id };
  if (sim.cranes.some((c) => c.id === id)) return { entityType: "crane", entityId: id };
  if (sim.yardBlocks.some((b) => b.id === id)) return { entityType: "yardBlock", entityId: id };
  return null;
}

// A world-space anchor above an entity, used for hover/selection labels and the
// double-click focus tween. Returns null if the entity can't be placed.
export function entityAnchor(sim: SimState, ref: EntityRef): [number, number, number] | null {
  return resolveBinding(sim, ref);
}
