import type { EntityRef, Recommendation, SimulationEffect } from "../../sim";
import type { ViewId } from "../../views/registry";
import type { OpsTab } from "../../store/opsStore";

// UIX-1: navigation actions on an assistant turn are derived ONLY from the real
// targets its proposals touch — no fabricated capabilities. Each proposal's
// effect kind maps to the operations tab (or map) that owns it, and carries the
// affected entity so the destination opens focused on it rather than at the top
// of an undifferentiated list.
export type NavAction = { label: string; view: ViewId; tab?: OpsTab; entityRef?: EntityRef };

const KIND_TO_NAV: Record<string, { label: string; view: ViewId; tab?: OpsTab }> = {
  reassignBerth: { label: "View Berth Planning", view: "operations", tab: "berths" },
  closeBerth: { label: "View Berth Planning", view: "operations", tab: "berths" },
  divertVessel: { label: "View Anchorage Queue", view: "operations", tab: "anchorage" },
  holdVessel: { label: "View Anchorage Queue", view: "operations", tab: "anchorage" },
  reallocateYard: { label: "View Yard Control", view: "operations", tab: "yard" },
  safetyStockAdvisory: { label: "View Safety Stock", view: "operations", tab: "safety" },
  // GR-6: a voyage reroute is a maritime-network decision — its home is the map.
  rerouteVoyage: { label: "View on Maritime Map", view: "maritime" },
};

// The entity a proposal is actually about, so navigation can select it.
export function entityRefFor(effect: SimulationEffect): EntityRef | undefined {
  switch (effect.kind) {
    case "reassignBerth":
    case "divertVessel":
    case "holdVessel":
    case "rerouteVoyage":
      return { entityType: "vessel", entityId: effect.vesselId };
    case "closeBerth":
      return { entityType: "berth", entityId: effect.berthId };
    case "reallocateYard":
      return { entityType: "yardBlock", entityId: effect.toBlockId };
    case "safetyStockAdvisory":
      return { entityType: "customer", entityId: effect.customerId };
  }
}

export function navActionsFor(recs: Recommendation[]): NavAction[] {
  const seen = new Set<string>();
  const out: NavAction[] = [];
  for (const r of recs) {
    const nav = KIND_TO_NAV[r.proposedEffect.kind];
    if (nav && !seen.has(nav.label)) {
      seen.add(nav.label);
      out.push({ ...nav, entityRef: entityRefFor(r.proposedEffect) });
    }
  }
  return out;
}
