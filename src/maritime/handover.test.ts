import { describe, expect, it } from "vitest";
import { generateWorld, tick } from "../sim";
import {
  TRANSITION_VISIBLE_TICKS,
  handoverTransition,
  transitionOpacity,
} from "./handoverTransition";
import { TUAS_CENTER, mapMode, nearTuas, useMapViewStore } from "../store/mapViewStore";
import { geographicVessels } from "./selectors";
import type { SimState } from "../sim";

const SEED = 20260710;

function runUntilHandover(direction: "regional_to_tuas" | "tuas_to_regional"): SimState {
  let state = generateWorld(SEED);
  for (let i = 0; i < 6000; i++) {
    if (state.maritime.handovers.some((h) => h.direction === direction)) return state;
    state = tick(state);
  }
  throw new Error(`no ${direction} handover occurred`);
}

describe("handover visual transition (GR-5)", () => {
  it("announces the inbound crossing with the approved label", () => {
    const state = runUntilHandover("regional_to_tuas");
    const handover = state.maritime.handovers.find((h) => h.direction === "regional_to_tuas")!;
    const transition = handoverTransition(state, handover.vesselId)!;
    expect(transition.label).toBe("Entering Tuas operational zone");
    expect(transition.target).toBe("twin");
    expect(transition.vesselId).toBe(handover.vesselId);
    expect(transition.ageTicks).toBe(0);
  });

  it("announces the outbound crossing with the approved label", () => {
    const state = runUntilHandover("tuas_to_regional");
    const handover = state.maritime.handovers.find((h) => h.direction === "tuas_to_regional")!;
    const transition = handoverTransition(state, handover.vesselId)!;
    expect(transition.label).toBe("Returning to regional route");
    expect(transition.target).toBe("maritime");
  });

  it("fades out and then stops offering a transition", () => {
    expect(transitionOpacity(0)).toBe(1);
    expect(transitionOpacity(TRANSITION_VISIBLE_TICKS / 2)).toBeCloseTo(0.5, 5);
    expect(transitionOpacity(TRANSITION_VISIBLE_TICKS)).toBe(0);

    let state = runUntilHandover("regional_to_tuas");
    const vesselId = state.maritime.handovers.find((h) => h.direction === "regional_to_tuas")!.vesselId;
    for (let i = 0; i <= TRANSITION_VISIBLE_TICKS; i++) state = tick(state);
    expect(handoverTransition(state, vesselId)).toBeNull();
  });

  it("returns nothing for a vessel that is not crossing", () => {
    const state = generateWorld(SEED);
    expect(handoverTransition(state, null)).toBeNull();
    expect(handoverTransition(state, geographicVessels(state)[0].id)).toBeNull();
    expect(handoverTransition(state, "V-DOES-NOT-EXIST")).toBeNull();
  });

  it("never mutates simulation state", () => {
    // The transition is presentation: reading it must leave the world byte-identical.
    const state = runUntilHandover("regional_to_tuas");
    const before = structuredClone(state);
    for (const v of state.vessels) handoverTransition(state, v.id);
    expect(state).toEqual(before);
  });

  it("keeps a vessel in exactly one frame throughout the crossing", () => {
    let state = runUntilHandover("regional_to_tuas");
    const vesselId = state.maritime.handovers.find((h) => h.direction === "regional_to_tuas")!.vesselId;
    // Through the whole visible transition the vessel is out of the geographic
    // maps — the two coordinate positions are never shown at once.
    for (let i = 0; i <= TRANSITION_VISIBLE_TICKS; i++) {
      expect(geographicVessels(state).some((v) => v.id === vesselId)).toBe(false);
      state = tick(state);
    }
  });
});

describe("selection and viewport continuity (GR-5)", () => {
  it("survives a view round-trip, because the viewport lives in a store", () => {
    // Views unmount on sidebar navigation; the map viewport must not reset, or
    // a trip to the twin and back would lose the user's place.
    const { flyTo, setViewport } = useMapViewStore.getState();
    flyTo(TUAS_CENTER, 7.5);
    const afterFly = useMapViewStore.getState();
    expect(nearTuas(afterFly.center, afterFly.zoom)).toBe(true);
    expect(mapMode(afterFly.zoom)).toBe("regional");

    // Simulate the unmount/remount: nothing in the component tree owns this.
    const persisted = useMapViewStore.getState();
    expect(persisted.center).toEqual(afterFly.center);
    expect(persisted.zoom).toBe(afterFly.zoom);

    setViewport([60, 20], 1);
    expect(mapMode(useMapViewStore.getState().zoom)).toBe("global");
  });

  it("keeps the map viewport out of simulation state", () => {
    // Determinism depends on the viewport never reaching the engine.
    const state = generateWorld(SEED);
    expect(Object.keys(state)).not.toContain("center");
    expect(Object.keys(state)).not.toContain("zoom");
    expect(JSON.stringify(state.maritime)).not.toContain("zoom");
  });
});
