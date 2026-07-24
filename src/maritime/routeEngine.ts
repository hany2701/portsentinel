import { ADJACENCY, edgeBetween, sequenceDistanceNm } from "./graph";
import { ROUTE_EDGES, routeNodeById } from "./network";
import { MARITIME_DOCTRINE } from "./maritimeDoctrine";
import { CLASS_SPEED_KNOTS, nmPerTick } from "./config";
import { TICK_SIM_MINUTES } from "../sim/config";
import { activePlanFor, edgeConditions, weatherSpeedFactor, type EdgeCondition } from "./selectors";
import { portHubById } from "./ports";
import type { RerouteReason, SimState, Vessel } from "../sim/types";

// GR-6: the deterministic rerouting engine (GR-D5).
//
// Plain Dijkstra over non-negative costs. At ~60 nodes the O(V²) scan is
// instant, and it is trivially provable — which matters more here than speed,
// because the LLM never computes a route: it only explains what this returns.
//
// Every cost is expressed in MINUTES so travel time, weather, congestion and
// port waiting are directly comparable. Blocked edges are removed from the
// graph before the search rather than priced high, so an unsafe leg cannot be
// bought with a long enough detour.

export type RouteCandidate = {
  id: string;
  nodeIds: string[];
  policy: RoutePolicy;
  travelMinutes: number;
  expectedWaitMinutes: number;
  weatherRisk: number;
  congestionRisk: number;
  distanceNm: number;
  additionalDistanceNm: number;
  delayAvoidedMinutes: number;
  totalCost: number;
  highRiskEdgeIds: string[];
  reasons: string[];
};

/**
 * Policy variants. Each is a different weighting of the SAME cost model — never
 * a different algorithm — so comparing candidates stays honest.
 */
export type RoutePolicy = "baseline" | "weather_averse" | "congestion_averse";

const POLICY_WEIGHTS: Record<RoutePolicy, { weather: number; congestion: number }> = {
  baseline: { weather: 1, congestion: 1 },
  // Trades distance for safety: a storm-exposed leg has to be much faster to win.
  weather_averse: { weather: 2.5, congestion: 0.8 },
  // Trades distance for a clear run: useful when the strait is the bottleneck.
  congestion_averse: { weather: 0.8, congestion: 2.5 },
};

/**
 * The speed a voyage is PLANNED at (MDS-2a / D-96).
 *
 * Never the vessel's instantaneous `track.speedKnots`: weather suspension drives
 * that to 0, and the old `Math.max(1, …)` guard then planned the entire voyage
 * at 1 knot — which is how a 2,507 nm alternative came to be quoted as 104.5
 * days. A plan is made against what the ship can sustain, and the weather that
 * is slowing it right now is applied per edge below.
 */
export function planningSpeedKnots(vessel: Vessel): number {
  return CLASS_SPEED_KNOTS[vessel.class];
}

/**
 * Effective speed over one edge: service speed reduced by that edge's weather
 * band, using the same `weatherSpeedFactor` the movement engine applies.
 *
 * Floored at the severe factor so a blocked edge yields a large-but-finite time
 * rather than Infinity. A blocked route is communicated by the Risk row and the
 * hazard-leg count, not by an unusable number.
 */
function edgeSpeedKnots(serviceKnots: number, weatherRisk: number): number {
  const factor = Math.max(weatherSpeedFactor(weatherRisk), MARITIME_DOCTRINE.movement.severeSpeedFactor);
  return Math.max(1, serviceKnots * factor);
}

export function edgeCostMinutes(
  edge: { id: string; distanceNm: number; restrictions?: readonly string[] },
  condition: EdgeCondition | undefined,
  speedKnots: number,
  policy: RoutePolicy = "baseline",
): number {
  const { routing } = MARITIME_DOCTRINE;
  const weights = POLICY_WEIGHTS[policy];

  // Time is physics (service speed slowed by weather); the penalties below are
  // preference. Keeping them separate stops one from masquerading as the other.
  const travelMinutes =
    (edge.distanceNm / edgeSpeedKnots(speedKnots, condition?.weatherRisk ?? 0)) * 60;
  const weatherRisk = condition?.weatherRisk ?? 0;
  const congestionRisk = condition?.congestionRisk ?? 0;

  const weatherPenalty = weatherRisk * routing.weatherPenaltyMinPerPoint * weights.weather;
  const congestionPenalty = congestionRisk * routing.congestionPenaltyMinPerPoint * weights.congestion;
  // A restricted edge stays in the graph so the inspector can show why it was
  // avoided, but is priced beyond any plausible detour.
  const restrictionPenalty = condition?.restricted ? routing.safetyRestrictionMin : 0;

  return travelMinutes + weatherPenalty + congestionPenalty + restrictionPenalty;
}

/** Expected berth wait at a destination port, in minutes. */
function portWaitMinutes(nodeId: string): number {
  const node = routeNodeById(nodeId);
  if (!node?.portId) return 0;
  const hub = portHubById(node.portId);
  if (!hub) return 0;
  return hub.estimatedWaitHours * MARITIME_DOCTRINE.routing.portWaitMinPerHour;
}

type DijkstraResult = { nodeIds: string[]; totalCost: number } | null;

/**
 * Plain Dijkstra. Deterministic throughout: ties break on lexicographic node id,
 * and neighbours are visited in sorted order, so the same graph and costs always
 * yield the same path — a hard requirement for a seeded, reproducible demo.
 */
export function dijkstra(
  fromNodeId: string,
  toNodeId: string,
  cost: (edgeId: string, fromId: string, toId: string) => number | null,
): DijkstraResult {
  if (fromNodeId === toNodeId) return { nodeIds: [fromNodeId], totalCost: 0 };

  const dist = new Map<string, number>([[fromNodeId, 0]]);
  const prev = new Map<string, string>();
  const settled = new Set<string>();

  for (;;) {
    // Cheapest unsettled node; lexicographic id breaks ties. Scanned in a single
    // pass rather than sorting the frontier each iteration — sorting made this
    // O(V² log V) with an allocation per step, which is the dominant cost when
    // many vessels are evaluated in one tick. Ties are resolved by comparing ids
    // directly, so the result is identical to the sorted version.
    let current: string | null = null;
    let currentDist = Infinity;
    for (const [nodeId, d] of dist) {
      if (settled.has(nodeId)) continue;
      if (d < currentDist || (d === currentDist && current !== null && nodeId.localeCompare(current) < 0)) {
        current = nodeId;
        currentDist = d;
      }
    }
    if (current === null) return null; // target unreachable
    if (current === toNodeId) break;
    settled.add(current);

    const neighbours = [...(ADJACENCY.get(current) ?? [])].sort((a, b) =>
      a.toNodeId.localeCompare(b.toNodeId),
    );
    for (const { edge, toNodeId: next } of neighbours) {
      if (settled.has(next)) continue;
      const w = cost(edge.id, current, next);
      if (w === null) continue; // blocked: removed from the graph entirely
      const candidate = currentDist + w;
      if (candidate < (dist.get(next) ?? Infinity)) {
        dist.set(next, candidate);
        prev.set(next, current);
      }
    }
  }

  const path: string[] = [toNodeId];
  while (path[0] !== fromNodeId) {
    const parent = prev.get(path[0]);
    if (!parent) return null;
    path.unshift(parent);
  }
  return { nodeIds: path, totalCost: dist.get(toNodeId) ?? Infinity };
}

/**
 * The first node AHEAD of the vessel on its current plan.
 *
 * This is the anchor for the no-teleport contract (plan §8.8): a reroute may
 * only start from a node the vessel has not yet passed, so an approved route can
 * never snap it backwards or sideways onto a distant waypoint.
 */
export function projectionNodeAhead(sim: SimState, vessel: Vessel): string | null {
  const plan = activePlanFor(sim, vessel.id);
  if (!plan || !vessel.track) return null;
  return plan.nodeIds[vessel.track.edgeIndex + 1] ?? null;
}

/** Aggregate risk and distance for a finished path. */
function summarise(
  nodeIds: string[],
  speedKnots: number,
  conditions: Map<string, EdgeCondition>,
) {
  let travelMinutes = 0;
  let weatherRisk = 0;
  let congestionRisk = 0;
  const highRiskEdgeIds: string[] = [];

  for (let i = 0; i < nodeIds.length - 1; i++) {
    const edge = edgeBetween(nodeIds[i], nodeIds[i + 1]);
    if (!edge) continue;
    const cond = conditions.get(edge.id);
    travelMinutes += (edge.distanceNm / edgeSpeedKnots(speedKnots, cond?.weatherRisk ?? 0)) * 60;
    weatherRisk = Math.max(weatherRisk, cond?.weatherRisk ?? 0);
    congestionRisk = Math.max(congestionRisk, cond?.congestionRisk ?? 0);
    if ((cond?.weatherRisk ?? 0) >= MARITIME_DOCTRINE.routing.highRiskWeatherThreshold) {
      highRiskEdgeIds.push(edge.id);
    }
  }

  return {
    travelMinutes,
    weatherRisk,
    congestionRisk,
    highRiskEdgeIds,
    distanceNm: sequenceDistanceNm(nodeIds),
    expectedWaitMinutes: portWaitMinutes(nodeIds[nodeIds.length - 1]),
  };
}

/**
 * The SAME summary, for the route the vessel is sailing right now (MDS-2).
 *
 * The comparison table needs an "original" column, and it has to be measured the
 * way the candidates are measured or the two columns are not comparable. This
 * exports what `routeCandidates` already computes internally as `activeSummary`
 * — the remaining stretch from the vessel's current position, never the whole
 * voyage — rather than letting the view recompute it a second way.
 */
export function activeRouteSummary(
  sim: SimState,
  vesselId: string,
  conditions: Map<string, EdgeCondition> = edgeConditions(sim),
): (ReturnType<typeof summarise> & { nodeIds: string[] }) | null {
  const vessel = sim.vessels.find((v) => v.id === vesselId);
  const plan = activePlanFor(sim, vesselId);
  if (!vessel?.track || !plan) return null;
  const remainder = plan.nodeIds.slice(vessel.track.edgeIndex + 1);
  if (remainder.length < 2) return null;
  return { ...summarise(remainder, planningSpeedKnots(vessel), conditions), nodeIds: remainder };
}

export type RerouteStage =
  /** Nothing wrong, or nothing proposed. */
  | { stage: "clear" }
  /** The tick recorded that the route deteriorated. Evidence only (D-85). */
  | { stage: "detected"; decisionId: string }
  /** A human or the agent has put a proposal in the queue, awaiting approval. */
  | { stage: "proposed"; recommendationId: string }
  /** Proposed but validation rejected it — it cannot be approved. */
  | { stage: "invalid"; recommendationId: string; message: string }
  /** Approved and executed. */
  | { stage: "approved"; recommendationId: string };

/**
 * Where this vessel's reroute stands (MDS-3).
 *
 * Derived, never stored. The brief's §6.5 lists eleven possible lifecycle states
 * and then warns against building a state model that duplicates an existing
 * authoritative workflow — so this reports only the stages this architecture
 * genuinely has, read from the records that already exist: a `RerouteDecision`
 * is evidence the tick recorded, a `Recommendation` is a proposal a human or the
 * agent made, and its `validationStatus` / `status` carry the rest.
 *
 * The distinction that matters is the first one: detected ≠ proposed. The tick
 * never proposes (D-85), so "detected" means the engine noticed, not that anyone
 * asked for anything.
 */
export function rerouteStage(sim: SimState, vesselId: string): RerouteStage {
  const forVessel = (e: { kind: string; vesselId?: string }) =>
    (e.kind === "rerouteVoyage" || e.kind === "holdVessel") && e.vesselId === vesselId;

  const pending = sim.recommendations.find((r) => r.status === "pending" && forVessel(r.proposedEffect));
  if (pending) {
    return pending.validationStatus === "invalid"
      ? { stage: "invalid", recommendationId: pending.id, message: pending.validationMessage ?? "Rejected by validation." }
      : { stage: "proposed", recommendationId: pending.id };
  }

  const approved = sim.recommendations.find((r) => r.status === "approved" && forVessel(r.proposedEffect));
  if (approved) return { stage: "approved", recommendationId: approved.id };

  const decision = sim.maritime.rerouteDecisions.find(
    (d) => d.vesselId === vesselId && d.approvalStatus === "pending",
  );
  if (decision) return { stage: "detected", decisionId: decision.id };

  return { stage: "clear" };
}

export type WaitOption = {
  /** Earliest tick at which the current route is free of hazards. */
  releaseTick: number;
  waitMinutes: number;
  /** Sailing the CURRENT route once it has cleared. */
  travelMinutes: number;
  expectedWaitMinutes: number;
  /** Wait + sail + port wait — the figure to compare against a detour. */
  totalMinutes: number;
};

/**
 * "Hold until the disruption clears, then sail the route you were already on"
 * (MDS-2a / D-96).
 *
 * The option a real duty manager reaches for first, and the one the engine could
 * not express: it compares path against path, so a storm with 24 h left to run
 * could only be answered with a 2,500 nm detour.
 *
 * The release tick is not guessed. Each active storm's expiry is tested as a
 * candidate release time by re-deriving `edgeConditions` on a clock-advanced
 * copy of the state — a pure read, no mutation — and the first one that leaves
 * the remaining route hazard-free wins. If nothing clears the route, there is no
 * wait option and the caller gets null rather than an invented number.
 */
export function waitOption(
  sim: SimState,
  vesselId: string,
  conditions: Map<string, EdgeCondition> = edgeConditions(sim),
): WaitOption | null {
  const vessel = sim.vessels.find((v) => v.id === vesselId);
  const plan = activePlanFor(sim, vesselId);
  if (!vessel?.track || !plan) return null;

  // Same span as `activeRouteSummary` and the candidate comparison — nodes
  // strictly AHEAD of the vessel. Measuring a different stretch here would put a
  // wait column next to a sail column that covers different water.
  const remainder = plan.nodeIds.slice(vessel.track.edgeIndex + 1);
  if (remainder.length < 2) return null;

  const hazardous = (conds: Map<string, EdgeCondition>) =>
    summarise(remainder, planningSpeedKnots(vessel), conds).highRiskEdgeIds.length > 0;

  // Nothing to wait out — sailing now is already clear.
  if (!hazardous(conditions)) return null;

  const ends = sim.disruptions
    .filter((d) => sim.clock.tick < d.startTick + d.durationTicks)
    .map((d) => d.startTick + d.durationTicks)
    .sort((a, b) => a - b);

  for (const releaseTick of ends) {
    const future = { ...sim, clock: { ...sim.clock, tick: releaseTick } };
    const futureConditions = edgeConditions(future);
    if (hazardous(futureConditions)) continue;

    const cleared = summarise(remainder, planningSpeedKnots(vessel), futureConditions);
    const waitMinutes = (releaseTick - sim.clock.tick) * TICK_SIM_MINUTES;
    return {
      releaseTick,
      waitMinutes,
      travelMinutes: cleared.travelMinutes,
      expectedWaitMinutes: cleared.expectedWaitMinutes,
      totalMinutes: waitMinutes + cleared.travelMinutes + cleared.expectedWaitMinutes,
    };
  }
  return null;
}

function describe(policy: RoutePolicy, summary: ReturnType<typeof summarise>, vsActive: number): string[] {
  const reasons: string[] = [];
  if (policy === "weather_averse") reasons.push("Prioritises weather avoidance over distance");
  if (policy === "congestion_averse") reasons.push("Prioritises clear water over distance");
  if (policy === "baseline") reasons.push("Lowest total cost under current conditions");
  if (summary.highRiskEdgeIds.length === 0) reasons.push("Avoids all high-risk segments");
  else reasons.push(`Still crosses ${summary.highRiskEdgeIds.length} high-risk segment(s)`);
  if (vsActive > 0) reasons.push(`Saves ~${Math.round(vsActive)} min against the active route`);
  else if (vsActive < 0) reasons.push(`Costs ~${Math.round(-vsActive)} min more than the active route`);
  return reasons;
}

/**
 * Candidate routes for a vessel, ranked cheapest first.
 *
 * SCOPE (GR-D12c): first-release rerouting only offers alternatives to the SAME
 * destination. Changing where a vessel goes is a different decision with
 * different consequences — that remains the existing `divertVessel` effect
 * under Tuas doctrine.
 */
export function routeCandidates(
  sim: SimState,
  vesselId: string,
  conditions: Map<string, EdgeCondition> = edgeConditions(sim),
): RouteCandidate[] {
  const vessel = sim.vessels.find((v) => v.id === vesselId);
  const plan = activePlanFor(sim, vesselId);
  if (!vessel?.track || !plan) return [];

  const startNodeId = projectionNodeAhead(sim, vessel);
  if (!startNodeId) return [];
  const destinationNodeId = plan.destinationNodeId;
  if (startNodeId === destinationNodeId) return [];

  const speedKnots = planningSpeedKnots(vessel);
  const { routing } = MARITIME_DOCTRINE;

  // The remaining stretch of the ACTIVE route, so candidates are compared
  // against what the vessel would otherwise do — not against its whole voyage.
  const activeRemainder = plan.nodeIds.slice(vessel.track.edgeIndex + 1);
  const activeSummary = summarise(activeRemainder, speedKnots, conditions);
  const activeCost = activeSummary.travelMinutes + activeSummary.expectedWaitMinutes;

  // The scheduled port calls still ahead, in order. A reroute may change HOW a
  // vessel travels between its calls; it may never change WHICH calls it makes.
  // Routing straight to the destination let Dijkstra drop a commercial call to
  // save distance — with Port Klang and Penang on their real channel approaches
  // rather than sitting on the trunk line, that surfaced as a standing
  // "congestion" proposal to skip them in perfectly calm weather.
  const stops = [startNodeId];
  for (const nodeId of activeRemainder) {
    if (nodeId.startsWith("PORT-") && nodeId !== stops[stops.length - 1]) stops.push(nodeId);
  }
  if (stops[stops.length - 1] !== destinationNodeId) stops.push(destinationNodeId);

  const seen = new Map<string, RouteCandidate>();
  for (const policy of ["baseline", "weather_averse", "congestion_averse"] as const) {
    const edgeCost = (edgeId: string) => {
      const edge = ROUTE_EDGES.find((e) => e.id === edgeId);
      if (!edge) return null;
      const cond = conditions.get(edgeId);
      // Blocked edges leave the graph. An unsafe leg is not merely expensive.
      if (cond?.blocked || (cond?.weatherRisk ?? 0) >= routing.blockWeatherRiskAtOrAbove) return null;
      return edgeCostMinutes(edge, cond, speedKnots, policy);
    };

    // One search per leg between consecutive calls, concatenated. If any leg is
    // unreachable the whole candidate is dropped: a route that misses a call is
    // not a cheaper version of this voyage, it is a different voyage.
    let result: { nodeIds: string[]; totalCost: number } | null = { nodeIds: [stops[0]], totalCost: 0 };
    for (let i = 0; i < stops.length - 1 && result; i++) {
      const leg = dijkstra(stops[i], stops[i + 1], edgeCost);
      result = leg
        ? { nodeIds: [...result.nodeIds, ...leg.nodeIds.slice(1)], totalCost: result.totalCost + leg.totalCost }
        : null;
    }
    if (!result || result.nodeIds.length < 2) continue;

    const key = result.nodeIds.join(">");
    // Two policies often agree; keep one entry and record the cheaper framing.
    if (seen.has(key)) continue;

    const summary = summarise(result.nodeIds, speedKnots, conditions);
    const totalCost = result.totalCost + summary.expectedWaitMinutes;
    const delayAvoided = activeCost - (summary.travelMinutes + summary.expectedWaitMinutes);

    seen.set(key, {
      id: `RC-${vesselId}-${policy}`,
      nodeIds: result.nodeIds,
      policy,
      travelMinutes: summary.travelMinutes,
      expectedWaitMinutes: summary.expectedWaitMinutes,
      weatherRisk: summary.weatherRisk,
      congestionRisk: summary.congestionRisk,
      distanceNm: summary.distanceNm,
      additionalDistanceNm: summary.distanceNm - activeSummary.distanceNm,
      delayAvoidedMinutes: delayAvoided,
      totalCost,
      highRiskEdgeIds: summary.highRiskEdgeIds,
      reasons: describe(policy, summary, delayAvoided),
    });
  }

  // Deterministic ranking: cost first, then id, so equal-cost candidates never
  // reorder between runs.
  return [...seen.values()].sort((a, b) => a.totalCost - b.totalCost || a.id.localeCompare(b.id));
}

/**
 * Whether the active route is worth replacing, and why.
 *
 * `conditions` is an optional injection point: computing the edge-condition map
 * walks every edge in the network, so a caller checking many vessels in one
 * tick must build it once and pass it in rather than paying that cost per
 * vessel.
 */
export function rerouteReason(
  sim: SimState,
  vesselId: string,
  conditions: Map<string, EdgeCondition> = edgeConditions(sim),
): RerouteReason | null {
  const vessel = sim.vessels.find((v) => v.id === vesselId);
  const plan = activePlanFor(sim, vesselId);
  if (!vessel?.track || !plan) return null;

  const remainder = plan.nodeIds.slice(vessel.track.edgeIndex);
  let weather = false;
  let congestion = false;
  let blocked = false;

  for (let i = 0; i < remainder.length - 1; i++) {
    const edge = edgeBetween(remainder[i], remainder[i + 1]);
    const cond = edge && conditions.get(edge.id);
    if (!cond) continue;
    if (cond.blocked) blocked = true;
    // The reroute threshold, not the visual one: proposing a diversion is a
    // heavier ask than colouring a segment amber.
    if (cond.weatherRisk >= MARITIME_DOCTRINE.routing.rerouteWeatherThreshold) weather = true;
    if (cond.congestionRisk >= MARITIME_DOCTRINE.congestion.highTrafficRisk) congestion = true;
  }

  if (blocked) return "safety";
  if (weather && congestion) return "combined";
  if (weather) return "weather";
  if (congestion) return "congestion";
  return null;
}

/** ETA tick for a candidate, from the vessel's own speed. */
export function candidateEtaTick(sim: SimState, candidate: RouteCandidate, speedKnots: number): number {
  return sim.clock.tick + Math.round(candidate.distanceNm / nmPerTick(speedKnots));
}

/**
 * How many high-risk (elevated but not blocked) edges the vessel's CURRENT
 * remaining route crosses. The baseline a reroute candidate is judged against:
 * an advisory is worth raising when a candidate reduces this exposure (D-89),
 * which matters under a basin-wide storm where a fully hazard-free route may not
 * exist but a strictly-less-exposed one still does.
 */
export function activeRouteHighRisk(
  state: SimState,
  vesselId: string,
  conditions: Map<string, EdgeCondition> = edgeConditions(state),
): number {
  const vessel = state.vessels.find((v) => v.id === vesselId);
  const plan = activePlanFor(state, vesselId);
  if (!vessel?.track || !plan) return 0;
  const remainder = plan.nodeIds.slice(vessel.track.edgeIndex + 1);
  let count = 0;
  for (let i = 0; i < remainder.length - 1; i++) {
    const edge = edgeBetween(remainder[i], remainder[i + 1]);
    const cond = edge && conditions.get(edge.id);
    if (cond && cond.weatherRisk >= MARITIME_DOCTRINE.routing.highRiskWeatherThreshold) count++;
  }
  return count;
}
