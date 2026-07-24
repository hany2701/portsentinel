import { anchorageQueue, berthOptions, projectedBerthWaitHours, ticksToHours, type BerthOption } from "../sim";
import { TICK_SIM_MINUTES } from "../sim/config";
import { activePlanFor, originalPlanFor } from "./selectors";
import { TUAS_PORT_ID } from "./ports";
import type { SimState, Vessel } from "../sim";

// MDS-5 (D-94): what an approved maritime decision actually does to Tuas.
//
// This is the end of the brief's §3 chain — reroute approved → arrival shifts →
// anchorage demand changes → berth window changes — and it is deliberately a
// SUMMARY, not a second terminal model. The brief's §7 ownership rule is
// explicit: the Maritime Network summarises downstream impact, the Digital Twin
// owns terminal execution. So every figure here is composed from derivations
// that already exist in sim/derive.ts; nothing new is modelled.
//
// Why this matters more than the KPI preview: previewing a hold on one deep-sea
// vessel moves port-wide resilience by 0, which is true but useless. The
// decision-relevant consequence is this vessel's own arrival and the queue it
// joins.

export type TuasImpact = {
  /** Arrival at Tuas from the active plan, in ticks. Null once it has arrived. */
  revisedArrivalTick: number | null;
  /** The first plan's ETA, when a later decision superseded it. */
  originalArrivalTick: number | null;
  /** Positive = arriving later than originally planned. */
  arrivalShiftTicks: number | null;
  /** Projected wait at the anchorage, in hours (calculated, D-55). */
  anchorageWaitHours: number;
  /** Vessels already waiting for a berth ahead of this one. */
  queueAhead: number;
  /** Suitable berths, earliest-free first. Options at the CURRENT state — berth
   *  assignment happens on arrival, so this is not a committed allocation. */
  berths: BerthOption[];
  /** No suitable berth exists at all (deep-water or closure constraints). */
  berthConflict: boolean;
};

/**
 * The Tuas consequence of this vessel's situation, or null if it has none.
 *
 * Null is the honest answer for a vessel with no Tuas relationship — a
 * Rotterdam-bound ship crossing the Indian Ocean has no berth window here, and
 * inventing one would be exactly the fabrication the brief's §6.3 forbids.
 */
export function tuasImpact(sim: SimState, vessel: Vessel): TuasImpact | null {
  const boundForTuas = vessel.destinationPortId === TUAS_PORT_ID;
  const insideTuasFrame = vessel.status !== "enroute";
  if (!boundForTuas && !insideTuasFrame) return null;

  const active = activePlanFor(sim, vessel.id);
  const original = originalPlanFor(sim, vessel.id);

  const revisedArrivalTick = active?.etaTick ?? null;
  // Only a genuine supersession counts as a shift: the same plan compared with
  // itself is not a change, and would show a spurious "+0 h" on every vessel.
  const superseded = active && original && active.id !== original.id ? original : null;
  const originalArrivalTick = superseded?.etaTick ?? null;
  const arrivalShiftTicks =
    revisedArrivalTick !== null && originalArrivalTick !== null
      ? revisedArrivalTick - originalArrivalTick
      : null;

  const options = berthOptions(sim, vessel);

  return {
    revisedArrivalTick,
    originalArrivalTick,
    arrivalShiftTicks,
    anchorageWaitHours: projectedBerthWaitHours(sim, vessel),
    // A vessel already anchored is IN the queue, so it does not wait behind
    // itself; anything still inbound joins the back of it.
    queueAhead:
      vessel.status === "anchored"
        ? Math.max(0, anchorageQueue(sim).findIndex((v) => v.id === vessel.id))
        : anchorageQueue(sim).length,
    berths: options,
    berthConflict: options.length === 0,
  };
}

/** Arrival shift in hours, signed. Convenience for display. */
export function arrivalShiftHours(impact: TuasImpact): number | null {
  return impact.arrivalShiftTicks === null ? null : ticksToHours(impact.arrivalShiftTicks);
}

/** Sim-time of the revised arrival, for `formatSimTime`. */
export function revisedArrivalSimMinutes(impact: TuasImpact): number | null {
  return impact.revisedArrivalTick === null ? null : impact.revisedArrivalTick * TICK_SIM_MINUTES;
}
