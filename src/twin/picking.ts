import type { EntityRef, EntityType } from "../sim";

// Shared props threaded through the interactive entities so click-to-select and
// hover-highlight behave uniformly. Selection lives in the store; hover is local
// to the scene (transient, per §7 "hover = subtle highlight").
export type PickHandlers = {
  selection: EntityRef | null;
  hoverId: string | null;
  onPick: (ref: EntityRef, double: boolean) => void;
  onHover: (id: string | null) => void;
};

export function isSelected(sel: EntityRef | null, type: EntityType, id: string): boolean {
  return sel?.entityType === type && sel.entityId === id;
}
