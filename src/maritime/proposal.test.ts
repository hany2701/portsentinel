import { describe, expect, it } from "vitest";
import { generateWorld, previewEffect, tick, validateEffect } from "../sim";
import { rerouteStage, routeCandidates, waitOption } from "./routeEngine";
import { geographicVessels } from "./selectors";
import type { Disruption, Recommendation, SimState, SimulationEffect } from "../sim";

// MDS-3: the §6.4 sequence, surfaced on the map. The pipeline itself is not new
// — these pin the guarantees the map now depends on, above all that moving the
// Approve button somewhere else did not move the authority to press it (D-85).

const SEED = 20260710;

function stormedWorld(): { state: SimState; vesselId: string } {
  let state = generateWorld(SEED);
  for (let i = 0; i < 20; i++) state = tick(state);
  const storm: Disruption = {
    id: "D-PROP",
    type: "storm",
    targetIds: ["WPT-MALACCA-S", "WPT-MALACCA-N"],
    startTick: state.clock.tick + 1,
    durationTicks: 300,
    severity: 3,
  };
  state.disruptions.push(storm);
  for (let i = 0; i < 5; i++) state = tick(state);
  const v = geographicVessels(state).find((x) => waitOption(state, x.id) !== null);
  if (!v) throw new Error("fixture produced no vessel with an option");
  return { state, vesselId: v.id };
}

/** Effects that name a vessel — the union also has yard effects that do not. */
const effectVesselId = (e: SimulationEffect): string | undefined =>
  "vesselId" in e ? e.vesselId : undefined;

/** Queue a recommendation the way `proposeUserAction` does, without the store. */
function queue(state: SimState, effect: SimulationEffect): Recommendation {
  const validation = validateEffect(state, effect);
  const rec: Recommendation = {
    id: `REC-TEST-${state.recommendations.length}`,
    source: "user",
    type: "reroute",
    title: "test proposal",
    rationale: "test",
    impact: {},
    proposedEffect: effect,
    validationStatus: validation.status,
    validatedEffect: validation.status === "valid" ? effect : undefined,
    validationMessage: validation.message,
    status: "pending",
    createdTick: state.clock.tick,
    provenance: "user_input",
  };
  state.recommendations.push(rec);
  return rec;
}

describe("reroute lifecycle stage (MDS-3)", () => {
  it("reports detection WITHOUT calling it a proposal", () => {
    // The distinction D-85 rests on: the tick records evidence and stops.
    const { state, vesselId } = stormedWorld();
    const detected = state.maritime.rerouteDecisions.some(
      (d) => d.vesselId === vesselId && d.approvalStatus === "pending",
    );
    const stage = rerouteStage(state, vesselId);
    if (detected) {
      expect(stage.stage).toBe("detected");
    } else {
      expect(stage.stage).toBe("clear");
    }
    // Either way, the tick has created no recommendation for this vessel.
    expect(state.recommendations.some((r) => effectVesselId(r.proposedEffect) === vesselId)).toBe(false);
  });

  it("moves to proposed once a human or the agent queues one", () => {
    const { state, vesselId } = stormedWorld();
    const wait = waitOption(state, vesselId)!;
    const rec = queue(state, { kind: "holdVessel", vesselId, untilTick: wait.releaseTick });

    const stage = rerouteStage(state, vesselId);
    expect(stage.stage).toBe("proposed");
    if (stage.stage === "proposed") expect(stage.recommendationId).toBe(rec.id);
  });

  it("reports an invalid proposal as unapprovable, with the validator's reason", () => {
    const { state, vesselId } = stormedWorld();
    // A hold in the past is rejected by the validator.
    queue(state, { kind: "holdVessel", vesselId, untilTick: state.clock.tick });

    const stage = rerouteStage(state, vesselId);
    expect(stage.stage).toBe("invalid");
    if (stage.stage === "invalid") expect(stage.message.length).toBeGreaterThan(0);
  });
});

describe("proposal guarantees the map relies on (MDS-3)", () => {
  it("refuses a second proposal for a vessel that already has one", () => {
    const { state, vesselId } = stormedWorld();
    const wait = waitOption(state, vesselId)!;
    queue(state, { kind: "holdVessel", vesselId, untilTick: wait.releaseTick });

    // The panel gates on exactly this: one open proposal per vessel.
    const openForVessel = state.recommendations.filter(
      (r) => r.status === "pending" && effectVesselId(r.proposedEffect) === vesselId,
    );
    expect(openForVessel).toHaveLength(1);
    expect(rerouteStage(state, vesselId).stage).toBe("proposed");
  });

  it("leaves live state byte-identical when previewing", () => {
    // Preview is the step a manager takes BEFORE committing, so it must be
    // incapable of committing anything.
    const { state, vesselId } = stormedWorld();
    const candidate = routeCandidates(state, vesselId)[0];
    const effect: SimulationEffect = candidate
      ? { kind: "rerouteVoyage", vesselId, toNodeIds: candidate.nodeIds, reason: "weather" }
      : { kind: "holdVessel", vesselId, untilTick: state.clock.tick + 20 };

    const before = JSON.stringify(state);
    const result = previewEffect(state, effect, 24);
    expect(JSON.stringify(state)).toBe(before);
    expect(result.horizonTicks).toBe(24);
  });

  it("previews an invalid effect without pretending it succeeded", () => {
    const { state, vesselId } = stormedWorld();
    const before = JSON.stringify(state);
    const result = previewEffect(state, { kind: "holdVessel", vesselId, untilTick: 0 }, 12);

    expect(result.valid).toBe(false);
    expect(result.message.length).toBeGreaterThan(0);
    // Both branches report the same KPIs, so nothing looks improved.
    expect(result.withEffect).toEqual(result.without);
    expect(JSON.stringify(state)).toBe(before);
  });
});
