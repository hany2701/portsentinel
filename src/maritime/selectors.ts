import { geoDistance } from "d3-geo";
import { WEATHER_POINTS } from "../sim/config";
import { EARTH_RADIUS_NM } from "./config";
import { MARITIME_DOCTRINE } from "./maritimeDoctrine";
import { ROUTE_EDGES, routeNodeById } from "./network";
import { edgeBetween } from "./graph";
import { TUAS_PORT_ID } from "./ports";
import { inRegionalScope } from "./geofence";
import { anchorageQueue } from "../sim/derive";
import type { SimState, Vessel, VesselRoutePlan } from "../sim/types";

// GR-2: pure derivations over SimState. Nothing here is stored — clusters,
// polylines, KPIs and edge conditions are all recomputed from the authoritative
// vessel entities, so no view can disagree with another about the world.

/** Every vessel the maritime engine owns (the 22 Tuas baseline have no scope). */
export function trackedVessels(sim: SimState): Vessel[] {
  return sim.vessels.filter((v) => v.scope !== undefined);
}

/** The 22 frozen Tuas baseline vessels. */
export function tuasBaselineVessels(sim: SimState): Vessel[] {
  return sim.vessels.filter((v) => v.scope === undefined);
}

/**
 * Vessels the geographic maps may draw. A vessel that has handed over to the
 * Tuas twin is excluded even though it still carries its last known position:
 * exactly one frame depicts a vessel at a time, so the two can never be shown
 * simultaneously (GR-D6 single-representation rule).
 */
export function geographicVessels(sim: SimState): Vessel[] {
  return trackedVessels(sim).filter((v) => v.status === "enroute" && v.track !== undefined);
}

/**
 * Vessels the regional map draws individually — a POSITION question, not a
 * trade one, so a deep-sea ship near Singapore counts and a regional ship off
 * Surabaya may not.
 */
export function regionalVessels(sim: SimState): Vessel[] {
  return geographicVessels(sim).filter((v) => inRegionalScope(v.track!));
}

/**
 * Tracked vessels that have crossed into the Tuas operational frame (GR-7).
 *
 * These are deliberately absent from `geographicVessels`, so without this the
 * regional map would simply lose them at the fence. Instead they are summarised
 * as one aggregate at the Tuas anchorage: the map states how many of its vessels
 * are now inside the terminal, and the twin is where their individual positions
 * live. One vessel, one frame, no gap in the story.
 *
 * These are the ≤3 tracked arrivals of GR-D12a — never the 22 baseline vessels,
 * which have no geographic identity at all.
 */
export function tuasFrameVessels(sim: SimState): Vessel[] {
  return trackedVessels(sim).filter((v) => v.status !== "enroute");
}

export function activePlanFor(sim: SimState, vesselId: string): VesselRoutePlan | undefined {
  return sim.maritime.routePlans.find((p) => p.vesselId === vesselId && p.status === "active");
}

export function planById(sim: SimState, planId: string): VesselRoutePlan | undefined {
  return sim.maritime.routePlans.find((p) => p.id === planId);
}

/** The superseded plan a reroute replaced, for original-vs-recommended overlays. */
export function originalPlanFor(sim: SimState, vesselId: string): VesselRoutePlan | undefined {
  return sim.maritime.routePlans
    .filter((p) => p.vesselId === vesselId)
    .sort((a, b) => a.routeVersion - b.routeVersion)[0];
}

/** [lon, lat] pairs for a plan's node sequence — derived, never stored. */
export function planPolyline(plan: VesselRoutePlan): [number, number][] {
  return plan.nodeIds.flatMap((id) => {
    const node = routeNodeById(id);
    return node ? [[node.longitude, node.latitude] as [number, number]] : [];
  });
}

/**
 * The remaining route from where the vessel actually is — the vessel's current
 * position followed by the nodes still ahead of it. This is what the map draws,
 * so a route line always starts at the ship and never at a distant waypoint.
 */
export function remainingPolyline(sim: SimState, vessel: Vessel): [number, number][] {
  if (!vessel.track) return [];
  const plan = planById(sim, vessel.track.routePlanId);
  if (!plan) return [];
  const here: [number, number] = [vessel.track.longitude, vessel.track.latitude];
  const joinNodeId = vessel.track.joinSegment?.toNodeId;
  const joinIndex = joinNodeId ? plan.nodeIds.indexOf(joinNodeId) : -1;
  const fromIndex = joinIndex >= 0 ? joinIndex : vessel.track.edgeIndex + 1;
  const ahead = plan.nodeIds.slice(fromIndex).flatMap((id) => {
    const node = routeNodeById(id);
    return node ? [[node.longitude, node.latitude] as [number, number]] : [];
  });
  return [here, ...ahead];
}

/**
 * The temporary connector an approved reroute created (MDS-4, brief §5.5).
 *
 * After a reroute the vessel does NOT jump onto the new route: it keeps making
 * way from exactly where it was, along a `joinSegment` that runs to the node
 * where it rejoins the approved path (the GR-D12b no-teleport contract). That
 * connector is per-vessel derived data and never part of the static graph, so it
 * is drawn as its own route state rather than folded into the active line —
 * otherwise the map shows a reroute as a clean switch and the guarantee the
 * engine actually provides goes unseen.
 *
 * Empty when no reroute is in flight.
 */
export function joinPolyline(vessel: Vessel): [number, number][] {
  const join = vessel.track?.joinSegment;
  if (!join || !vessel.track) return [];
  const to = routeNodeById(join.toNodeId);
  if (!to) return [];
  return [
    [vessel.track.longitude, vessel.track.latitude],
    [to.longitude, to.latitude],
  ];
}

// --- Edge conditions -------------------------------------------------------

export type EdgeCondition = {
  weatherRisk: number; // 0-100
  congestionRisk: number; // 0-100
  blocked: boolean;
  restricted: boolean;
};

// The simulation resolves ONE weather state for the Singapore/Malacca area
// (D-52). These cells carry that same state out along the corridor rather than
// inventing separate weather systems — so a storm is classified identically in
// the global, regional and Tuas views (plan §13).
const HOME_WEATHER_CELLS: readonly WeatherCell[] = [WEATHER_POINTS.tuas, WEATHER_POINTS.strait];

type WeatherCell = { latitude: number; longitude: number };

/** A weather source: how bad it is, and the points it radiates from. */
type WeatherSource = { risk: number; cells: readonly WeatherCell[] };

/**
 * Where weather actually sits (D-91).
 *
 * Two kinds of source, deliberately kept apart:
 *
 * - **Ambient** — the simulation's single resolved weather state (D-52),
 *   radiating from Tuas and the Strait as it always has.
 * - **Storms** — each active storm radiates from ITS OWN cells. A storm may name
 *   route nodes in `targetIds` (the same field `craneFailure` and `berthClosure`
 *   already use for crane and berth ids), and then it sits there — at Hormuz, at
 *   Suez — instead of over Singapore. A storm with no targets falls back to the
 *   home cells, so a storm injected the old way behaves exactly as before.
 *
 * Keeping them apart is the whole point: a storm at Suez must raise Suez's risk
 * WITHOUT raising Singapore's. Folding storm severity into one global ambient
 * figure (the previous behaviour) made every storm a Singapore storm.
 *
 * Targets that do not resolve to a route node are ignored rather than guessed at.
 */
function weatherSources(sim: SimState): WeatherSource[] {
  const sources: WeatherSource[] = [{ risk: sim.weather.riskIndex, cells: HOME_WEATHER_CELLS }];

  for (const d of sim.disruptions) {
    if (d.type !== "storm") continue;
    if (sim.clock.tick >= d.startTick + d.durationTicks) continue;

    const targeted: WeatherCell[] = [];
    for (const id of d.targetIds) {
      const node = routeNodeById(id);
      if (node) targeted.push({ latitude: node.latitude, longitude: node.longitude });
    }

    if (targeted.length > 0) {
      // A remote storm's intensity comes from its own severity: a Red Sea storm
      // must not be mild merely because Singapore is calm.
      sources.push({ risk: MARITIME_DOCTRINE.weather.stormCentreRiskBySeverity[d.severity], cells: targeted });
    } else {
      // A local storm keeps the historical formula — it rides on top of the
      // Singapore weather state that the overlay is already driving.
      sources.push({ risk: Math.min(100, sim.weather.riskIndex + d.severity * 15), cells: HOME_WEATHER_CELLS });
    }
  }
  return sources;
}

function edgeMidpoint(fromId: string, toId: string): { latitude: number; longitude: number } | null {
  const a = routeNodeById(fromId);
  const b = routeNodeById(toId);
  if (!a || !b) return null;
  return { latitude: (a.latitude + b.latitude) / 2, longitude: (a.longitude + b.longitude) / 2 };
}

/**
 * Per-edge weather, congestion and blocking, derived fresh from weather state,
 * active disruptions and where the tracked vessels currently are.
 */
export function edgeConditions(sim: SimState): Map<string, EdgeCondition> {
  const { weather, congestion, routing } = MARITIME_DOCTRINE;

  // Traffic density: how many tracked vessels are currently sailing each edge.
  const trafficByEdge = new Map<string, number>();
  for (const v of trackedVessels(sim)) {
    if (!v.track) continue;
    const plan = planById(sim, v.track.routePlanId);
    if (!plan || plan.status !== "active") continue;
    const from = plan.nodeIds[v.track.edgeIndex];
    const to = plan.nodeIds[v.track.edgeIndex + 1];
    if (!from || !to) continue;
    const key = [from, to].sort().join("__");
    trafficByEdge.set(key, (trafficByEdge.get(key) ?? 0) + 1);
  }

  const sources = weatherSources(sim);

  const conditions = new Map<string, EdgeCondition>();
  for (const edge of ROUTE_EDGES) {
    const mid = edgeMidpoint(edge.fromNodeId, edge.toNodeId);
    let weatherRisk = 0;
    if (mid) {
      // Each source's risk falls off linearly with distance from its nearest
      // cell; the worst source wins. An edge far from every source sits at 0,
      // which is what keeps a storm local to where it actually is.
      for (const source of sources) {
        const nearestNm = Math.min(
          ...source.cells.map(
            (c) => geoDistance([c.longitude, c.latitude], [mid.longitude, mid.latitude]) * EARTH_RADIUS_NM,
          ),
        );
        const reach = Math.max(0, 1 - nearestNm / weather.cellRadiusNm);
        weatherRisk = Math.max(weatherRisk, Math.round(source.risk * reach));
      }
    }

    const traffic = trafficByEdge.get([edge.fromNodeId, edge.toNodeId].sort().join("__")) ?? 0;
    const congestionRisk = Math.min(
      100,
      Math.round((traffic / congestion.vesselsForFullCongestion) * 100),
    );

    conditions.set(edge.id, {
      weatherRisk,
      congestionRisk,
      blocked: weatherRisk >= routing.blockWeatherRiskAtOrAbove,
      restricted: (edge.restrictions?.length ?? 0) > 0,
    });
  }
  return conditions;
}

/**
 * Vessels whose REMAINING route crosses a hazardous or blocked leg (D-91).
 *
 * This is the brief's "exposed" state: not every vessel near bad weather, but
 * every vessel that is actually going to sail through it. Derived from the same
 * `edgeConditions` the cost model and the reroute raiser use, so the map can
 * never disagree with the engine about who is at risk.
 *
 * Legs already behind the vessel are excluded — a ship that has cleared the
 * storm is no longer exposed to it.
 */
export function exposedVessels(
  sim: SimState,
  conditions: Map<string, EdgeCondition> = edgeConditions(sim),
): Vessel[] {
  const { routing } = MARITIME_DOCTRINE;
  return geographicVessels(sim).filter((v) => {
    const plan = planById(sim, v.track!.routePlanId);
    if (!plan || plan.status !== "active") return false;
    for (let i = v.track!.edgeIndex; i < plan.nodeIds.length - 1; i++) {
      const edge = edgeBetween(plan.nodeIds[i], plan.nodeIds[i + 1]);
      const cond = edge && conditions.get(edge.id);
      if (!cond) continue;
      if (cond.blocked || cond.weatherRisk >= routing.highRiskWeatherThreshold) return true;
    }
    return false;
  });
}

/**
 * Tuas-bound vessels STILL AT SEA on a corridor — the ones a reroute can still
 * help. This is deliberately NOT every vessel heading for Tuas.
 *
 * The anchorage queue and the approaching stream (typically ~18 vessels) are
 * baseline vessels living in the D-62 operational frame. They carry no
 * `destinationPortId` at all — that field exists only on tracked maritime
 * vessels (GR-1) — and they are no longer on the route graph, so no corridor
 * reroute applies to them. They are downstream of this question, not part of it:
 * see `tuasQueueVessels` for the arrival picture and the MDS-5 impact chain.
 *
 * The brief asks the map "which exposed vessels are heading to Tuas?", which is
 * this intersected with `exposedVessels`. Kept as its own selector because "is
 * it mine?" and "is it in danger?" are separate questions.
 */
export function tuasBoundAtSea(sim: SimState): Vessel[] {
  return geographicVessels(sim).filter((v) => v.destinationPortId === TUAS_PORT_ID);
}

/**
 * The Tuas arrival queue: everything waiting at the anchorage or still inbound.
 *
 * A corridor disruption cannot reroute these, but they are exactly where a
 * reroute's consequence LANDS — an arrival that shifts changes anchorage demand
 * and the berth window.
 *
 * The waiting half composes `anchorageQueue()` from sim/derive rather than
 * re-filtering on status, so the map, the Operations tab badge and the doctrine
 * ordering all answer "who is waiting" from ONE definition.
 */
export function tuasQueueVessels(sim: SimState): { waiting: Vessel[]; approaching: Vessel[] } {
  return {
    waiting: anchorageQueue(sim),
    approaching: sim.vessels.filter((v) => v.status === "approaching"),
  };
}

/** The weather-driven speed multiplier for an edge, per the doctrine bands. */
export function weatherSpeedFactor(weatherRisk: number): number {
  const { weather, movement, routing } = MARITIME_DOCTRINE;
  if (weatherRisk >= routing.blockWeatherRiskAtOrAbove) return 0;
  if (weatherRisk >= weather.severeRiskAtOrAbove) return movement.severeSpeedFactor;
  if (weatherRisk >= weather.cautionRiskAtOrAbove) return movement.cautionSpeedFactor;
  return 1;
}

// --- KPIs ------------------------------------------------------------------

export type MaritimeKpis = {
  activeVessels: number;
  vesselsAtRisk: number;
  reroutesPending: number;
  reroutesExecuted: number;
  averageDelayAvoidedMinutes: number;
};

function kpisFor(sim: SimState, vessels: Vessel[]): MaritimeKpis {
  const conditions = edgeConditions(sim);
  const ids = new Set(vessels.map((v) => v.id));

  let atRisk = 0;
  for (const v of vessels) {
    if (!v.track) continue;
    const plan = planById(sim, v.track.routePlanId);
    if (!plan || plan.status !== "active") continue;
    const onRisk = plan.nodeIds.slice(v.track.edgeIndex).some((id, i, arr) => {
      const next = arr[i + 1];
      if (!next) return false;
      const cond = conditions.get(`E-${id}__${next}`) ?? conditions.get(`E-${next}__${id}`);
      return cond ? cond.blocked || cond.weatherRisk >= MARITIME_DOCTRINE.weather.severeRiskAtOrAbove : false;
    });
    if (onRisk) atRisk++;
  }

  const decisions = sim.maritime.rerouteDecisions.filter((d) => ids.has(d.vesselId));
  const executed = decisions.filter((d) => d.approvalStatus === "executed");
  return {
    activeVessels: vessels.length,
    vesselsAtRisk: atRisk,
    reroutesPending: decisions.filter((d) => d.approvalStatus === "pending").length,
    reroutesExecuted: executed.length,
    averageDelayAvoidedMinutes:
      executed.length === 0
        ? 0
        : Math.round(executed.reduce((s, d) => s + d.delayAvoidedMinutes, 0) / executed.length),
  };
}

export function globalKpis(sim: SimState): MaritimeKpis {
  return kpisFor(sim, trackedVessels(sim));
}

export function regionalKpis(sim: SimState): MaritimeKpis {
  return kpisFor(sim, regionalVessels(sim));
}
