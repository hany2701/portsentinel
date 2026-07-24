import { safetyStockOutlook, type SafetyStockOutlook } from "./derive";
import type { SimState } from "./types";

// Pending-recommendation lifecycle (D-56 freshness). The automatic rule engine
// that lived here (rules.ts) was removed by D-85 (AIF-1): the AI agent
// (propose_action) and the duty manager (proposeUserAction) are the only
// proposers now.

// Shared rationale text (D-56): the per-tick pending-refresh writes it, so the
// displayed numbers always match the effect that executes.
export function safetyStockRationale(o: SafetyStockOutlook): string {
  return `${o.customer.name} has ${o.affectedTEU} TEU of high-priority cargo on delayed vessels — expected delay ${o.expectedDelayDays} d (worst shipment) vs ${o.customer.daysOfCoverRemaining} d of cover (OPS-CARGO §4). Raise safety stock by ${o.shortfallDays} d.`;
}

// D-56 (3) freshness: every tick, pending safety-stock advisories are recomputed
// in place — days, note, rationale and impact — so what the queue displays is
// exactly what approval will execute. Applies to agent AND user recs (the
// quantity has one author; an agent rec's prose is replaced by the calculated
// template rather than drifting from its own number). Customers no longer
// affected are left untouched — approval-time re-validation stays the backstop.
export function refreshSafetyStockRecs(state: SimState): void {
  const outlook = safetyStockOutlook(state);
  for (const rec of state.recommendations) {
    if (rec.status !== "pending" || rec.proposedEffect.kind !== "safetyStockAdvisory") continue;
    const o = outlook.find((x) => x.customer.id === (rec.proposedEffect as { customerId: string }).customerId);
    if (!o) continue;
    rec.proposedEffect = {
      kind: "safetyStockAdvisory",
      customerId: o.customer.id,
      days: o.shortfallDays,
      note: `Raise safety stock by ${o.shortfallDays} days.`,
    };
    rec.rationale = safetyStockRationale(o);
    rec.impact = { teuProtected: o.affectedTEU };
  }
}
