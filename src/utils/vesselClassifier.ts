import { DOCTRINE, isHighPriority, vesselWaitHours } from "../sim";
import type { Berth, SimState, Vessel } from "../sim";

export type VesselRisk = "critical" | "elevated" | "normal";
export type VesselClassification = { risk: VesselRisk; reasons: string[] };

// Classify a vessel's operational urgency from doctrine thresholds — feeds the agent
// context snapshot's "at-risk vessels" section and grounds re-berth/divert reasoning.
export function classifyVessel(state: SimState, v: Vessel): VesselClassification {
  const reasons: string[] = [];
  let risk: VesselRisk = "normal";

  if (v.status === "anchored") {
    const waitH = vesselWaitHours(state, v);
    const target = DOCTRINE.berth.targetMaxAnchorageWaitHours;
    if (waitH > target * 2) {
      risk = "critical";
      reasons.push(`anchored ${waitH.toFixed(1)} h (>2× the ${target} h target)`);
    } else if (waitH > target) {
      risk = "elevated";
      reasons.push(`anchored ${waitH.toFixed(1)} h (over the ${target} h target)`);
    }
  }

  if ((v.status === "approaching" || v.status === "anchored") && state.weather.riskIndex > DOCTRINE.weather.severeMax) {
    if (risk === "normal") risk = "elevated";
    reasons.push(`${v.status} in severe weather (risk ${state.weather.riskIndex})`);
  }

  if (carriesHighPriority(state, v)) {
    reasons.push("carries high-priority cargo");
  }

  return { risk, reasons };
}

function carriesHighPriority(state: SimState, v: Vessel): boolean {
  return v.manifest.some((m) => m.priority === "high" || isHighPriority(state, m.customerId));
}

// Vessels the agent should be watching, worst first. Used to cap the context snapshot.
export function atRiskVessels(state: SimState): { vessel: Vessel; classification: VesselClassification }[] {
  const order: Record<VesselRisk, number> = { critical: 0, elevated: 1, normal: 2 };
  return state.vessels
    .map((vessel) => ({ vessel, classification: classifyVessel(state, vessel) }))
    .filter((x) => x.classification.risk !== "normal")
    .sort((a, b) => order[a.classification.risk] - order[b.classification.risk]);
}

// Available berths a waiting vessel could legally take (deep-water rule for neopanamax).
// Grounds the agent's re-berth proposals in real targets.
export function suitableBerths(state: SimState, v: Vessel): Berth[] {
  return state.berths.filter((b) => berthSuitableFor(b, v));
}

export function berthSuitableFor(berth: Berth, v: Vessel): boolean {
  if (berth.status !== "available") return false;
  if (v.class === "neopanamax" && !berth.deepWater) return false;
  return true;
}
