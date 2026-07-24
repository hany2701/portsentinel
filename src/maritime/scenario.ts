import { remainingDistanceNm } from "../sim";
import { TUAS_PORT_ID } from "./ports";
import { routeCandidates, type RouteCandidate } from "./routeEngine";
import { activePlanFor, trackedVessels } from "./selectors";
import type { RerouteDecision, SimState, SimulationEffect, Vessel } from "../sim";

// GR-10: fixed inputs for the integrated monsoon-crisis demonstration. The
// trigger deliberately does no simulation work itself: DemoPanel composes the
// existing reset, disruption, selection and transport actions with these
// values. In particular, a tick may record a RerouteDecision, but this module
// never inserts a Recommendation or applies an effect (D-85 / AIF-1).
//
// Narratively ONE regional monsoon system, modelled as TWO storm disruptions in
// the single seeded world (see weather.ts:isLocalStorm for why two are needed):
//   - `disruption` — node-targeted at south of Sri Lanka. Drives the maritime
//     edge model only: V-333's corridor hazard → reroute on the network map. By
//     design it does NOT touch Tuas cranes (it is outside the Singapore fence).
//   - `localStorm` — untargeted. Drives the Singapore/Tuas terminal overlay:
//     crane/berth suspension, weather gauge, connections-at-risk, safety-stock.
// Both live in the same `sim.disruptions[]`; the two effects are decoupled by
// the locality gate, so the demo can showcase the AI advising across the
// Maritime Network map AND Tuas Operations from one button.
export const GLOBAL_TUAS_SCENARIO = {
  // Demo seed chosen so a genuine reroute exists under the storm. Re-tuned when
  // the port approaches were rebuilt: the previous subject (V-355) relied on the
  // router being free to DROP its Port Klang and Penang calls, which read as a
  // shorter route and so satisfied the old "only advise something faster" gate.
  // Once a reroute had to keep its scheduled calls, that alternative correctly
  // vanished — and with it the demo's premise. Distinct from the world's default
  // seed; used only by this scenario and its DemoPanel button.
  seed: 20260753,
  // The fixed decision subject is in the affected global/regional corridor.
  // A separate inbound tracked service exercises the Tuas frame handoff; that
  // separation is the existing population ownership contract (GR-3).
  // V-333 runs the Bay of Bengal service; the storm below blocks its approach to
  // Colombo and the engine finds a hazard-free alternative round Sri Lanka. It is
  // the FIRST vessel the raiser flags on this seed, which matters: the advisor's
  // snapshot lists only the four oldest advisories, so a later subject would be
  // truthfully detected yet absent from the grounding the demo asks about.
  rerouteVesselId: "V-333",
  // Placed ON a chokepoint (MDS-1 geographic disruptions) rather than over
  // Singapore: south of Sri Lanka is where this network genuinely has a parallel
  // path, so the alternative is a real routing choice instead of an artefact.
  // A voyage-scale window: long enough for the inbound focus vessel to reach
  // the affected corridor. It still enters through injectDisruption and drives
  // the ordinary weather/edge-condition machinery.
  disruption: { type: "storm", severity: 3, durationTicks: 400, atNodeId: "WPT-SRILANKA-S" } as const,
  // The local half of the monsoon: an untargeted severe storm over the Singapore
  // approach. Untargeted → isLocalStorm true → applies the simulated Tuas overlay
  // that suspends STS/RTG/berthing, delays inbound vessels (connections-at-risk)
  // and drives the safety-stock shortfall the AI advises on. Independent of the
  // edge model, so it cannot disturb the seed-locked Sri Lanka reroute above.
  localStorm: { type: "storm", severity: 3, durationTicks: 400 } as const,
  // Was 8x. Slowed so the local storm's suspension alerts (STS → RTG → berthing)
  // arrive one at a time at ~1 tick/s — narratable, not a burst. The reroute is
  // pending from t2, so the demo runs the whole way at 2x with no fast-forward.
  playbackSpeed: 2 as const,
  detectionTimeoutTicks: 120,
  arrivalTimeoutTicks: 4500,
  previewHorizonTicks: 24,
};

export type ScenarioStepId =
  | "seeded"
  | "storm_injected"
  | "hazard_detected"
  | "candidates_ready"
  | "proposed"
  | "previewed"
  | "approved"
  | "rerouted"
  | "tuas_handover";

export type ScenarioCheckpoint = {
  id: ScenarioStepId;
  tick: number;
  detail: string;
};

/** Stable story subject for the fixed seed and generated population. */
export function pickFocusVessel(state: SimState): Vessel | undefined {
  return trackedVessels(state).find(
    (vessel) =>
      vessel.id === GLOBAL_TUAS_SCENARIO.rerouteVesselId &&
      vessel.status === "enroute" &&
      vessel.track !== undefined,
  );
}

/** Nearest currently-inbound tracked vessel; it owns the Tuas handoff arc. */
export function pickArrivalVessel(state: SimState): Vessel | undefined {
  return trackedVessels(state)
    .filter(
      (vessel) =>
        vessel.status === "enroute" &&
        vessel.track !== undefined &&
        vessel.destinationPortId === TUAS_PORT_ID,
    )
    .sort((a, b) => {
      const aPlan = activePlanFor(state, a.id);
      const bPlan = activePlanFor(state, b.id);
      const aRemaining = aPlan && a.track ? remainingDistanceNm(aPlan, a.track) : Infinity;
      const bRemaining = bPlan && b.track ? remainingDistanceNm(bPlan, b.track) : Infinity;
      return aRemaining - bRemaining || a.id.localeCompare(b.id);
    })[0];
}

export function pendingRerouteDecision(
  state: SimState,
  vesselId: string,
): RerouteDecision | undefined {
  return state.maritime.rerouteDecisions.find(
    (decision) => decision.vesselId === vesselId && decision.approvalStatus === "pending",
  );
}

export type ScenarioRerouteProposal = {
  candidate: RouteCandidate;
  effect: Extract<SimulationEffect, { kind: "rerouteVoyage" }>;
  title: string;
};

/**
 * Build, but do not queue, the deterministic proposal shown to the manager.
 * Queue insertion remains the existing proposeUserAction/agent tool step.
 */
export function bestScenarioReroute(
  state: SimState,
  vesselId: string,
): ScenarioRerouteProposal | null {
  const decision = pendingRerouteDecision(state, vesselId);
  const vessel = state.vessels.find((candidate) => candidate.id === vesselId);
  const candidate = routeCandidates(state, vesselId)[0];
  if (!decision || !vessel || !candidate) return null;

  return {
    candidate,
    effect: {
      kind: "rerouteVoyage",
      vesselId,
      toNodeIds: candidate.nodeIds,
      reason: decision.reason,
      decisionId: decision.id,
    },
    title: `Reroute ${vessel.name} (${candidate.policy.replace(/_/g, " ")})`,
  };
}
