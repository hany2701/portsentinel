import { describe, expect, it } from "vitest";
import {
  anchorageQueue,
  applyEffect,
  berthOptions,
  generateWorld,
  projectedBerthWaitHours,
  tick,
} from "../sim";
import { arrivalShiftHours, tuasImpact } from "./tuasImpact";
import { activePlanFor, exposedVessels, geographicVessels, originalPlanFor, tuasQueueVessels } from "./selectors";
import { useSimStore } from "../store/simStore";
import { buildSystemPrompt } from "../utils/contextBuilder";
import { serviceDelays } from "./serviceDelay";
import { routeCandidates } from "./routeEngine";
import { TUAS_PORT_ID } from "./ports";
import type { SimState } from "../sim";

// MDS-5 (D-94): the impact summary must be a READING of sim/derive.ts, never a
// second terminal model (brief §7). If these drift, the map is telling the duty
// manager something the terminal does not believe.

const SEED = 20260710;

function world(ticks: number): SimState {
  let state = generateWorld(SEED);
  for (let i = 0; i < ticks; i++) state = tick(state);
  return state;
}

describe("Tuas impact summary (MDS-5)", () => {
  it("returns nothing for a vessel with no Tuas relationship", () => {
    // A Rotterdam-bound ship in the Indian Ocean has no berth window here, and
    // inventing one would be exactly the fabrication §6.3 forbids.
    const state = world(20);
    const foreign = geographicVessels(state).find(
      (v) => v.destinationPortId !== TUAS_PORT_ID && v.status === "enroute",
    );
    expect(foreign).toBeDefined();
    expect(tuasImpact(state, foreign!)).toBeNull();
  });

  it("reports the arrival queue for every vessel already at Tuas", () => {
    const state = world(300);
    const { waiting } = tuasQueueVessels(state);
    expect(waiting.length).toBeGreaterThan(0);

    for (const v of waiting) {
      const impact = tuasImpact(state, v)!;
      expect(impact).not.toBeNull();
      // Every figure equals the shared derivation, not a local recomputation.
      expect(impact.anchorageWaitHours).toBe(projectedBerthWaitHours(state, v));
      expect(impact.berths).toEqual(berthOptions(state, v));
      // An anchored vessel waits behind those ahead of it, never behind itself.
      expect(impact.queueAhead).toBe(anchorageQueue(state).findIndex((x) => x.id === v.id));
      expect(impact.queueAhead).toBeLessThan(waiting.length);
    }
  });

  it("shows no arrival shift when nothing has superseded the plan", () => {
    // The trap: comparing a plan with itself would print "+0 h" on every vessel
    // and make an untouched voyage look like a decision was taken.
    const state = world(300);
    for (const v of tuasQueueVessels(state).waiting) {
      const impact = tuasImpact(state, v)!;
      const active = activePlanFor(state, v.id);
      const original = originalPlanFor(state, v.id);
      if (active && original && active.id === original.id) {
        expect(impact.arrivalShiftTicks).toBeNull();
        expect(arrivalShiftHours(impact)).toBeNull();
      }
    }
  });

  it("reports the arrival shift a hold causes", () => {
    // The chain the phase exists for: a hold slips the ETA (MDS-2a), and that
    // slip must surface as a Tuas consequence rather than staying in the engine.
    let state = world(20);
    state.disruptions.push({
      id: "D-IMPACT",
      type: "storm",
      targetIds: ["WPT-MALACCA-S", "WPT-MALACCA-N"],
      startTick: state.clock.tick + 1,
      durationTicks: 300,
      severity: 3,
    });
    for (let i = 0; i < 5; i++) state = tick(state);

    // Measured: this fixture yields 2 Tuas-bound vessels at sea (V-215, V-219).
    // Asserted rather than skipped, so the test cannot quietly stop testing.
    const bound = geographicVessels(state).find((v) => v.destinationPortId === TUAS_PORT_ID);
    expect(bound, "fixture produced no Tuas-bound vessel at sea").toBeDefined();

    const etaBefore = activePlanFor(state, bound!.id)!.etaTick;
    applyEffect(state, { kind: "holdVessel", vesselId: bound!.id, untilTick: state.clock.tick + 12 });
    for (let i = 0; i < 6; i++) state = tick(state);

    const etaAfter = activePlanFor(state, bound!.id)!.etaTick;
    expect(etaAfter).toBe(etaBefore + 6); // slipped one tick per held tick

    const impact = tuasImpact(state, bound!)!;
    expect(impact.revisedArrivalTick).toBe(etaAfter);
  });

  it("reports the arrival shift a reroute causes, against the ORIGINAL plan", () => {
    let state = world(20);
    state.disruptions.push({
      id: "D-IMPACT2",
      type: "storm",
      targetIds: ["WPT-MALACCA-N"],
      startTick: state.clock.tick + 1,
      durationTicks: 300,
      severity: 2,
    });
    for (let i = 0; i < 5; i++) state = tick(state);

    const target = geographicVessels(state).find((v) => {
      const cands = routeCandidates(state, v.id);
      const active = activePlanFor(state, v.id);
      return cands.length > 0 && active && cands[0].nodeIds.join(">") !== active.nodeIds.join(">");
    });
    if (!target) throw new Error("fixture produced no reroutable vessel");

    const originalEta = activePlanFor(state, target.id)!.etaTick;
    applyEffect(state, {
      kind: "rerouteVoyage",
      vesselId: target.id,
      toNodeIds: routeCandidates(state, target.id)[0].nodeIds,
      reason: "weather",
    });

    const after = state.vessels.find((v) => v.id === target.id)!;
    // Measured: the reroutable vessel this fixture finds (V-215) IS Tuas-bound,
    // so the impact must exist rather than being optionally skipped.
    const impact = tuasImpact(state, after);
    expect(impact, "fixture reroute target has no Tuas impact").not.toBeNull();
    expect(impact!.originalArrivalTick).toBe(originalEta);
    expect(impact!.arrivalShiftTicks).toBe(impact!.revisedArrivalTick! - originalEta);
  });

  it("flags a berth conflict only when no suitable berth exists", () => {
    const state = world(300);
    for (const v of tuasQueueVessels(state).waiting) {
      const impact = tuasImpact(state, v)!;
      expect(impact.berthConflict).toBe(berthOptions(state, v).length === 0);
    }
  });
});

describe("a remote disruption is explained in Tuas terms (D-108)", () => {
  const stormAt = (nodeId: string) => {
    useSimStore.getState().pause();
    useSimStore.getState().reset(20260710);
    useSimStore.getState().injectDisruption("storm", 3, 400, nodeId);
    for (let i = 0; i < 30; i++) useSimStore.getState().tickOnce();
    return useSimStore.getState().sim;
  };

  it("names WHERE the disruption is, not just its type", () => {
    // A Hormuz storm and one over Singapore both used to read as "storm sev 3",
    // so the assistant could not tell a remote chokepoint from local weather.
    const prompt = buildSystemPrompt(stormAt("WPT-HORMUZ"), "what is happening?");
    expect(prompt).toContain("Strait of Hormuz");
  });

  it("states the Tuas consequence of a Strait of Hormuz storm", () => {
    const prompt = buildSystemPrompt(stormAt("WPT-HORMUZ"), "how does this affect Tuas?");
    expect(prompt).toContain("Disruption → Tuas [calculated]");
    // The arrival picture is always given, so the assistant can answer "more or
    // less traffic?" from figures rather than from intuition.
    expect(prompt).toMatch(/waiting at the anchorage/);
    expect(prompt).toMatch(/approaching/);
  });

  it("reaches Tuas through the timetable even when no vessel at sea is exposed (D-110)", () => {
    // Superseded the D-108 wording deliberately. D-108 could only say "no Tuas
    // arrival is delayed" for a Hormuz storm, because the baseline fleet books
    // straight off the timetable and nothing connected the two. D-110 adds that
    // connection, so the honest answer changed: the Gulf service routes through
    // Hormuz and books its next call late.
    const sim = stormAt("WPT-HORMUZ");
    const exposedTuasBound = exposedVessels(sim).filter(
      (v) => v.destinationPortId === "PORT-TUAS",
    );
    expect(exposedTuasBound).toHaveLength(0); // still nothing at sea bound here
    expect(serviceDelays(sim).map((d) => d.serviceId)).toEqual(["SVC-GULF"]);

    const prompt = buildSystemPrompt(sim, "will Tuas get busier?");
    expect(prompt).toContain("book their next Tuas call LATE");
    expect(prompt).toContain("Gulf Passage");
    // …and it still refuses to overstate the reach: untouched services keep theirs.
    expect(prompt).toContain("keep their normal slots");
  });

  it("still refuses to imply a traffic swing when a disruption reaches nothing", () => {
    // The D-108 guard survives where it is still true. A Luzon Strait storm slows
    // no rotation enough to slip a call and exposes no Tuas-bound vessel, so the
    // correct answer remains "Tuas traffic is unchanged" — not a plausible-
    // sounding forecast the simulation never produced.
    const sim = stormAt("WPT-LUZON");
    expect(serviceDelays(sim)).toEqual([]);
    const prompt = buildSystemPrompt(sim, "will Tuas get busier?");
    expect(prompt).toContain("Tuas traffic is unchanged");
    expect(prompt).toContain("Do not infer a rise or fall in it");
  });

  it("says there is no active disruption when there is none", () => {
    useSimStore.getState().pause();
    useSimStore.getState().reset(20260710);
    const prompt = buildSystemPrompt(useSimStore.getState().sim, "anything wrong?");
    expect(prompt).toContain("Disruption → Tuas [calculated]: no active disruption.");
  });
});
