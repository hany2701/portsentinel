import { geoInterpolate } from "d3-geo";
import { CLASS_SPEED_KNOTS, nmPerTick } from "../maritime/config";
import { edgeBetween, sequenceDistanceNm } from "../maritime/graph";
import { inSingaporeApproach } from "../maritime/geofence";
import { corridorForService, routeNodeById } from "../maritime/network";
import { bearingDeg } from "../maritime/populationGen";
import { TUAS_PORT_ID } from "../maritime/ports";
import { activePlanFor, edgeConditions, weatherSpeedFactor, type EdgeCondition } from "../maritime/selectors";
import { activeRouteHighRisk, rerouteReason, routeCandidates } from "../maritime/routeEngine";
import { MARITIME_DOCTRINE } from "../maritime/maritimeDoctrine";
import type {
  RerouteDecision,
  SimState,
  Vessel,
  VesselHandoverState,
  VesselRoutePlan,
  VesselTrackState,
} from "./types";

// GR-3: geographic vessel movement and the frame handover.
//
// ONE MOVEMENT OWNER PER VESSEL PER TICK. Each vessel is advanced by exactly one
// engine each tick — this module while it is "enroute", the Tuas FSM
// (moveVessels/assignBerths) otherwise. On a handover tick NEITHER moves it: the
// vessel is pinned at the D-62 entry anchor for that tick and starts moving in
// its new frame on the next one. tick.ts enforces the other half of this by
// skipping vessels whose handover was recorded this tick.
//
// NO RNG. Movement is pure arithmetic, so the per-tick random stream is
// identical whether or not tracked vessels exist — which is what keeps the
// frozen 22-vessel Tuas simulation reproducible (worldGenFreeze.test.ts).
//
// The geographic frame (WGS84) and the D-62 world frame never mix: a vessel
// crosses between them by a STATUS change plus a handover record, never by
// transforming coordinates (GR-D6).

// The node a departing vessel re-enters the geographic network at. It is the
// offshore anchorage — adjacent to the port itself, never an unrelated corridor
// node further out.
const GEOGRAPHIC_EXIT_NODE_ID = "NODE-TUAS-ANCHORAGE";

// Stable names for the two approved frame-crossing anchors in D-62.
export const D62_APPROACH_ENTRY_ANCHOR = "D62-APPROACH-ENTRY";
export const D62_DEPARTURE_EXIT_ANCHOR = "D62-DEPARTURE-EXIT";

// The D-62 departure path runs seaward (−Z is north in that frame), so the
// departure tangent is due north. Recorded as METADATA on the handover: the
// resumed geographic course comes from the exit node's first route segment, not
// from transforming this number into the other frame.
const D62_DEPARTURE_TANGENT_DEG = 0;

export function activePlan(state: SimState, vesselId: string): VesselRoutePlan | undefined {
  return state.maritime.routePlans.find((p) => p.vesselId === vesselId && p.status === "active");
}

export function openHandover(state: SimState, vesselId: string): VesselHandoverState | undefined {
  return state.maritime.handovers.find((h) => h.vesselId === vesselId && h.status !== "completed");
}

/** True on the single tick a vessel is crossing between frames — nothing moves it. */
export function isHandoverTick(state: SimState, vesselId: string): boolean {
  const handover = openHandover(state, vesselId);
  return handover !== undefined && handover.handoverTick === state.clock.tick;
}

function edgeLengthNm(plan: VesselRoutePlan, edgeIndex: number): number {
  const edge = edgeBetween(plan.nodeIds[edgeIndex], plan.nodeIds[edgeIndex + 1]);
  return edge ? edge.distanceNm : 0;
}

/** Interpolated position and course at the track's current progress. */
function positionOf(plan: VesselRoutePlan, track: VesselTrackState): {
  latitude: number;
  longitude: number;
  courseDeg: number;
} | null {
  const join = track.joinSegment;
  const fromPoint = join
    ? { latitude: join.fromLat, longitude: join.fromLon }
    : routeNodeById(plan.nodeIds[track.edgeIndex]);
  const toPoint = join
    ? routeNodeById(join.toNodeId)
    : routeNodeById(plan.nodeIds[track.edgeIndex + 1]);
  if (!fromPoint || !toPoint) return null;

  const span = join ? join.distanceNm : edgeLengthNm(plan, track.edgeIndex);
  const progress = join ? join.progressNm : track.progressNm;
  const t = span <= 0 ? 1 : Math.min(1, progress / span);
  const [longitude, latitude] = geoInterpolate(
    [fromPoint.longitude, fromPoint.latitude],
    [toPoint.longitude, toPoint.latitude],
  )(t);
  return { latitude, longitude, courseDeg: bearingDeg(fromPoint, toPoint) };
}

/** Remaining distance to the plan's destination from the track's position. */
export function remainingDistanceNm(plan: VesselRoutePlan, track: VesselTrackState): number {
  let remaining = track.joinSegment ? track.joinSegment.distanceNm - track.joinSegment.progressNm : 0;
  const startIndex = track.joinSegment
    ? Math.max(0, plan.nodeIds.indexOf(track.joinSegment.toNodeId))
    : track.edgeIndex;
  if (!track.joinSegment) remaining += Math.max(0, edgeLengthNm(plan, startIndex) - track.progressNm);
  for (let i = startIndex + (track.joinSegment ? 0 : 1); i < plan.nodeIds.length - 1; i++) {
    remaining += edgeLengthNm(plan, i);
  }
  return remaining;
}

/** Start a fresh voyage plan for a tracked vessel along the given node sequence. */
export function makeRoutePlan(
  state: SimState,
  vesselId: string,
  nodeIds: string[],
  speedKnots: number,
): VesselRoutePlan {
  const totalDistanceNm = sequenceDistanceNm(nodeIds);
  return {
    id: `RP-${state.seq++}`,
    vesselId,
    // A new voyage starts at version 1; versions count route REVISIONS within a
    // voyage (a reroute), not voyages within a vessel's life.
    routeVersion: 1,
    status: "active",
    nodeIds,
    originNodeId: nodeIds[0],
    destinationNodeId: nodeIds[nodeIds.length - 1],
    totalDistanceNm,
    etaTick: state.clock.tick + Math.round(totalDistanceNm / nmPerTick(speedKnots)),
    expectedWaitMinutes: 0,
    weatherRisk: 0,
    congestionRisk: 0,
    totalCost: 0,
    createdTick: state.clock.tick,
  };
}

/**
 * Turn a vessel around at the end of its route: the completed plan is retained
 * and a reversed one becomes active, so a tracked vessel keeps sailing its loop.
 */
function startReturnLeg(state: SimState, v: Vessel, plan: VesselRoutePlan): void {
  plan.status = "completed";
  const reversed = [...plan.nodeIds].reverse();
  const next = makeRoutePlan(state, v.id, reversed, CLASS_SPEED_KNOTS[v.class]);
  state.maritime.routePlans.push(next);
  const origin = routeNodeById(reversed[0])!;
  const toward = routeNodeById(reversed[1])!;
  v.etaTick = next.etaTick;
  v.homePortId = reversed[0].startsWith("PORT-") ? reversed[0] : undefined;
  v.destinationPortId = reversed[reversed.length - 1].startsWith("PORT-")
    ? reversed[reversed.length - 1]
    : undefined;
  v.track = {
    routePlanId: next.id,
    edgeIndex: 0,
    progressNm: 0,
    latitude: origin.latitude,
    longitude: origin.longitude,
    speedKnots: CLASS_SPEED_KNOTS[v.class],
    courseDeg: bearingDeg(origin, toward),
    lastUpdatedTick: state.clock.tick,
  };
}

/**
 * Hand a Tuas-bound vessel from the geographic frame into the D-62 twin.
 * Idempotent by construction: it only fires for an "enroute" vessel with no open
 * handover, and its first act is to leave that status behind.
 */
function handOverToTuas(state: SimState, v: Vessel, plan: VesselRoutePlan): void {
  const track = v.track!;
  const approachTicks = Math.max(
    1,
    Math.round(remainingDistanceNm(plan, track) / nmPerTick(track.speedKnots)),
  );

  state.maritime.handovers.push({
    direction: "regional_to_tuas",
    vesselId: v.id,
    status: "active",
    handoverTick: state.clock.tick,
    routeVersion: plan.routeVersion,
    // The exact geographic state at the crossing. headingDeg is metadata: the
    // D-62 vessel is oriented by its approach-path tangent, not by this value.
    regionalEntry: {
      latitude: track.latitude,
      longitude: track.longitude,
      headingDeg: track.courseDeg,
      speedKnots: track.speedKnots,
    },
    d62AnchorId: D62_APPROACH_ENTRY_ANCHOR,
  });

  // The route is done; the vessel's ETA, identity, cargo and route history all
  // carry over untouched into the Tuas FSM.
  plan.status = "completed";
  v.status = "approaching";
  v.etaTick = state.clock.tick + approachTicks;
  track.lastUpdatedTick = state.clock.tick;
}

/**
 * Resume geographic movement for a vessel leaving Tuas. Called from the Tuas
 * FSM's recycle path, so the vessel is FSM-owned through the current tick and
 * this module starts advancing it on the next one.
 */
export function handOverToRegional(state: SimState, v: Vessel): void {
  const corridor = corridorForService(v.serviceId);
  const exitNode = routeNodeById(GEOGRAPHIC_EXIT_NODE_ID)!;

  state.maritime.handovers.push({
    direction: "tuas_to_regional",
    vesselId: v.id,
    status: "active",
    handoverTick: state.clock.tick,
    routeVersion: activePlan(state, v.id)?.routeVersion ?? 1,
    d62Exit: {
      anchorId: D62_DEPARTURE_EXIT_ANCHOR,
      headingDeg: D62_DEPARTURE_TANGENT_DEG,
      speedKnots: CLASS_SPEED_KNOTS[v.class],
    },
    geographicExitNodeId: GEOGRAPHIC_EXIT_NODE_ID,
  });

  // Outbound along its own service's corridor, starting at the exit node — never
  // respawned at an unrelated corridor node.
  const outbound = corridor
    ? [...corridor.nodeIds.slice(corridor.nodeIds.indexOf(GEOGRAPHIC_EXIT_NODE_ID))]
    : [GEOGRAPHIC_EXIT_NODE_ID];
  const nodeIds = outbound.length >= 2 ? outbound : [GEOGRAPHIC_EXIT_NODE_ID, "WPT-TUAS-HOLDING"];

  const plan = makeRoutePlan(state, v.id, nodeIds, CLASS_SPEED_KNOTS[v.class]);
  state.maritime.routePlans.push(plan);

  const toward = routeNodeById(nodeIds[1])!;
  v.status = "enroute";
  v.etaTick = plan.etaTick;
  v.destinationPortId = nodeIds[nodeIds.length - 1].startsWith("PORT-")
    ? nodeIds[nodeIds.length - 1]
    : undefined;
  v.track = {
    routePlanId: plan.id,
    edgeIndex: 0,
    progressNm: 0,
    latitude: exitNode.latitude,
    longitude: exitNode.longitude,
    speedKnots: CLASS_SPEED_KNOTS[v.class],
    // Course comes from the geographic route's first segment. The D-62 departure
    // heading above is recorded metadata and is deliberately not transformed.
    courseDeg: bearingDeg(exitNode, toward),
    lastUpdatedTick: state.clock.tick,
  };
}

// Vessels sail loops indefinitely, so finished plans and closed handovers would
// otherwise grow without bound — every one of them gets structuredClone'd every
// tick. Keep each vessel's active record plus a short history: enough for the
// original-vs-recommended route overlay and the dev inspector, bounded forever.
export const ROUTE_HISTORY_PER_VESSEL = 2;
export const HANDOVER_HISTORY_PER_VESSEL = 2;
export const DECISION_HISTORY_PER_VESSEL = 3;

/**
 * Bound the maritime history. Pruning is ordered so nothing still in use can be
 * dropped: decisions are resolved first, then any plan a surviving decision
 * cites is protected, then the remaining history is trimmed per vessel.
 */
export function pruneMaritimeHistory(state: SimState): void {
  // 1. Decisions. A decision that has not been acted on is live state, never
  // history — only resolved ones (executed/dismissed) are trimmed.
  const keptDecisions = new Map<string, number>();
  state.maritime.rerouteDecisions = state.maritime.rerouteDecisions
    .slice()
    .reverse() // newest first
    .filter((decision) => {
      const resolved = decision.approvalStatus === "executed" || decision.approvalStatus === "dismissed";
      if (!resolved) return true;
      const seen = keptDecisions.get(decision.vesselId) ?? 0;
      if (seen >= DECISION_HISTORY_PER_VESSEL) return false;
      keptDecisions.set(decision.vesselId, seen + 1);
      return true;
    })
    .reverse();

  // 2. Plans cited by a surviving decision must outlive the per-vessel cap —
  // dropping one would leave a decision pointing at nothing, and the
  // original-vs-recommended comparison needs both ends.
  const cited = new Set<string>();
  for (const decision of state.maritime.rerouteDecisions) {
    cited.add(decision.originalPlanId);
    if (decision.newPlanId) cited.add(decision.newPlanId);
  }
  // A vessel's track may also still reference the plan it is sailing.
  for (const v of state.vessels) if (v.track) cited.add(v.track.routePlanId);

  const keptPlans = new Map<string, number>();
  state.maritime.routePlans = state.maritime.routePlans
    .slice()
    .reverse()
    .filter((plan) => {
      if (plan.status === "active" || cited.has(plan.id)) return true;
      const seen = keptPlans.get(plan.vesselId) ?? 0;
      if (seen >= ROUTE_HISTORY_PER_VESSEL) return false;
      keptPlans.set(plan.vesselId, seen + 1);
      return true;
    })
    .reverse();

  // 3. Handovers. An open handover is live state; closed ones are trimmed.
  const keptHandovers = new Map<string, number>();
  state.maritime.handovers = state.maritime.handovers
    .slice()
    .reverse()
    .filter((handover) => {
      if (handover.status !== "completed") return true;
      const seen = keptHandovers.get(handover.vesselId) ?? 0;
      if (seen >= HANDOVER_HISTORY_PER_VESSEL) return false;
      keptHandovers.set(handover.vesselId, seen + 1);
      return true;
    })
    .reverse();
}

/**
 * Advance every geographically-owned vessel by one tick, then hand over any that
 * have reached the Tuas approach fence. Pure arithmetic; draws no RNG.
 */
export function stepMaritime(state: SimState): void {
  const conditions = edgeConditions(state);

  // Retire handovers recorded on an earlier tick — they have served their
  // purpose once both frames agree, and keeping them open would trip the
  // one-open-handover invariant on the next crossing.
  const openByVessel = new Map<string, VesselHandoverState>();
  for (const handover of state.maritime.handovers) {
    if (handover.status === "completed") continue;
    if (handover.handoverTick < state.clock.tick) handover.status = "completed";
    else openByVessel.set(handover.vesselId, handover);
  }

  // One pass to index the active plans, instead of scanning the plan list once
  // per vessel per tick.
  const activeByVessel = new Map<string, VesselRoutePlan>();
  for (const plan of state.maritime.routePlans) {
    if (plan.status === "active") activeByVessel.set(plan.vesselId, plan);
  }

  for (const v of state.vessels) {
    if (v.scope === undefined || v.status !== "enroute" || !v.track) continue;
    // A vessel crossing frames this tick is moved by neither engine.
    if (openByVessel.get(v.id)?.handoverTick === state.clock.tick) continue;

    const plan = activeByVessel.get(v.id);
    if (!plan || plan.id !== v.track.routePlanId) continue;

    const track = v.track;

    // Frame handover is decided BEFORE any movement. A vessel that sailed into
    // the approach fence on an earlier tick crosses frames now, and this tick it
    // is moved by neither engine — it is pinned at the D-62 entry anchor and
    // starts moving in its new frame next tick.
    if (
      v.destinationPortId === TUAS_PORT_ID &&
      inSingaporeApproach(track) &&
      !openByVessel.has(v.id)
    ) {
      handOverToTuas(state, v, plan);
      continue;
    }

    // MDS-2a (D-96): an approved hold stops the ship AT SEA. Until this, the
    // movement engine never read `heldUntilTick`, so a hold on an enroute vessel
    // would have been purely cosmetic — the twin and the map would show "held"
    // while the vessel sailed on. That is precisely the animation-contradicts-
    // simulation failure D-58 forbids, so the authoritative engine honours it
    // first and presentation follows.
    //
    // The ETA slips with the hold rather than staying optimistic: a vessel that
    // waits 24 h arrives 24 h later, and the panel must say so.
    if (v.heldUntilTick !== undefined && state.clock.tick < v.heldUntilTick) {
      track.speedKnots = 0;
      track.lastUpdatedTick = state.clock.tick;
      plan.etaTick += 1;
      continue;
    }

    const edge = edgeBetween(plan.nodeIds[track.edgeIndex], plan.nodeIds[track.edgeIndex + 1]);
    const condition = edge ? conditions.get(edge.id) : undefined;
    const factor = weatherSpeedFactor(condition?.weatherRisk ?? 0);
    const effectiveSpeed = CLASS_SPEED_KNOTS[v.class] * factor;
    track.speedKnots = effectiveSpeed;
    track.lastUpdatedTick = state.clock.tick;

    let toTravel = nmPerTick(effectiveSpeed);

    // A join segment is the temporary connector an approved reroute created: it
    // runs from the vessel's exact position at approval to the node where it
    // rejoins the approved network. It is sailed FIRST, so the vessel keeps
    // making way from where it actually is rather than snapping onto the new
    // route, and it never becomes part of the static route graph.
    if (track.joinSegment) {
      const join = track.joinSegment;
      const left = join.distanceNm - join.progressNm;
      if (toTravel < left) {
        // Still on the connector — interpolate along it so the vessel visibly
        // closes on the join node instead of sitting still until it arrives.
        join.progressNm += toTravel;
        toTravel = 0;
        const to = routeNodeById(join.toNodeId);
        if (to) {
          const t = join.distanceNm <= 0 ? 1 : join.progressNm / join.distanceNm;
          const [longitude, latitude] = geoInterpolate(
            [join.fromLon, join.fromLat],
            [to.longitude, to.latitude],
          )(t);
          track.latitude = latitude;
          track.longitude = longitude;
          track.courseDeg = bearingDeg({ latitude, longitude }, to);
        }
      } else {
        // Connector consumed: leftover distance spills onto the route proper and
        // the temporary segment is discarded.
        toTravel -= left;
        const joinIndex = plan.nodeIds.indexOf(join.toNodeId);
        track.edgeIndex = Math.max(0, joinIndex);
        track.progressNm = 0;
        track.joinSegment = undefined;
      }
    }

    // Advance along route edges, carrying leftover distance across each boundary.
    if (toTravel > 0) {
      track.progressNm += toTravel;
      while (track.edgeIndex < plan.nodeIds.length - 1) {
        const span = edgeLengthNm(plan, track.edgeIndex);
        if (track.progressNm < span || span <= 0) break;
        track.progressNm -= span;
        track.edgeIndex += 1;
      }
    }

    const arrived = track.edgeIndex >= plan.nodeIds.length - 1;
    if (arrived) {
      const last = routeNodeById(plan.nodeIds[plan.nodeIds.length - 1])!;
      track.edgeIndex = plan.nodeIds.length - 2;
      track.progressNm = edgeLengthNm(plan, track.edgeIndex);
      track.latitude = last.latitude;
      track.longitude = last.longitude;
    } else if (!track.joinSegment) {
      // A vessel still on its reroute connector is positioned by that segment,
      // not by the route it has yet to join — recomputing here would snap it
      // onto the new route, which is the teleport this design forbids.
      const at = positionOf(plan, track);
      if (at) {
        track.latitude = at.latitude;
        track.longitude = at.longitude;
        track.courseDeg = at.courseDeg;
      }
    }

    // A vessel that has run out of route turns around, unless it is Tuas-bound
    // — that one waits inside the fence and hands over on the next tick.
    if (arrived && !(v.destinationPortId === TUAS_PORT_ID && inSingaporeApproach(track))) {
      startReturnLeg(state, v, plan);
    }
  }

  raiseRerouteAdvisories(state);
  pruneMaritimeHistory(state);
}

// GR-6: the deterministic reroute raiser.
//
// When a vessel's remaining route crosses a leg that has become hazardous or
// blocked, this records that a cheaper valid alternative exists. It records
// EVIDENCE only — a RerouteDecision — and never creates a Recommendation: under
// D-85 (AIF-1) the tick is not a proposer, and sim.test.ts asserts as much. A
// human or the AI advisor turns that evidence into a proposal, which then goes
// through the ordinary validate → preview → approve pipeline. See the fuller
// explanation at the push site below. No RNG, so it cannot perturb the
// simulation's random stream.
function raiseRerouteAdvisories(state: SimState): void {
  // Built ONCE per tick. It walks the whole edge network, so recomputing it per
  // vessel would cost ~100× more on a 108-vessel population.
  const conditions = edgeConditions(state);

  // EVALUATION CADENCE. Searching for alternatives means running Dijkstra per
  // policy variant, and a large share of tracked vessels legitimately sit on a
  // congested leg at any moment — the Tuas approach chain is shared by every
  // corridor, so it reads as fully congested by construction. Re-searching all
  // of them every tick costs ~78 graph searches per tick to produce nothing.
  //
  // So each vessel is evaluated on a fixed cadence, staggered by its index so
  // the work spreads evenly across ticks. This is a sampling rate, not a filter:
  // a genuine hazard is still found within RAISER_CADENCE_TICKS (50 sim-minutes
  // at 5 min/tick), which is prompt for a voyage-level decision that a human
  // then has to approve. Staggering is by index, never RNG, so the tick stays
  // deterministic.
  const RAISER_CADENCE_TICKS = 10;

  for (let i = 0; i < state.vessels.length; i++) {
    const v = state.vessels[i];
    if (v.scope === undefined || v.status !== "enroute" || !v.track) continue;
    if ((state.clock.tick + i) % RAISER_CADENCE_TICKS !== 0) continue;
    // One open advisory per vessel — a storm lasting 200 ticks must not queue
    // 200 identical cards.
    const alreadyPending = state.maritime.rerouteDecisions.some(
      (d) => d.vesselId === v.id && d.approvalStatus === "pending",
    );
    if (alreadyPending) continue;

    // Cheap check first: only vessels whose route has actually deteriorated pay
    // for a Dijkstra search.
    const reason = rerouteReason(state, v.id, conditions);
    if (!reason) continue;

    const candidates = routeCandidates(state, v.id, conditions);
    const best = candidates[0];
    // Only worth raising if the alternative is shorter (delayAvoided > 0) AND it
    // improves the hazard picture: it is either hazard-free, or it strictly
    // reduces high-risk exposure versus the current route (D-89). The old rule
    // required a FULLY clean alternative, but under a basin-wide storm no route
    // near the affected port clears every high-risk cell — so the least-exposed
    // shorter route, not silence, is the right advice.
    if (!best) continue;
    const activeHighRisk = activeRouteHighRisk(state, v.id, conditions);
    const improvesHazard =
      best.highRiskEdgeIds.length === 0 || best.highRiskEdgeIds.length < activeHighRisk;
    if (!improvesHazard) continue;
    // `safety` means an edge on the current route is BLOCKED — the vessel cannot
    // sail it at all. A detour round a closed strait is longer by construction,
    // so also demanding delayAvoided > 0 meant a genuine safety alternative could
    // never be advised; the only advisories that ever passed were ones that
    // happened to be SHORTER, which is an optimisation, not a hazard response.
    // The time cost is not hidden — it is exactly what MDS-2a's sail/wait/detour
    // comparison puts in front of the manager to weigh. For weather and
    // congestion (no blockage) the route is still sailable, so there the
    // alternative must genuinely save time to be worth raising.
    if (reason !== "safety" && best.delayAvoidedMinutes <= 0) continue;

    const plan = activePlanFor(state, v.id);
    if (!plan) continue;

    const decision: RerouteDecision = {
      id: `RD-${state.seq++}`,
      vesselId: v.id,
      originalPlanId: plan.id,
      reason,
      highRiskEdgeIds: hazardousEdgesOnPlan(state, v, conditions),
      delayAvoidedMinutes: Math.round(best.delayAvoidedMinutes),
      additionalDistanceNm: Math.round(best.additionalDistanceNm),
      approvalStatus: "pending",
      createdTick: state.clock.tick,
    };
    // The tick records the FACT that the route has deteriorated and a better one
    // exists. It does NOT propose the change.
    //
    // D-85 (AIF-1) removed the automatic rule engine: only the AI advisor and
    // the duty manager put items in the decision queue, and sim.test.ts asserts
    // that the tick never creates a recommendation. Pushing one here would break
    // that architecture. Instead this decision is deterministic EVIDENCE —
    // surfaced by the map's route panel and the dev route-graph inspector —
    // from which a human (or the agent, through its tool) proposes the reroute,
    // and the ordinary validate → preview → approve pipeline takes over.
    state.maritime.rerouteDecisions.push(decision);
  }
}

/** Edges on the vessel's remaining route that are currently hazardous. */
function hazardousEdgesOnPlan(
  state: SimState,
  v: Vessel,
  conditions: Map<string, EdgeCondition>,
): string[] {
  const plan = activePlanFor(state, v.id);
  if (!plan || !v.track) return [];
  const out: string[] = [];
  for (let i = v.track.edgeIndex; i < plan.nodeIds.length - 1; i++) {
    const edge = edgeBetween(plan.nodeIds[i], plan.nodeIds[i + 1]);
    const cond = edge && conditions.get(edge.id);
    if (!edge || !cond) continue;
    if (cond.blocked || cond.weatherRisk >= MARITIME_DOCTRINE.routing.highRiskWeatherThreshold) {
      out.push(edge.id);
    }
  }
  return out;
}
