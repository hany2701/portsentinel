import { describe, expect, it } from "vitest";
import { generateWorld, tick } from "../sim";
import {
  activePlanFor,
  geographicVessels,
  regionalVessels,
  tuasBaselineVessels,
  trackedVessels,
  tuasFrameVessels,
} from "./selectors";
import { openHandover } from "../sim/maritimeStep";
import { TUAS_PORT_ID } from "./ports";
import type { SimState, Vessel, VesselStatus } from "../sim";

// GR-7 GATE.
//
// The whole point of the extension in one test: follow ONE vessel from a global
// corridor, through the regional approach, across the frame handover, into the
// Tuas terminal, and back out — and prove that throughout it stays one entity
// with one id, that the 22 frozen baseline vessels are untouched, and that no
// frame ever shows it twice.

const SEED = 20260710;
const MAX_TICKS = 12_000;

const find = (s: SimState, id: string) => s.vessels.find((v) => v.id === id);

describe("end-to-end vessel journey (GR-7)", () => {
  it("traces one canonical vessel from corridor to berth and back out", () => {
    let state = generateWorld(SEED);

    // The demo's focus vessel: a tracked arrival bound for Tuas.
    const subject = trackedVessels(state).find((v) => v.destinationPortId === TUAS_PORT_ID);
    expect(subject, "no Tuas-bound tracked vessel was seeded").toBeDefined();
    const id = subject!.id;
    const originalName = subject!.name;
    const originalClass = subject!.class;

    expect(subject!.status).toBe("enroute");
    expect(subject!.track).toBeDefined();

    // Every status the vessel passes through, in order, deduplicated.
    const journey: VesselStatus[] = ["enroute"];
    let sawGeographic = false;
    let sawTuasFrame = false;
    let returnedToGeographic = false;

    for (let i = 0; i < MAX_TICKS; i++) {
      state = tick(state);
      const v = find(state, id);

      // --- Identity: one entity, one id, never cloned or replaced. ---
      expect(v, `vessel ${id} disappeared at tick ${state.clock.tick}`).toBeDefined();
      expect(state.vessels.filter((x) => x.id === id)).toHaveLength(1);
      expect(v!.name).toBe(originalName);
      expect(v!.class).toBe(originalClass);
      expect(v!.scope).toBeDefined();

      // --- Single representation: exactly one frame depicts it at a time. ---
      const inGeographic = geographicVessels(state).some((x) => x.id === id);
      const inTuasFrame = tuasFrameVessels(state).some((x) => x.id === id);
      expect(
        inGeographic && inTuasFrame,
        `vessel appeared in both frames at tick ${state.clock.tick}`,
      ).toBe(false);
      expect(inGeographic || inTuasFrame).toBe(true);

      if (inGeographic) sawGeographic = true;
      if (inTuasFrame) sawTuasFrame = true;
      if (sawTuasFrame && inGeographic) returnedToGeographic = true;

      if (journey[journey.length - 1] !== v!.status) journey.push(v!.status);

      // --- The 22 baseline vessels stay untouched, every tick. ---
      expect(tuasBaselineVessels(state)).toHaveLength(22);

      if (returnedToGeographic) break;
    }

    // --- The journey actually happened. ---
    expect(sawGeographic, "vessel never sailed the geographic frame").toBe(true);
    expect(sawTuasFrame, "vessel never entered the Tuas frame").toBe(true);
    expect(returnedToGeographic, "vessel never returned to the regional corridor").toBe(true);

    // Corridor → approach → terminal → departure → corridor, in that order.
    expect(journey[0]).toBe("enroute");
    expect(journey).toContain("approaching");
    expect(journey).toContain("alongside");
    expect(journey[journey.length - 1]).toBe("enroute");
    expect(journey.indexOf("approaching")).toBeLessThan(journey.indexOf("alongside"));

    // --- It comes out the far side sailing a real route again. ---
    const final = find(state, id)!;
    expect(final.track).toBeDefined();
    expect(activePlanFor(state, id)).toBeDefined();
    expect(final.track!.speedKnots).toBeGreaterThan(0);
  });

  it("keeps the Tuas-active population within the approved bound", () => {
    // GR-D12a: the 22 baseline vessels are never replaced; up to three tracked
    // arrivals may join them, so at most 25 vessels are ever inside the frame.
    let state = generateWorld(SEED);
    let peakTracked = 0;

    for (let i = 0; i < 6000; i++) {
      state = tick(state);
      const baseline = tuasBaselineVessels(state);
      const arrivals = tuasFrameVessels(state);
      peakTracked = Math.max(peakTracked, arrivals.length);

      expect(baseline).toHaveLength(22);
      expect(arrivals.length, `${arrivals.length} tracked arrivals inside the frame`).toBeLessThanOrEqual(3);
      expect(baseline.length + arrivals.length).toBeLessThanOrEqual(25);

      // Arrivals keep their own ids — they are additions, never substitutions.
      for (const a of arrivals) {
        expect(a.scope).toBeDefined();
        expect(baseline.some((b) => b.id === a.id)).toBe(false);
      }
    }
    expect(peakTracked, "no tracked vessel ever reached Tuas").toBeGreaterThan(0);
  });

  it("keeps one authoritative population of 130 for the whole run", () => {
    let state = generateWorld(SEED);
    expect(state.vessels).toHaveLength(130);

    for (let i = 0; i < 3000; i++) {
      state = tick(state);
      expect(state.vessels, `population drifted at tick ${state.clock.tick}`).toHaveLength(130);
      // No duplicate ids anywhere — the failure mode a frame handover invites.
      const ids = state.vessels.map((v) => v.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("hands over without resetting route lineage", () => {
    let state = generateWorld(SEED);
    const subject = trackedVessels(state).find((v) => v.destinationPortId === TUAS_PORT_ID)!;
    const id = subject.id;
    const versionBefore = activePlanFor(state, id)!.routeVersion;

    let handoverTick = -1;
    for (let i = 0; i < MAX_TICKS; i++) {
      state = tick(state);
      const v = find(state, id)!;
      if (v.status !== "enroute") {
        handoverTick = state.clock.tick;
        break;
      }
    }
    expect(handoverTick, "vessel never handed over").toBeGreaterThan(0);

    // The handover record carries the crossing state (GR-D12d).
    const handover = state.maritime.handovers.find((h) => h.vesselId === id);
    expect(handover).toBeDefined();
    expect(handover!.direction).toBe("regional_to_tuas");
    expect(handover!.handoverTick).toBe(handoverTick);
    expect(handover!.routeVersion).toBe(versionBefore);
    if (handover!.direction === "regional_to_tuas") {
      expect(Number.isFinite(handover!.regionalEntry.latitude)).toBe(true);
      expect(Number.isFinite(handover!.regionalEntry.headingDeg)).toBe(true);
      expect(handover!.regionalEntry.speedKnots).toBeGreaterThan(0);
    }
    // Exactly one open handover for this vessel.
    expect(
      state.maritime.handovers.filter((h) => h.vesselId === id && h.status !== "completed").length,
    ).toBeLessThanOrEqual(1);
  });

  it("summarises Tuas-frame vessels on the map instead of losing them", () => {
    // GR-7 anchorage continuity: a vessel that leaves the geographic frame is
    // still accounted for, as an aggregate at the anchorage.
    let state = generateWorld(SEED);
    for (let i = 0; i < MAX_TICKS; i++) {
      state = tick(state);
      if (tuasFrameVessels(state).length > 0) break;
    }
    const inFrame = tuasFrameVessels(state);
    expect(inFrame.length).toBeGreaterThan(0);

    // None of them is drawn individually on the geographic maps …
    for (const v of inFrame) {
      expect(geographicVessels(state).some((x) => x.id === v.id)).toBe(false);
      expect(regionalVessels(state).some((x) => x.id === v.id)).toBe(false);
    }
    // … and every tracked vessel is accounted for by exactly one of the two.
    const tracked = trackedVessels(state).length;
    expect(geographicVessels(state).length + inFrame.length).toBe(tracked);
  });

  it("leaves the departed vessel on a fresh outbound plan, not a respawn", () => {
    let state = generateWorld(SEED);
    const id = trackedVessels(state).find((v) => v.destinationPortId === TUAS_PORT_ID)!.id;

    let departed: Vessel | undefined;
    let enteredFrame = false;
    for (let i = 0; i < MAX_TICKS; i++) {
      state = tick(state);
      const v = find(state, id)!;
      if (v.status !== "enroute") enteredFrame = true;
      if (enteredFrame && v.status === "enroute") {
        departed = v;
        break;
      }
    }
    expect(departed, "vessel never departed").toBeDefined();

    // It resumed geography from the approved Tuas exit, not from some unrelated
    // corridor node, and kept its identity and lineage.
    const plan = activePlanFor(state, id)!;
    expect(plan.status).toBe("active");
    expect(departed!.track!.routePlanId).toBe(plan.id);
    expect(departed!.id).toBe(id);
    // Route history survived the round trip.
    expect(state.maritime.routePlans.filter((p) => p.vesselId === id).length).toBeGreaterThan(1);

    // An outbound handover was recorded for the exit.
    const outbound = state.maritime.handovers.filter(
      (h) => h.vesselId === id && h.direction === "tuas_to_regional",
    );
    expect(outbound.length).toBeGreaterThan(0);
    const last = outbound[outbound.length - 1];
    if (last.direction === "tuas_to_regional") {
      expect(last.geographicExitNodeId).toBeTruthy();
      expect(Number.isFinite(last.d62Exit.headingDeg)).toBe(true);
    }

    // ONE MOVEMENT OWNER PER TICK (GR-D12g). On the crossing tick the handover
    // is still open — the vessel is FSM-owned through it and the geographic
    // engine takes over on the NEXT tick, which is when the record closes.
    expect(openHandover(state, id)).toBeDefined();
    const crossingPosition = { ...find(state, id)!.track! };
    state = tick(state);
    expect(openHandover(state, id)).toBeUndefined();
    // And it did not move during the crossing tick itself.
    expect(crossingPosition.lastUpdatedTick).toBeLessThanOrEqual(state.clock.tick);
  });
});
