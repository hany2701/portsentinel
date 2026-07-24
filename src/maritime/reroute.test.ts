import { describe, expect, it } from "vitest";
import { geoDistance } from "d3-geo";
import { applyEffect, generateWorld, previewEffect, tick, validateEffect } from "../sim";
import { EARTH_RADIUS_NM, nmPerTick } from "./config";
import { projectionNodeAhead, routeCandidates } from "./routeEngine";
import { activePlanFor, originalPlanFor, remainingPolyline, trackedVessels } from "./selectors";
import type { SimState, SimulationEffect, Vessel } from "../sim";

// GR-6 §13 / GR-D12b: the no-teleport execution contract.
//
// Approving a reroute changes the PLAN, never the ship. These tests pin every
// clause of that contract, because a vessel that jumps on approval destroys the
// credibility of the whole decision-support story.

const SEED = 20260710;

function nmBetween(a: [number, number], b: [number, number]): number {
  return geoDistance(a, b) * EARTH_RADIUS_NM;
}

const posOf = (v: Vessel): [number, number] => [v.track!.longitude, v.track!.latitude];
const find = (s: SimState, id: string) => s.vessels.find((v) => v.id === id)!;

/**
 * A vessel with a real alternative, plus the effect that would reroute it.
 *
 * Tuas-bound vessels are excluded: they cross the approach geofence and hand
 * over to the Tuas FSM within a few ticks, so they cannot demonstrate a route
 * being sailed to completion. Rerouting them is still valid — it is covered by
 * the validation tests — but the movement assertions need a vessel that stays
 * in the geographic frame.
 */
function reroutable(state: SimState): { vessel: Vessel; effect: SimulationEffect } | null {
  for (const v of trackedVessels(state)) {
    if (v.status !== "enroute" || !v.track) continue;
    if (v.destinationPortId === "PORT-TUAS") continue;
    const plan = activePlanFor(state, v.id);
    if (!plan || plan.nodeIds.length - v.track.edgeIndex < 4) continue;
    const candidate = routeCandidates(state, v.id)[0];
    if (!candidate) continue;
    return {
      vessel: v,
      effect: {
        kind: "rerouteVoyage",
        vesselId: v.id,
        toNodeIds: candidate.nodeIds,
        reason: "weather",
      },
    };
  }
  return null;
}

function withReroutable<T>(fn: (state: SimState, vessel: Vessel, effect: SimulationEffect) => T): T {
  let state = generateWorld(SEED);
  for (let attempt = 0; attempt < 40; attempt++) {
    const found = reroutable(state);
    if (found) return fn(state, found.vessel, found.effect);
    state = tick(state);
  }
  throw new Error("no reroutable vessel found");
}

describe("reroute execution — no teleport (GR-6)", () => {
  it("does not move the vessel at the instant of approval", () => {
    withReroutable((state, vessel, effect) => {
      const before = posOf(find(state, vessel.id));
      applyEffect(state, effect);
      const after = posOf(find(state, vessel.id));
      // Not "close to" — identical. Approval changes the plan, not the ship.
      expect(after).toEqual(before);
    });
  });

  it("keeps approval-tick displacement inside the valid movement bound", () => {
    withReroutable((state, vessel, effect) => {
      const before = posOf(find(state, vessel.id));
      const speed = find(state, vessel.id).track!.speedKnots;
      applyEffect(state, effect);
      const advanced = tick(state);
      const moved = nmBetween(before, posOf(find(advanced, vessel.id)));
      // One tick of travel at its own speed, and no more.
      expect(moved).toBeLessThanOrEqual(nmPerTick(speed) * 1.05);
    });
  });

  it("continues moving normally on the following ticks", () => {
    withReroutable((state, vessel, effect) => {
      applyEffect(state, effect);
      let s = state;
      const positions: [number, number][] = [posOf(find(s, vessel.id))];
      for (let i = 0; i < 6; i++) {
        s = tick(s);
        positions.push(posOf(find(s, vessel.id)));
      }
      // Every step is a real, bounded step — no stalls, no jumps.
      const speed = find(s, vessel.id).track!.speedKnots;
      for (let i = 1; i < positions.length; i++) {
        const step = nmBetween(positions[i - 1], positions[i]);
        expect(step).toBeLessThanOrEqual(nmPerTick(speed) * 1.6);
      }
      expect(nmBetween(positions[0], positions[positions.length - 1])).toBeGreaterThan(0);
    });
  });

  it("does not reset route progress to a distant node", () => {
    withReroutable((state, vessel, effect) => {
      const before = find(state, vessel.id);
      const beforePos = posOf(before);
      // Resolve the node ahead BEFORE applying — afterwards it would answer
      // against the new plan, not the one the vessel was sailing.
      const ahead = projectionNodeAhead(state, before);
      applyEffect(state, effect);
      const after = find(state, vessel.id);

      // The vessel is on a connector from where it actually is …
      expect(after.track!.joinSegment).toBeDefined();
      expect(after.track!.joinSegment!.fromLat).toBe(beforePos[1]);
      expect(after.track!.joinSegment!.fromLon).toBe(beforePos[0]);
      // … and the join node is the one immediately ahead, never a far waypoint.
      expect(after.track!.joinSegment!.toNodeId).toBe(ahead);
      // The connector is short: it is a rejoin, not a voyage.
      expect(after.track!.joinSegment!.distanceNm).toBeLessThan(before.track!.progressNm + 3000);
    });
  });

  it("consumes the join segment over several ticks, then sails the new route", () => {
    withReroutable((state, vessel, effect) => {
      applyEffect(state, effect);
      const connectorNm = find(state, vessel.id).track!.joinSegment!.distanceNm;
      const speed = find(state, vessel.id).track!.speedKnots;
      // Budget the connector's own length at the vessel's own speed, with slack
      // for weather slowdowns — not an arbitrary tick count.
      const budget = Math.ceil(connectorNm / nmPerTick(speed)) * 3 + 20;

      let s = state;
      // Seed with the connector's state AT APPROVAL (progress 0) so the strict
      // increase below is measured from where the vessel actually started. Taking
      // the first sample after a tick made the assertion depend on the connector
      // outliving two ticks, which is a property of the fixture's geometry, not
      // of the join-segment contract being tested.
      const progressSeen: number[] = [find(state, vessel.id).track!.joinSegment!.progressNm];
      let consumedAt = -1;
      for (let i = 0; i < budget; i++) {
        s = tick(s);
        const v = find(s, vessel.id);
        if (v.status !== "enroute") break; // handed to the Tuas FSM; not our case
        const join = v.track?.joinSegment;
        if (join) progressSeen.push(join.progressNm);
        else {
          consumedAt = i;
          break;
        }
      }
      // Progress accumulated monotonically while the connector was active.
      // Non-decreasing rather than strictly increasing: severe weather can slow
      // a vessel to a standstill for a tick, which is correct behaviour — what
      // must never happen is progress going backwards.
      for (let i = 1; i < progressSeen.length; i++) {
        expect(progressSeen[i]).toBeGreaterThanOrEqual(progressSeen[i - 1]);
      }
      expect(progressSeen[progressSeen.length - 1]).toBeGreaterThan(progressSeen[0]);
      // … and it was eventually consumed exactly once, never reappearing.
      expect(consumedAt).toBeGreaterThanOrEqual(0);
      for (let i = 0; i < 10; i++) {
        s = tick(s);
        expect(find(s, vessel.id).track?.joinSegment).toBeUndefined();
      }
    });
  });

  it("keeps the connector on a validated stretch of water", () => {
    withReroutable((state, vessel, effect) => {
      applyEffect(state, effect);
      const join = find(state, vessel.id).track!.joinSegment!;
      // Its provenance is recorded: either the remainder of the leg the vessel
      // was already sailing, or an explicitly validated segment.
      expect(["current_edge_remainder", "validated_segment"]).toContain(join.kind);
      expect(join.distanceNm).toBeGreaterThanOrEqual(0);
      expect(join.progressNm).toBe(0);
    });
  });

  it("never adds the connector to the static route graph", () => {
    withReroutable(async (state, vessel, effect) => {
      const { ROUTE_EDGES, ROUTE_NODES } = await import("./network");
      const edgesBefore = ROUTE_EDGES.length;
      const nodesBefore = ROUTE_NODES.length;
      applyEffect(state, effect);
      const { ROUTE_EDGES: after, ROUTE_NODES: afterNodes } = await import("./network");
      expect(after.length).toBe(edgesBefore);
      expect(afterNodes.length).toBe(nodesBefore);
      // The connector lives on the vessel, not in the network.
      expect(find(state, vessel.id).track!.joinSegment).toBeDefined();
    });
  });

  it("renders the active route from the vessel's actual position", () => {
    withReroutable((state, vessel, effect) => {
      applyEffect(state, effect);
      const v = find(state, vessel.id);
      const polyline = remainingPolyline(state, v);
      expect(polyline.length).toBeGreaterThan(1);
      // The drawn route begins where the ship is — not at a waypoint behind or
      // ahead of it.
      expect(nmBetween(polyline[0], posOf(v))).toBeLessThan(1);
    });
  });
});

describe("reroute lineage and replay protection (GR-6)", () => {
  it("supersedes the old plan once and bumps the version exactly once", () => {
    withReroutable((state, vessel, effect) => {
      const original = activePlanFor(state, vessel.id)!;
      applyEffect(state, effect);

      const active = activePlanFor(state, vessel.id)!;
      expect(active.routeVersion).toBe(original.routeVersion + 1);
      expect(active.destinationNodeId).toBe(original.destinationNodeId);

      // The original survives for comparison, marked superseded — history is
      // preserved, not overwritten.
      const kept = state.maritime.routePlans.find((p) => p.id === original.id)!;
      expect(kept.status).toBe("superseded");
      expect(originalPlanFor(state, vessel.id)!.id).toBe(original.id);
      // Exactly one active plan.
      expect(
        state.maritime.routePlans.filter((p) => p.vesselId === vessel.id && p.status === "active"),
      ).toHaveLength(1);
    });
  });

  it("recalculates ETA from where the vessel actually is", () => {
    withReroutable((state, vessel, effect) => {
      applyEffect(state, effect);
      const v = find(state, vessel.id);
      const plan = activePlanFor(state, vessel.id)!;
      expect(plan.etaTick).toBeGreaterThan(state.clock.tick);
      expect(v.etaTick).toBe(plan.etaTick);

      // The ETA accounts for the connector plus the new route, at its own speed.
      const total = v.track!.joinSegment!.distanceNm + plan.totalDistanceNm;
      const expected = state.clock.tick + Math.round(total / nmPerTick(v.track!.speedKnots));
      expect(plan.etaTick).toBe(expected);
    });
  });

  it("refuses to execute the same decision twice", () => {
    withReroutable((state, vessel, effect) => {
      const plan = activePlanFor(state, vessel.id)!;
      const decision = {
        id: "RD-REPLAY",
        vesselId: vessel.id,
        originalPlanId: plan.id,
        reason: "weather" as const,
        highRiskEdgeIds: [],
        delayAvoidedMinutes: 30,
        additionalDistanceNm: 10,
        approvalStatus: "pending" as const,
        createdTick: state.clock.tick,
      };
      state.maritime.rerouteDecisions.push(decision);
      const withDecision = { ...effect, decisionId: decision.id } as SimulationEffect;

      expect(validateEffect(state, withDecision).status).toBe("valid");
      applyEffect(state, withDecision);
      expect(decision.approvalStatus).toBe("executed");

      const versionAfterFirst = activePlanFor(state, vessel.id)!.routeVersion;
      // The replay guard rejects the second attempt outright.
      const second = validateEffect(state, withDecision);
      expect(second.status).toBe("invalid");
      expect(second.message).toMatch(/already been executed/i);
      expect(activePlanFor(state, vessel.id)!.routeVersion).toBe(versionAfterFirst);
    });
  });

  it("leaves the original route active when a reroute is not applied", () => {
    withReroutable((state, vessel, effect) => {
      const before = structuredClone(state.maritime);
      // Merely generating and validating candidates changes nothing.
      routeCandidates(state, vessel.id);
      validateEffect(state, effect);
      expect(state.maritime).toEqual(before);
    });
  });

  it("previews impact without mutating the simulation", () => {
    withReroutable((state, vessel, effect) => {
      const before = structuredClone(state);
      const preview = previewEffect(state, effect, 24);
      expect(state).toEqual(before);
      expect(preview.valid).toBe(true);
      expect(preview.without).toBeDefined();
      expect(preview.withEffect).toBeDefined();
      // The what-if ran on throwaway clones: the real vessel never rerouted.
      expect(find(state, vessel.id).track!.joinSegment).toBeUndefined();
    });
  });
});

describe("reroute validation (GR-6)", () => {
  it("rejects a route to a different destination", () => {
    withReroutable((state, _vessel, effect) => {
      const truncated = {
        ...effect,
        toNodeIds: (effect as { toNodeIds: string[] }).toNodeIds.slice(0, -1),
      } as SimulationEffect;
      const result = validateEffect(state, truncated);
      expect(result.status).toBe("invalid");
      expect(result.message).toMatch(/same destination/i);
    });
  });

  it("rejects a route that does not start at the node ahead", () => {
    withReroutable((state, _vessel, effect) => {
      const nodeIds = (effect as { toNodeIds: string[] }).toNodeIds;
      const shifted = { ...effect, toNodeIds: nodeIds.slice(1) } as SimulationEffect;
      const result = validateEffect(state, shifted);
      expect(result.status).toBe("invalid");
      expect(result.message).toMatch(/next node ahead/i);
    });
  });

  it("rejects a disconnected route", () => {
    withReroutable((state, _vessel, effect) => {
      const nodeIds = (effect as { toNodeIds: string[] }).toNodeIds;
      const broken = {
        ...effect,
        toNodeIds: [nodeIds[0], "PORT-LONGBEACH", nodeIds[nodeIds.length - 1]],
      } as SimulationEffect;
      const result = validateEffect(state, broken);
      expect(result.status).toBe("invalid");
      expect(result.message).toMatch(/not connected|same destination/i);
    });
  });

  it("rejects an unknown node", () => {
    withReroutable((state, _vessel, effect) => {
      const nodeIds = (effect as { toNodeIds: string[] }).toNodeIds;
      const bogus = { ...effect, toNodeIds: [nodeIds[0], "WPT-DOES-NOT-EXIST"] } as SimulationEffect;
      expect(validateEffect(state, bogus).status).toBe("invalid");
    });
  });

  it("refuses to reroute a vessel that has entered the Tuas frame", () => {
    // Inside the terminal frame the vessel is FSM-owned; hold and divert are the
    // instruments there, not a route change.
    let state = generateWorld(SEED);
    for (let i = 0; i < 6000; i++) {
      const handed = state.vessels.find((v) => v.scope !== undefined && v.status !== "enroute");
      if (handed) {
        const result = validateEffect(state, {
          kind: "rerouteVoyage",
          vesselId: handed.id,
          toNodeIds: ["WPT-SG-APPROACH", "WPT-MALACCA-S"],
          reason: "weather",
        });
        expect(result.status).toBe("invalid");
        return;
      }
      state = tick(state);
    }
  });
});
