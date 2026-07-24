import { beforeEach, describe, expect, it } from "vitest";
import { previewEffect } from "../sim";
import { useSimStore } from "../store/simStore";
import { buildSystemPrompt } from "../utils/contextBuilder";
import { activePlanFor } from "./selectors";
import { activeRouteHighRisk } from "./routeEngine";
import {
  GLOBAL_TUAS_SCENARIO,
  bestScenarioReroute,
  pendingRerouteDecision,
  pickArrivalVessel,
  pickFocusVessel,
  type ScenarioCheckpoint,
} from "./scenario";

describe("GR-10 integrated global-to-Tuas scenario", () => {
  beforeEach(() => {
    useSimStore.getState().pause();
    useSimStore.getState().reset(GLOBAL_TUAS_SCENARIO.seed);
  });

  it("crosses every checkpoint without letting a tick create a queue proposal", () => {
    const checkpoints: ScenarioCheckpoint[] = [];
    const mark = (id: ScenarioCheckpoint["id"], detail: string) => {
      checkpoints.push({ id, tick: useSimStore.getState().sim.clock.tick, detail });
    };

    const actions = useSimStore.getState();
    const initial = actions.sim;
    const focus = pickFocusVessel(initial);
    const arrival = pickArrivalVessel(initial);
    expect(focus).toBeDefined();
    expect(arrival).toBeDefined();
    const vesselId = focus!.id;
    const arrivalVesselId = arrival!.id;
    const originalPlan = activePlanFor(initial, vesselId);
    expect(originalPlan).toBeDefined();
    const manifestBefore = structuredClone(arrival!.manifest);
    mark("seeded", `${vesselId}:v${originalPlan!.routeVersion}`);

    actions.injectDisruption(
      GLOBAL_TUAS_SCENARIO.disruption.type,
      GLOBAL_TUAS_SCENARIO.disruption.severity,
      GLOBAL_TUAS_SCENARIO.disruption.durationTicks,
      GLOBAL_TUAS_SCENARIO.disruption.atNodeId,
    );
    actions.select({ entityType: "vessel", entityId: vesselId });
    mark("storm_injected", `severity:${GLOBAL_TUAS_SCENARIO.disruption.severity}`);

    // Tick detection records deterministic evidence only. The shared decision
    // queue remains unchanged until the explicit proposal below (D-85/AIF-1).
    const queueBeforeDetection = structuredClone(useSimStore.getState().sim.recommendations);
    let decision = pendingRerouteDecision(useSimStore.getState().sim, vesselId);
    for (
      let i = 0;
      i < GLOBAL_TUAS_SCENARIO.detectionTimeoutTicks && !decision;
      i += 1
    ) {
      useSimStore.getState().tickOnce();
      expect(useSimStore.getState().sim.recommendations).toEqual(queueBeforeDetection);
      decision = pendingRerouteDecision(useSimStore.getState().sim, vesselId);
    }
    expect(decision).toBeDefined();
    mark("hazard_detected", `${decision!.id}:${decision!.reason}`);

    // Existing advisor grounding sees the evidence but does not propose merely
    // because context was built.
    const grounded = buildSystemPrompt(useSimStore.getState().sim, "Should this vessel reroute?");
    expect(grounded).toContain("Reroute advisories [calculated]");
    expect(grounded).toContain(vesselId);
    expect(useSimStore.getState().sim.recommendations).toEqual(queueBeforeDetection);

    const proposal = bestScenarioReroute(useSimStore.getState().sim, vesselId);
    expect(proposal).not.toBeNull();
    // D-89's actual contract: the alternative is hazard-free OR strictly less
    // exposed than the route it replaces. Asserting a FULLY clean alternative
    // encoded the pre-D-89 rule and only held because the previous subject
    // happened to have one — under a basin-wide storm no route near the affected
    // port clears every high-risk cell, and demanding one would reject the
    // least-exposed alternative in favour of no advice at all.
    const exposureNow = activeRouteHighRisk(useSimStore.getState().sim, vesselId);
    expect(
      proposal!.candidate.highRiskEdgeIds.length === 0 ||
        proposal!.candidate.highRiskEdgeIds.length < exposureNow,
      `alternative exposes ${proposal!.candidate.highRiskEdgeIds.length} high-risk segment(s) vs ${exposureNow} on the current route`,
    ).toBe(true);
    mark("candidates_ready", proposal!.candidate.id);

    // Explicit duty-manager proposal through the existing store API.
    useSimStore.getState().proposeUserAction(proposal!.effect, proposal!.title);
    let state = useSimStore.getState().sim;
    const recommendation = state.recommendations.find(
      (rec) =>
        rec.status === "pending" &&
        rec.source === "user" &&
        rec.proposedEffect.kind === "rerouteVoyage" &&
        rec.proposedEffect.vesselId === vesselId,
    );
    expect(recommendation?.validationStatus).toBe("valid");
    expect(recommendation?.proposedEffect).toEqual(proposal!.effect);
    mark("proposed", recommendation!.id);

    // Existing preview API: both branches are throwaway copies.
    const beforePreview = structuredClone(state);
    const preview = previewEffect(
      state,
      recommendation!.proposedEffect,
      GLOBAL_TUAS_SCENARIO.previewHorizonTicks,
    );
    expect(preview.valid).toBe(true);
    expect(state).toEqual(beforePreview);
    mark("previewed", `${preview.horizonTicks}`);

    // Existing approval API re-validates, then executes exactly once.
    useSimStore.getState().approveRecommendation(recommendation!.id);
    state = useSimStore.getState().sim;
    const approved = state.recommendations.find((rec) => rec.id === recommendation!.id);
    const reroutedPlan = activePlanFor(state, vesselId);
    expect(approved?.status).toBe("approved");
    expect(decision!.id).toBe(proposal!.effect.decisionId);
    expect(state.maritime.rerouteDecisions.find((item) => item.id === decision!.id)?.approvalStatus).toBe(
      "executed",
    );
    expect(reroutedPlan?.routeVersion).toBe(originalPlan!.routeVersion + 1);
    mark("approved", `${originalPlan!.routeVersion}->${reroutedPlan!.routeVersion}`);

    const positionBeforeMove = structuredClone(
      state.vessels.find((vessel) => vessel.id === vesselId)!.track,
    );
    useSimStore.getState().tickOnce();
    state = useSimStore.getState().sim;
    const afterMove = state.vessels.find((vessel) => vessel.id === vesselId)!;
    expect(afterMove.track?.lastUpdatedTick).toBe(state.clock.tick);
    expect(afterMove.track).not.toEqual(positionBeforeMove);
    mark("rerouted", `${afterMove.track!.latitude.toFixed(3)},${afterMove.track!.longitude.toFixed(3)}`);

    // The scenario now follows the ordinary inbound population into the Tuas
    // frame. Selection changes through the same shared selection action used by
    // the global/regional maps and the twin inspector.
    useSimStore.getState().select({ entityType: "vessel", entityId: arrivalVesselId });
    let handover = state.maritime.handovers.find(
      (item) => item.direction === "regional_to_tuas" && item.vesselId === arrivalVesselId,
    );
    for (
      let i = 0;
      i < GLOBAL_TUAS_SCENARIO.arrivalTimeoutTicks && !handover;
      i += 1
    ) {
      useSimStore.getState().tickOnce();
      state = useSimStore.getState().sim;
      handover = state.maritime.handovers.find(
        (item) => item.direction === "regional_to_tuas" && item.vesselId === arrivalVesselId,
      );
    }

    expect(handover).toBeDefined();
    const inTuas = state.vessels.find((vessel) => vessel.id === arrivalVesselId)!;
    expect(handover?.routeVersion).toBe(1);
    expect(handover?.direction === "regional_to_tuas" && handover.d62AnchorId).toBe(
      "D62-APPROACH-ENTRY",
    );
    expect(inTuas.status).toBe("approaching");
    expect(inTuas.manifest).toEqual(manifestBefore);
    expect(useSimStore.getState().selection).toEqual({
      entityType: "vessel",
      entityId: arrivalVesselId,
    });
    mark("tuas_handover", `${handover!.routeVersion}:${inTuas.status}`);

    expect(checkpoints.map((checkpoint) => checkpoint.id)).toEqual([
      "seeded",
      "storm_injected",
      "hazard_detected",
      "candidates_ready",
      "proposed",
      "previewed",
      "approved",
      "rerouted",
      "tuas_handover",
    ]);
    expect(
      checkpoints.every(
        (checkpoint, index) => index === 0 || checkpoint.tick >= checkpoints[index - 1].tick,
      ),
    ).toBe(true);
  });
});
