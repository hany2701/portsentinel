import type { EntityRef, SimState } from "../../sim";
import type { OpsTab } from "../../store/opsStore";

// Deterministic Twin → Operations routing. An entity may be relevant to several
// operational domains; this returns every valid destination (primary first) so
// the Digital Twin inspector can offer the choice. Empty means "no Operations
// destination" (e.g. cranes) — the inspector hides the action.
export type OpsDestination = { tab: OpsTab; label: string };

const BERTH_PLANNING: OpsDestination = { tab: "berths", label: "Berth Planning" };
const YARD_CONTROL: OpsDestination = { tab: "yard", label: "Yard Control" };
const ANCHORAGE_QUEUE: OpsDestination = { tab: "anchorage", label: "Anchorage Queue" };
const CARGO_AT_RISK: OpsDestination = { tab: "cargo", label: "Cargo at Risk" };

export function operationsDestinations(sim: SimState, ref: EntityRef): OpsDestination[] {
  switch (ref.entityType) {
    case "berth":
      return [BERTH_PLANNING];
    case "yardBlock":
      return [YARD_CONTROL];
    case "cargoLot":
      return [CARGO_AT_RISK];
    case "vessel": {
      const v = sim.vessels.find((x) => x.id === ref.entityId);
      if (!v) return [];
      switch (v.status) {
        // Waiting vessel: primarily a queue entry, and also projected onto a
        // berth in the schedule board — both are valid domains.
        case "anchored":
          return [ANCHORAGE_QUEUE, BERTH_PLANNING];
        // Vessels expected to interact with berth operations.
        case "approaching":
        case "berthing":
        case "alongside":
        case "departing":
          return [BERTH_PLANNING];
        // Diverted vessels introduce operational/cargo risk.
        case "diverted":
          return [CARGO_AT_RISK];
      }
      return [];
    }
    // crane, gate, customer: no operational tab is entity-specific.
    default:
      return [];
  }
}
