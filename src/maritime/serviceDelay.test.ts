import { describe, expect, it, afterEach } from "vitest";
import { useSimStore } from "../store/simStore";
import { serviceDelay, serviceDelays, serviceDelayTicks } from "./serviceDelay";
import { SERVICE_CADENCE_TICKS, setServiceCadence } from "../sim/roster";
import type { SimState } from "../sim";

// D-110: a disruption on a service's rotation slips that service's next Tuas
// call. This is the ONLY path by which a remote disruption reaches the baseline
// fleet, which books straight off the timetable and is not on the route graph.

const SEED = 20260710;

function world(spot?: string, ticks = 20): SimState {
  useSimStore.getState().pause();
  useSimStore.getState().reset(SEED);
  if (spot) useSimStore.getState().injectDisruption("storm", 3, 400, spot);
  for (let i = 0; i < ticks; i++) useSimStore.getState().tickOnce();
  return useSimStore.getState().sim;
}

afterEach(() => setServiceCadence("demo"));

describe("service delay (D-110)", () => {
  it("slips NOTHING when no disruption is active", () => {
    // The load-bearing test. Ambient weather already slows the legs around
    // Singapore — Riau measures 16.6% slow on a calm day — so a delay measured
    // against an unweathered ideal would book a permanent 7-tick slip every
    // rotation and stretch the cadence by 17.5% forever, emptying the port. The
    // slip is measured against the SAME corridor with disruptions removed.
    expect(serviceDelays(world())).toEqual([]);
  });

  it("slips the service whose rotation runs through the disruption, and only it", () => {
    const delays = serviceDelays(world("WPT-HORMUZ"));
    expect(delays.map((d) => d.serviceId)).toEqual(["SVC-GULF"]);
    const gulf = delays[0];
    expect(gulf.delayTicks).toBeGreaterThan(0);
    expect(gulf.fraction).toBeGreaterThan(0);
    // The named node is the one the disruption is hurting, not whichever leg
    // carries the highest ambient risk (always the one nearest Singapore).
    expect(gulf.worstNodeName).toBe("Jebel Ali");
    expect(gulf.blockedLegs).toBeGreaterThan(0);
  });

  it("leaves services that do not pass the disruption alone", () => {
    // A Suez storm is nothing to do with the Gulf or the Straits.
    const ids = serviceDelays(world("WPT-SUEZ")).map((d) => d.serviceId);
    expect(ids).toContain("SVC-AE7");
    expect(ids).not.toContain("SVC-GULF");
    expect(ids).not.toContain("SVC-STX");
    expect(serviceDelayTicks(world("WPT-SUEZ"), "SVC-GULF")).toBe(0);
  });

  it("expresses the slip as a proportion of the cadence, so it rescales with it", () => {
    // The reason the quantity is a fraction and not raw hours: a real Gulf
    // rotation is ~400 h against a 40-tick demo loop, so adding physical hours
    // would push vessels past the end of the demo. Switching to the production
    // cadence must scale the slip, not leave it as a handful of ticks.
    const sim = world("WPT-HORMUZ");
    const demo = serviceDelay(sim, "SVC-GULF")!;
    expect(SERVICE_CADENCE_TICKS).toBe(40);

    setServiceCadence("production");
    const prod = serviceDelay(sim, "SVC-GULF")!;
    // Same physical slowdown…
    expect(prod.fraction).toBeCloseTo(demo.fraction, 10);
    // …a proportionally larger slip on a longer cadence.
    expect(prod.delayTicks).toBeGreaterThan(demo.delayTicks * 10);
    expect(prod.delayTicks).toBeCloseTo(prod.fraction * SERVICE_CADENCE_TICKS, 0);
  });

  it("is a pure read — same state in, same answer out, no rng consumed", () => {
    const sim = world("WPT-MALACCA-N");
    const before = JSON.stringify(serviceDelays(sim));
    // Called repeatedly (the tick calls it once per recycling vessel) it must not
    // drift, or the simulation stops being reproducible from its seed.
    for (let i = 0; i < 5; i++) serviceDelayTicks(sim, "SVC-STX");
    expect(JSON.stringify(serviceDelays(sim))).toBe(before);
    expect(serviceDelays(sim).length).toBeGreaterThan(0);
  });

  it("returns null for an unknown service", () => {
    expect(serviceDelay(world(), "SVC-NOPE")).toBeNull();
    expect(serviceDelayTicks(world(), "SVC-NOPE")).toBe(0);
  });
});
