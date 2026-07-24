import { DOCTRINE } from "./doctrine";
import { yardBlockOccupiedTEU } from "./derive";
import { edgeBetween, isConnectedSequence } from "../maritime/graph";
import { routeNodeById } from "../maritime/network";
import { activePlanFor, edgeConditions } from "../maritime/selectors";
import { projectionNodeAhead } from "../maritime/routeEngine";
import type { SimState, SimulationEffect, CargoType } from "./types";

export type ValidationResult = { status: "valid" | "invalid"; message: string };

const VALID: ValidationResult = { status: "valid", message: "OK" };
const invalid = (message: string): ValidationResult => ({ status: "invalid", message });

function blockAccepts(blockId: string, type: CargoType): boolean {
  const isReeferBlock = (DOCTRINE.yard.reeferBlockIds as readonly string[]).includes(blockId);
  const isHazBlock = blockId === DOCTRINE.yard.hazmatBlockId;
  if (type === "reefer") return isReeferBlock;
  if (type === "hazmat") return isHazBlock;
  return !isReeferBlock && !isHazBlock;
}

export function validateEffect(state: SimState, effect: SimulationEffect): ValidationResult {
  switch (effect.kind) {
    case "reassignBerth": {
      const v = state.vessels.find((x) => x.id === effect.vesselId);
      if (!v) return invalid("Vessel not found.");
      if (v.status === "departing" || v.status === "diverted")
        return invalid("Vessel is leaving and cannot be re-berthed.");
      const berth = state.berths.find((b) => b.id === effect.toBerthId);
      if (!berth) return invalid("Target berth not found.");
      if (berth.status === "closed") return invalid("Target berth is closed.");
      if (berth.status === "occupied" && berth.vesselId !== v.id)
        return invalid("Target berth is occupied.");
      if (v.class === "neopanamax" && !berth.deepWater)
        return invalid("Neopanamax requires a deep-water berth (B1-B6).");
      return VALID;
    }
    case "divertVessel": {
      const v = state.vessels.find((x) => x.id === effect.vesselId);
      if (!v) return invalid("Vessel not found.");
      if (v.status !== "approaching" && v.status !== "anchored")
        return invalid("Only approaching or anchored vessels can be diverted.");
      if (!state.alternatePorts.some((p) => p.id === effect.toPortId))
        return invalid("Alternate port not on the approved list.");
      return VALID;
    }
    case "holdVessel": {
      const v = state.vessels.find((x) => x.id === effect.vesselId);
      if (!v) return invalid("Vessel not found.");
      // MDS-2a (D-96): a vessel at sea can be held too — heaving to or easing
      // back to let a storm pass is ordinary seamanship, and it is very often
      // the right answer. Refusing it here was why the engine could only ever
      // offer a detour, however absurd, and why the AI advisor was told
      // "invalid" for exactly the vessels that needed a hold.
      const holdable = v.status === "approaching" || v.status === "anchored" || v.status === "enroute";
      if (!holdable)
        return invalid("Only approaching, anchored or enroute vessels can be held.");
      if (v.status === "enroute" && !v.track)
        return invalid("Vessel is not under maritime route tracking.");
      if (effect.untilTick <= state.clock.tick) return invalid("Hold time must be in the future.");
      return VALID;
    }
    // GR-6: replace a vessel's route while it keeps sailing. Every check here
    // exists to make the execution contract enforceable — see applyEffect.
    case "rerouteVoyage": {
      const v = state.vessels.find((x) => x.id === effect.vesselId);
      if (!v) return invalid("Vessel not found.");
      if (!v.track) return invalid("Vessel is not under maritime route tracking.");
      if (v.status !== "enroute")
        return invalid("Only vessels sailing a route can be rerouted; use divert or hold inside the Tuas approach.");

      const plan = activePlanFor(state, v.id);
      if (!plan) return invalid("Vessel has no active route plan.");

      // Replay guard: an executed decision must never run twice.
      if (effect.decisionId) {
        const decision = state.maritime.rerouteDecisions.find((d) => d.id === effect.decisionId);
        if (!decision) return invalid("Reroute decision not found.");
        if (decision.approvalStatus === "executed") return invalid("This reroute has already been executed.");
      }

      if (effect.toNodeIds.length < 2) return invalid("A route needs at least two nodes.");
      for (const nodeId of effect.toNodeIds) {
        if (!routeNodeById(nodeId)) return invalid(`Unknown route node ${nodeId}.`);
      }
      if (!isConnectedSequence(effect.toNodeIds))
        return invalid("Proposed route is not connected in the approved network.");

      // Same-destination scope (GR-D12c): changing where a vessel goes is the
      // separate divert decision, with different operational consequences.
      if (effect.toNodeIds[effect.toNodeIds.length - 1] !== plan.destinationNodeId)
        return invalid("Reroute must keep the same destination; use divert to change ports.");

      // No-teleport anchor: the new route must begin at the next node ahead, so
      // an approved change can never move the vessel backwards.
      const ahead = projectionNodeAhead(state, v);
      if (!ahead) return invalid("Vessel has no node ahead to rejoin from.");
      if (effect.toNodeIds[0] !== ahead)
        return invalid("Reroute must start from the next node ahead of the vessel.");

      // The route must be sailable now — no blocked legs, and the connector to
      // the join node must itself be a validated stretch of water.
      const conditions = edgeConditions(state);
      for (let i = 0; i < effect.toNodeIds.length - 1; i++) {
        const edge = edgeBetween(effect.toNodeIds[i], effect.toNodeIds[i + 1]);
        if (!edge) return invalid("Proposed route uses an unknown leg.");
        const cond = conditions.get(edge.id);
        if (cond?.blocked) return invalid("Proposed route crosses a blocked segment.");
        if (cond?.restricted) return invalid("Proposed route crosses a restricted area.");
      }
      const joinEdge = edgeBetween(plan.nodeIds[v.track.edgeIndex], ahead);
      const joinCondition = joinEdge && conditions.get(joinEdge.id);
      if (joinCondition?.blocked)
        return invalid("The remainder of the current leg is blocked; the vessel cannot reach the join point.");

      return VALID;
    }
    case "reallocateYard": {
      const block = state.yardBlocks.find((b) => b.id === effect.toBlockId);
      if (!block) return invalid("Target block not found.");
      const lots = state.cargoLots.filter((l) => effect.lotIds.includes(l.id));
      if (lots.length === 0) return invalid("No matching lots.");
      if (lots.some((l) => l.status !== "yard")) return invalid("Only yard lots can be re-allocated.");
      if (lots.some((l) => !blockAccepts(block.id, l.type)))
        return invalid("Target block cannot accept this cargo type.");
      const incoming = lots.reduce((s, l) => s + l.quantityTEU, 0);
      const room = block.capacityTEU - yardBlockOccupiedTEU(state, block.id);
      if (incoming > room) return invalid("Target block lacks capacity.");
      return VALID;
    }
    case "closeBerth": {
      const berth = state.berths.find((b) => b.id === effect.berthId);
      if (!berth) return invalid("Berth not found.");
      if (berth.status === "occupied") return invalid("Cannot close an occupied berth.");
      if (berth.status === "closed") return invalid("Berth already closed.");
      return VALID;
    }
    case "safetyStockAdvisory": {
      if (!state.customers.some((c) => c.id === effect.customerId))
        return invalid("Customer not found.");
      if (!Number.isInteger(effect.days) || effect.days < 1)
        return invalid("Safety-stock days must be an integer >= 1.");
      return VALID;
    }
  }
}
