import { edgeConditions, weatherSpeedFactor } from "./selectors";
import { corridorForService, routeNodeById } from "./network";
import { edgeBetween } from "./graph";
import { CLASS_SPEED_KNOTS } from "./config";
import { MARITIME_DOCTRINE } from "./maritimeDoctrine";
import { SERVICE_CADENCE_TICKS, SERVICE_ROSTER, serviceById } from "../sim/roster";
import type { EdgeCondition } from "./selectors";
import type { SimState } from "../sim/types";

// D-110: how a disruption anywhere on a service's rotation reaches Tuas.
//
// Until now the two vessel populations were disconnected. A storm could delay
// the tracked vessels sailing the route graph, but the 22-vessel baseline fleet
// books its next call straight off the weekly service slot (D-79) and so arrived
// exactly on time no matter what was happening at Hormuz or Suez. The honest
// answer to "does a Gulf disruption change Tuas traffic?" was therefore "no" —
// which is true of the model but not of a port.
//
// The join is deliberately narrow: a service whose CORRIDOR is slowed books its
// next call later, by the proportion of its loop that the weather has cost.

export type ServiceDelay = {
  serviceId: string;
  serviceName: string;
  delayTicks: number; // slip applied to the next call
  fraction: number; // extra sailing time / undisrupted loop
  worstNodeName: string | null;
  worstRisk: number;
  blockedLegs: number;
};

/**
 * Speed over one edge — the same rule routeEngine uses, floored so a blocked leg
 * is large-but-finite rather than Infinity.
 */
function edgeKnots(serviceKnots: number, risk: number): number {
  const f = Math.max(weatherSpeedFactor(risk), MARITIME_DOCTRINE.movement.severeSpeedFactor);
  return Math.max(1, serviceKnots * f);
}

/**
 * The same corridor on an ordinary day: edge conditions with every disruption
 * removed. A pure read — it builds a shallow copy and never touches `sim`.
 *
 * This is the baseline the slip is measured AGAINST, and it is the difference
 * between a truthful number and a false one. Ambient weather already slows the
 * legs around Singapore: with zero disruptions active, the Riau Connector's
 * 62 nm loop measures 16.6% slow and the Straits Express 3.6%. Measured against
 * an unweathered ideal, those would book a permanent 7-tick and 1-tick slip on
 * every rotation — a standing 17.5% stretch of the cadence that would empty the
 * port over a long run, which is the exact failure the proportional design was
 * chosen to avoid. It would also make the assistant blame Hormuz for a delay
 * that exists on a calm day.
 */
export function undisruptedConditions(sim: SimState): Map<string, EdgeCondition> {
  return edgeConditions({ ...sim, disruptions: [] });
}

export function serviceDelay(
  sim: SimState,
  serviceId: string,
  conditions: Map<string, EdgeCondition> = edgeConditions(sim),
  baseline: Map<string, EdgeCondition> = undisruptedConditions(sim),
): ServiceDelay | null {
  const corridor = corridorForService(serviceId);
  const service = serviceById(serviceId);
  if (!corridor || !service) return null;

  const knots = CLASS_SPEED_KNOTS[service.class];
  let normal = 0;
  let actual = 0;
  let blockedLegs = 0;
  let worstRisk = 0;
  let worstExcess = 0;
  let worstNodeName: string | null = null;

  for (let i = 0; i < corridor.nodeIds.length - 1; i++) {
    const edge = edgeBetween(corridor.nodeIds[i], corridor.nodeIds[i + 1]);
    if (!edge) continue;
    const cond = conditions.get(edge.id);
    const base = baseline.get(edge.id);
    const risk = cond?.weatherRisk ?? 0;
    const baseRisk = base?.weatherRisk ?? 0;
    // `normal` is this leg WITHOUT the disruption, not without weather.
    normal += edge.distanceNm / edgeKnots(knots, baseRisk);
    actual += edge.distanceNm / edgeKnots(knots, risk);
    // Only legs the disruption itself blocked; one already blocked on a calm day
    // is not evidence of this disruption.
    if (cond?.blocked && !base?.blocked) blockedLegs++;
    // "Worst" is the biggest DETERIORATION, so the named node is the one the
    // disruption is actually hurting — not whichever leg has the highest
    // ambient risk, which is almost always the one nearest Singapore.
    if (risk - baseRisk > worstExcess) {
      worstExcess = risk - baseRisk;
      worstRisk = risk;
      worstNodeName = routeNodeById(corridor.nodeIds[i + 1])?.name ?? null;
    }
  }
  if (normal <= 0) return null;

  // A PROPORTION, not raw hours (D-110). Direction-agnostic: a round trip
  // doubles both terms and leaves the fraction unchanged.
  const fraction = (actual - normal) / normal;
  const delayTicks = Math.round(fraction * SERVICE_CADENCE_TICKS);
  if (delayTicks < 1) return null;

  return { serviceId, serviceName: service.name, delayTicks, fraction, worstNodeName, worstRisk, blockedLegs };
}

export function serviceDelayTicks(sim: SimState, serviceId: string): number {
  return serviceDelay(sim, serviceId)?.delayTicks ?? 0;
}

/** Every disrupted service, worst first — for the chatbot and the schedule. */
export function serviceDelays(sim: SimState): ServiceDelay[] {
  // Both maps built once and shared across the roster — each walks every edge.
  const conditions = edgeConditions(sim);
  const baseline = undisruptedConditions(sim);
  return SERVICE_ROSTER
    .map((s) => serviceDelay(sim, s.id, conditions, baseline))
    .filter((d): d is ServiceDelay => d !== null)
    .sort((a, b) => b.delayTicks - a.delayTicks || a.serviceId.localeCompare(b.serviceId));
}
