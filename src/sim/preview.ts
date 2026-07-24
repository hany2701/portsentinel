import { clone, tick } from "./tick";
import { validateEffect } from "./validators";
import { applyEffect } from "./effects";
import { computeKpis } from "./resilience";
import type { KpiSnapshot, SimState, SimulationEffect } from "./types";

export type PreviewResult = {
  without: KpiSnapshot;
  withEffect: KpiSnapshot;
  valid: boolean;
  message: string;
  horizonTicks: number;
  // A safety-stock advisory changes a customer's inventory buffer, not any port
  // KPI, so the KPI table above is identical with/without. This carries the field
  // the action actually moves — the customer's days of cover — so the preview
  // reflects a real effect. Present only for safetyStockAdvisory effects.
  coverDelta?: { customerName: string; beforeDays: number; afterDays: number };
};

/**
 * What-if preview (D-50). Runs the simulation `horizonTicks` ahead twice — once
 * leaving the effect out, once applying it first — on throwaway clones, and
 * returns the resulting KPIs of each branch. The passed state is never mutated.
 */
export function previewEffect(
  state: SimState,
  effect: SimulationEffect,
  horizonTicks: number,
): PreviewResult {
  let base = state;
  for (let i = 0; i < horizonTicks; i++) base = tick(base);
  const without = computeKpis(base);

  const validation = validateEffect(state, effect);
  if (validation.status !== "valid") {
    return { without, withEffect: without, valid: false, message: validation.message, horizonTicks };
  }

  let branch = clone(state);
  applyEffect(branch, effect);
  for (let i = 0; i < horizonTicks; i++) branch = tick(branch);
  const withEffect = computeKpis(branch);

  // Read the moved field from the same two ticked branches the KPIs come from, so
  // "without" and "with" stay consistent with the table above.
  let coverDelta: PreviewResult["coverDelta"];
  if (effect.kind === "safetyStockAdvisory") {
    const before = base.customers.find((c) => c.id === effect.customerId);
    const after = branch.customers.find((c) => c.id === effect.customerId);
    if (before && after) {
      coverDelta = { customerName: before.name, beforeDays: before.daysOfCoverRemaining, afterDays: after.daysOfCoverRemaining };
    }
  }

  return { without, withEffect, valid: true, message: "OK", horizonTicks, coverDelta };
}
