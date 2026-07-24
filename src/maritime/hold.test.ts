import { describe, expect, it } from "vitest";
import { applyEffect, generateWorld, tick, validateEffect } from "../sim";
import { activeRouteSummary, planningSpeedKnots, routeCandidates, waitOption } from "./routeEngine";
import { CLASS_SPEED_KNOTS } from "./config";
import { geographicVessels } from "./selectors";
import type { Disruption, SimState } from "../sim";

// MDS-2a (D-96). The engine used to compare path against path with no notion of
// time, so a storm with 24 h left to run could only be answered with a 2,507 nm
// circumnavigation of Sumatra. These pin the three parts of the fix: plans are
// made at service speed, a hold at sea actually stops the ship, and waiting is
// offered as a comparable option.

const SEED = 20260710;

function stormedWorld(): { state: SimState; vesselId: string } {
  let state = generateWorld(SEED);
  for (let i = 0; i < 20; i++) state = tick(state);
  const storm: Disruption = {
    id: "D-HOLD",
    type: "storm",
    targetIds: ["WPT-MALACCA-S", "WPT-MALACCA-N"],
    startTick: state.clock.tick + 1,
    durationTicks: 300,
    severity: 3,
  };
  state.disruptions.push(storm);
  for (let i = 0; i < 5; i++) state = tick(state);
  const v = geographicVessels(state).find((x) => waitOption(state, x.id) !== null);
  if (!v) throw new Error("fixture produced no vessel with a wait option");
  return { state, vesselId: v.id };
}

describe("planning speed (MDS-2a)", () => {
  it("plans at service speed even when weather has stopped the vessel", () => {
    const { state, vesselId } = stormedWorld();
    const vessel = state.vessels.find((v) => v.id === vesselId)!;

    // The precondition for the bug: the vessel is currently making no way.
    expect(vessel.track!.speedKnots).toBe(0);
    expect(planningSpeedKnots(vessel)).toBe(CLASS_SPEED_KNOTS[vessel.class]);

    const active = activeRouteSummary(state, vesselId)!;
    // At 1 knot (the old behaviour) this route took 96 h per 96 nm. At service
    // speed, even fully weather-derated, it cannot approach that.
    const hoursPerNm = active.travelMinutes / 60 / active.distanceNm;
    expect(hoursPerNm).toBeLessThan(1 / CLASS_SPEED_KNOTS[vessel.class] / 0.4);
  });
});

describe("hold at sea (MDS-2a)", () => {
  it("accepts a hold for an enroute vessel", () => {
    const { state, vesselId } = stormedWorld();
    const effect = { kind: "holdVessel", vesselId, untilTick: state.clock.tick + 50 } as const;
    expect(state.vessels.find((v) => v.id === vesselId)!.status).toBe("enroute");
    expect(validateEffect(state, effect).status).toBe("valid");
  });

  it("still rejects a hold in the past", () => {
    const { state, vesselId } = stormedWorld();
    const effect = { kind: "holdVessel", vesselId, untilTick: state.clock.tick } as const;
    expect(validateEffect(state, effect).status).toBe("invalid");
  });

  it("actually stops the ship — progress does not advance while held", () => {
    // The failure this guards: `heldUntilTick` was never read by the movement
    // engine, so a hold at sea would have been cosmetic while the vessel sailed
    // on (the animation-contradicts-simulation failure D-58 forbids).
    const { state, vesselId } = stormedWorld();
    let held = state;
    applyEffect(held, { kind: "holdVessel", vesselId, untilTick: held.clock.tick + 20 });

    const before = held.vessels.find((v) => v.id === vesselId)!.track!;
    const start = { lat: before.latitude, lon: before.longitude, progress: before.progressNm };

    for (let i = 0; i < 10; i++) held = tick(held);

    const during = held.vessels.find((v) => v.id === vesselId)!.track!;
    expect(during.progressNm).toBe(start.progress);
    expect(during.latitude).toBe(start.lat);
    expect(during.longitude).toBe(start.lon);
    expect(during.speedKnots).toBe(0);
  });

  it("slips the ETA while held, so the arrival estimate stays truthful", () => {
    const { state, vesselId } = stormedWorld();
    let held = state;
    applyEffect(held, { kind: "holdVessel", vesselId, untilTick: held.clock.tick + 20 });
    const etaBefore = held.maritime.routePlans.find(
      (p) => p.vesselId === vesselId && p.status === "active",
    )!.etaTick;

    for (let i = 0; i < 10; i++) held = tick(held);

    const etaAfter = held.maritime.routePlans.find(
      (p) => p.vesselId === vesselId && p.status === "active",
    )!.etaTick;
    expect(etaAfter).toBe(etaBefore + 10);
  });

  it("does not let the hold expiry bypass an active weather block", () => {
    // Mirrors D-58 condition 3: reaching heldUntilTick is the earliest possible
    // release, never unconditional permission to move.
    const { state, vesselId } = stormedWorld();
    let held = state;
    applyEffect(held, { kind: "holdVessel", vesselId, untilTick: held.clock.tick + 3 });
    for (let i = 0; i < 8; i++) held = tick(held); // hold expires, storm does not

    const track = held.vessels.find((v) => v.id === vesselId)!.track!;
    // The storm still blocks the leg, so the weather factor keeps it stopped.
    expect(track.speedKnots).toBe(0);
  });
});

describe("the wait option (MDS-2a)", () => {
  it("offers waiting only when waiting actually clears the route", () => {
    let calm = generateWorld(SEED);
    for (let i = 0; i < 20; i++) calm = tick(calm);
    // No disruption: nothing to wait out, so no option rather than a fake one.
    for (const v of geographicVessels(calm).slice(0, 15)) {
      expect(waitOption(calm, v.id)).toBeNull();
    }
  });

  it("prices waiting as hold + sail, and beats an absurd detour", () => {
    const { state, vesselId } = stormedWorld();
    const wait = waitOption(state, vesselId)!;
    expect(wait.totalMinutes).toBeCloseTo(
      wait.waitMinutes + wait.travelMinutes + wait.expectedWaitMinutes,
      6,
    );
    // The release tick is a real disruption expiry, not a guess.
    const expiries = state.disruptions.map((d) => d.startTick + d.durationTicks);
    expect(expiries).toContain(wait.releaseTick);

    // The route is genuinely clear by then.
    const future = { ...state, clock: { ...state.clock, tick: wait.releaseTick } };
    expect(activeRouteSummary(future, vesselId)!.highRiskEdgeIds).toHaveLength(0);

    // And where a long detour exists, waiting wins — the whole point of D-96.
    const detour = routeCandidates(state, vesselId)[0];
    if (detour && detour.distanceNm > activeRouteSummary(state, vesselId)!.distanceNm * 5) {
      expect(wait.totalMinutes).toBeLessThan(detour.travelMinutes + detour.expectedWaitMinutes);
    }
  });
});
