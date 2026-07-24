import { describe, it, expect } from "vitest";
import { navActionsFor, entityRefFor } from "./navActions";
import type { Recommendation, SimulationEffect } from "../../sim";

// UIX-1/UIX-2 coverage: a recommendation must deep-link to the surface that
// owns it AND carry the affected entity, so the destination opens focused.

const KIND_TO_TYPE: Record<SimulationEffect["kind"], Recommendation["type"]> = {
  reassignBerth: "reberth",
  divertVessel: "reroute",
  holdVessel: "hold",
  reallocateYard: "yardRealloc",
  closeBerth: "reberth",
  safetyStockAdvisory: "safetyStock",
  rerouteVoyage: "reroute",
};

function rec(effect: SimulationEffect): Recommendation {
  return {
    id: `REC-${effect.kind}`,
    source: "agent",
    type: KIND_TO_TYPE[effect.kind],
    title: effect.kind,
    rationale: "test",
    impact: {},
    proposedEffect: effect,
    validationStatus: "valid",
    status: "pending",
    createdTick: 1,
    provenance: "ai_generated",
  };
}

describe("chat navigation deep links", () => {
  it("routes a voyage reroute to the maritime map (previously an unmapped gap)", () => {
    const [nav] = navActionsFor([
      rec({ kind: "rerouteVoyage", vesselId: "V-1", toNodeIds: ["A", "B"], reason: "weather" }),
    ]);
    expect(nav.view).toBe("maritime");
    expect(nav.entityRef).toEqual({ entityType: "vessel", entityId: "V-1" });
  });

  it("routes a safety-stock advisory to the Safety Stock tab focused on the customer", () => {
    const [nav] = navActionsFor([rec({ kind: "safetyStockAdvisory", customerId: "C-9", days: 3 })]);
    expect(nav.view).toBe("operations");
    expect(nav.tab).toBe("safety");
    expect(nav.entityRef).toEqual({ entityType: "customer", entityId: "C-9" });
  });

  it("routes a re-berth to Berth Planning focused on the vessel", () => {
    const [nav] = navActionsFor([rec({ kind: "reassignBerth", vesselId: "V-2", toBerthId: "B6" })]);
    expect(nav.tab).toBe("berths");
    expect(nav.entityRef).toEqual({ entityType: "vessel", entityId: "V-2" });
  });

  it("maps every effect kind to an entity so no deep link lands unfocused", () => {
    const effects: SimulationEffect[] = [
      { kind: "reassignBerth", vesselId: "V", toBerthId: "B" },
      { kind: "divertVessel", vesselId: "V", toPortId: "P" },
      { kind: "holdVessel", vesselId: "V", untilTick: 5 },
      { kind: "reallocateYard", lotIds: ["L"], toBlockId: "Y1" },
      { kind: "closeBerth", berthId: "B2" },
      { kind: "safetyStockAdvisory", customerId: "C", days: 2 },
      { kind: "rerouteVoyage", vesselId: "V", toNodeIds: ["A", "B"], reason: "weather" },
    ];
    for (const e of effects) expect(entityRefFor(e)).toBeDefined();
  });

  it("does not duplicate a destination when several proposals share it", () => {
    const navs = navActionsFor([
      rec({ kind: "holdVessel", vesselId: "V-1", untilTick: 5 }),
      rec({ kind: "divertVessel", vesselId: "V-2", toPortId: "P-1" }),
    ]);
    expect(navs).toHaveLength(1);
  });
});
