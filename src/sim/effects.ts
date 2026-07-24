import { geoDistance } from "d3-geo";
import { randInt } from "./rng";
import { edgeBetween, sequenceDistanceNm } from "../maritime/graph";
import { routeNodeById } from "../maritime/network";
import { activePlanFor } from "../maritime/selectors";
import { EARTH_RADIUS_NM, nmPerTick } from "../maritime/config";
import type { SimState, SimulationEffect, VesselRoutePlan } from "./types";

/** Great-circle distance in nautical miles. */
function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return geoDistance([lon1, lat1], [lon2, lat2]) * EARTH_RADIUS_NM;
}

function freeBerth(state: SimState, berthId: string | undefined): void {
  if (!berthId) return;
  const berth = state.berths.find((b) => b.id === berthId);
  if (berth && berth.status === "occupied") {
    berth.status = "available";
    berth.vesselId = undefined;
  }
}

/**
 * Applies a validated effect by mutating state in place. Callers must validate
 * first (validateEffect); this assumes the effect is currently valid.
 */
export function applyEffect(state: SimState, effect: SimulationEffect): void {
  switch (effect.kind) {
    case "reassignBerth": {
      const v = state.vessels.find((x) => x.id === effect.vesselId);
      const berth = state.berths.find((b) => b.id === effect.toBerthId);
      if (!v || !berth) return;
      freeBerth(state, v.berthId);
      berth.status = "occupied";
      berth.vesselId = v.id;
      v.berthId = berth.id;
      v.status = "berthing";
      v.phaseEndsTick = state.clock.tick + randInt(state.rng, 1, 2);
      return;
    }
    case "divertVessel": {
      const v = state.vessels.find((x) => x.id === effect.vesselId);
      if (!v) return;
      freeBerth(state, v.berthId);
      v.berthId = undefined;
      v.status = "diverted";
      v.divertToPortId = effect.toPortId;
      v.anchoredSinceTick = undefined;
      v.phaseEndsTick = state.clock.tick + randInt(state.rng, 6, 12);
      return;
    }
    // GR-6: replace a vessel's route WITHOUT moving it (GR-D12b). The eight
    // numbered steps below are the approved execution contract; each one exists
    // because skipping it would teleport the vessel, orphan its history, or let
    // the same decision run twice.
    case "rerouteVoyage": {
      const v = state.vessels.find((x) => x.id === effect.vesselId);
      if (!v?.track) return;
      const plan = activePlanFor(state, v.id);
      if (!plan) return;

      const track = v.track;
      const joinNodeId = effect.toNodeIds[0];
      const joinNode = routeNodeById(joinNodeId);
      if (!joinNode) return;

      // (1)(2) The vessel does not move. Its position and its progress along the
      // leg it is currently sailing are carried across untouched — approval
      // changes the plan, not the ship.
      const { latitude, longitude, speedKnots, courseDeg } = track;

      // (3)(4) Finish the valid remainder of the current leg, then join the new
      // route at the node ahead. (6) Where the join node is not the current
      // leg's own endpoint, a temporary connector carries the vessel there.
      // It is derived per-vessel and NEVER added to the static graph.
      const currentLegEnd = plan.nodeIds[track.edgeIndex + 1];
      const currentEdge = edgeBetween(plan.nodeIds[track.edgeIndex], currentLegEnd);
      const joinSegment =
        currentLegEnd === joinNodeId && currentEdge
          ? // Already heading at the join node: the remainder of this leg IS the
            // connector, so its progress carries over directly.
            {
              fromLat: latitude,
              fromLon: longitude,
              toNodeId: joinNodeId,
              distanceNm: Math.max(0, currentEdge.distanceNm - track.progressNm),
              progressNm: 0,
              sourceEdgeId: currentEdge.id,
              kind: "current_edge_remainder" as const,
            }
          : {
              fromLat: latitude,
              fromLon: longitude,
              toNodeId: joinNodeId,
              distanceNm: haversineNm(latitude, longitude, joinNode.latitude, joinNode.longitude),
              progressNm: 0,
              sourceEdgeId: currentEdge?.id,
              kind: "validated_segment" as const,
            };

      // (7) History is preserved: the old plan is superseded, not deleted, so
      // the original route stays available for comparison and the version
      // lineage remains traceable.
      plan.status = "superseded";

      const newPlan: VesselRoutePlan = {
        id: `RP-${state.seq++}`,
        vesselId: v.id,
        routeVersion: plan.routeVersion + 1,
        status: "active",
        nodeIds: [...effect.toNodeIds],
        originNodeId: joinNodeId,
        destinationNodeId: plan.destinationNodeId,
        totalDistanceNm: sequenceDistanceNm(effect.toNodeIds),
        etaTick: state.clock.tick,
        expectedWaitMinutes: plan.expectedWaitMinutes,
        weatherRisk: 0,
        congestionRisk: 0,
        totalCost: 0,
        createdTick: state.clock.tick,
      };
      // (5) ETA is recalculated from where the vessel ACTUALLY is: the connector
      // plus the new route, at its own speed.
      const remainingNm = joinSegment.distanceNm + newPlan.totalDistanceNm;
      newPlan.etaTick = state.clock.tick + Math.round(remainingNm / nmPerTick(speedKnots));
      state.maritime.routePlans.push(newPlan);

      v.track = {
        routePlanId: newPlan.id,
        edgeIndex: 0,
        progressNm: 0,
        latitude,
        longitude,
        speedKnots,
        courseDeg,
        lastUpdatedTick: state.clock.tick,
        joinSegment,
      };
      v.etaTick = newPlan.etaTick;

      // (8) Mark the decision executed. Combined with the validator's replay
      // check, an approved reroute can run exactly once.
      if (effect.decisionId) {
        const decision = state.maritime.rerouteDecisions.find((d) => d.id === effect.decisionId);
        if (decision) {
          decision.approvalStatus = "executed";
          decision.newPlanId = newPlan.id;
        }
      }
      return;
    }
    case "holdVessel": {
      const v = state.vessels.find((x) => x.id === effect.vesselId);
      if (!v) return;
      v.etaTick = Math.max(v.etaTick, effect.untilTick);
      if (v.status === "anchored") v.anchoredSinceTick = effect.untilTick;
      // D-58: earliest-release marker — assignBerths won't berth the vessel
      // before this tick, and the twin derives its "held" presentation from it.
      v.heldUntilTick = effect.untilTick;
      return;
    }
    case "reallocateYard": {
      for (const lot of state.cargoLots) {
        if (effect.lotIds.includes(lot.id) && lot.status === "yard") {
          lot.blockId = effect.toBlockId;
          lot.slotRegion = `${effect.toBlockId}-reallocated`;
        }
      }
      return;
    }
    case "closeBerth": {
      const berth = state.berths.find((b) => b.id === effect.berthId);
      if (berth) berth.status = "closed";
      return;
    }
    case "safetyStockAdvisory": {
      const c = state.customers.find((x) => x.id === effect.customerId);
      if (c) {
        // D-56: apply exactly the typed, validated quantity — the displayed
        // days ARE the executed days; no literal lives in this path.
        c.safetyStockDays += effect.days;
        c.daysOfCoverRemaining = Number((c.daysOfCoverRemaining + effect.days).toFixed(1));
      }
      return;
    }
  }
}
