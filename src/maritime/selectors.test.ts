import { describe, expect, it } from "vitest";
import { anchorageQueue, generateWorld, tick } from "../sim";
import { edgeBetween } from "./graph";
import { MARITIME_DOCTRINE } from "./maritimeDoctrine";
import { TUAS_PORT_ID } from "./ports";
import {
  edgeConditions,
  exposedVessels,
  geographicVessels,
  tuasBoundAtSea,
  tuasQueueVessels,
} from "./selectors";
import type { Disruption, SimState } from "../sim";

// MDS-1 (D-91): a disruption has to be able to exist somewhere other than
// Singapore. Before this, weather cells were a two-element constant pinned to
// Tuas and the Strait, so a "storm at Suez" raised risk over Singapore and
// nowhere near Suez — which made the whole rerouting story unstageable, because
// Singapore is where every corridor converges and alternatives are scarcest.

const SEED = 20260710;

function storm(targetIds: string[], startTick: number, severity: 1 | 2 | 3 = 3): Disruption {
  return { id: `D-${targetIds.join("-") || "HOME"}`, type: "storm", targetIds, startTick, durationTicks: 200, severity };
}

/** Worst weather risk over the edges touching a node. */
function riskAround(state: SimState, nodeId: string, neighbourIds: string[]): number {
  const conditions = edgeConditions(state);
  let worst = 0;
  for (const other of neighbourIds) {
    const edge = edgeBetween(nodeId, other);
    const cond = edge && conditions.get(edge.id);
    if (cond) worst = Math.max(worst, cond.weatherRisk);
  }
  return worst;
}

describe("geographic disruptions (MDS-1, D-91)", () => {
  it("puts a storm's weather where the storm actually is, not over Singapore", () => {
    // Controlled comparison: two identical worlds ticked in lockstep, one with a
    // Suez storm. Comparing before/after within a single run would fold in the
    // ordinary tick-to-tick weather drift and prove nothing.
    let stormy = generateWorld(SEED);
    let control = generateWorld(SEED);
    for (let i = 0; i < 20; i++) {
      stormy = tick(stormy);
      control = tick(control);
    }

    stormy.disruptions.push(storm(["WPT-SUEZ"], stormy.clock.tick + 1));
    for (let i = 0; i < 5; i++) {
      stormy = tick(stormy);
      control = tick(control);
    }

    const suezEdges = ["WPT-REDSEA", "WPT-MED-E"];
    const malaccaEdges = ["WPT-MALACCA-N", "PORT-KLANG"];

    expect(riskAround(stormy, "WPT-SUEZ", suezEdges)).toBeGreaterThan(
      riskAround(control, "WPT-SUEZ", suezEdges),
    );
    // The whole point: the far side of the world does not light up.
    expect(riskAround(stormy, "WPT-MALACCA-S", malaccaEdges)).toBe(
      riskAround(control, "WPT-MALACCA-S", malaccaEdges),
    );
    // And the terminal itself is untouched — a Red Sea storm must not stop
    // cranes at Tuas (the bug this phase found in the weather overlay).
    expect(stormy.weather.riskIndex).toBe(control.weather.riskIndex);
    expect(stormy.wxOps.stsSuspended).toBe(control.wxOps.stsSuspended);
  });

  it("leaves an untargeted storm behaving exactly as it always has", () => {
    // Backward compatibility is load-bearing — every existing storm test, the
    // GR-10 scenario and the demo script all inject storms with no targets.
    let targeted = generateWorld(SEED);
    let untargeted = generateWorld(SEED);
    for (let i = 0; i < 20; i++) {
      targeted = tick(targeted);
      untargeted = tick(untargeted);
    }

    untargeted.disruptions.push(storm([], untargeted.clock.tick + 1));
    // An unresolvable target must fall back to home cells, not silently vanish.
    targeted.disruptions.push(storm(["NOT-A-REAL-NODE"], targeted.clock.tick + 1));

    targeted = tick(targeted);
    untargeted = tick(untargeted);

    expect([...edgeConditions(targeted).entries()]).toEqual([...edgeConditions(untargeted).entries()]);
  });

  it("raises risk around the targeted chokepoint itself", () => {
    let state = generateWorld(SEED);
    for (let i = 0; i < 20; i++) state = tick(state);
    state.disruptions.push(storm(["WPT-HORMUZ"], state.clock.tick + 1));
    state = tick(state);

    expect(riskAround(state, "WPT-HORMUZ", ["WPT-OMAN", "PORT-JEBELALI"])).toBeGreaterThan(0);
  });

  it("stops applying a storm's weather once it expires", () => {
    let state = generateWorld(SEED);
    for (let i = 0; i < 20; i++) state = tick(state);
    const before = riskAround(state, "WPT-SUEZ", ["WPT-REDSEA"]);

    state.disruptions.push({ ...storm(["WPT-SUEZ"], state.clock.tick + 1), durationTicks: 3 });
    state = tick(state);
    expect(riskAround(state, "WPT-SUEZ", ["WPT-REDSEA"])).toBeGreaterThan(before);

    for (let i = 0; i < 6; i++) state = tick(state);
    expect(riskAround(state, "WPT-SUEZ", ["WPT-REDSEA"])).toBe(before);
  });

  it("does not disturb determinism", () => {
    const run = () => {
      let s = generateWorld(SEED);
      for (let i = 0; i < 30; i++) s = tick(s);
      s.disruptions.push(storm(["WPT-SUEZ"], s.clock.tick + 1));
      for (let i = 0; i < 30; i++) s = tick(s);
      return s;
    };
    const a = run();
    const b = run();
    expect(a.rng.state).toBe(b.rng.state);
    expect(a.vessels).toEqual(b.vessels);
  });
});

describe("vessel exposure (MDS-1)", () => {
  it("counts only vessels whose REMAINING route crosses the hazard", () => {
    let state = generateWorld(SEED);
    for (let i = 0; i < 20; i++) state = tick(state);
    expect(exposedVessels(state)).toHaveLength(0);

    // A storm over the Malacca approach — the corridor most vessels share.
    state.disruptions.push(storm(["WPT-MALACCA-S", "WPT-MALACCA-N"], state.clock.tick + 1));
    state = tick(state);

    const exposed = exposedVessels(state);
    expect(exposed.length).toBeGreaterThan(0);

    // Every reported vessel must genuinely still have a bad leg ahead of it.
    const conditions = edgeConditions(state);
    const { routing } = MARITIME_DOCTRINE;
    for (const v of exposed) {
      const plan = state.maritime.routePlans.find((p) => p.id === v.track!.routePlanId)!;
      const ahead = plan.nodeIds.slice(v.track!.edgeIndex);
      const hasHazard = ahead.some((id, i, arr) => {
        const edge = arr[i + 1] && edgeBetween(id, arr[i + 1]);
        const cond = edge && conditions.get(edge.id);
        return Boolean(cond && (cond.blocked || cond.weatherRisk >= routing.highRiskWeatherThreshold));
      });
      expect(hasHazard, `${v.id} reported exposed with no hazard ahead`).toBe(true);
    }

    // Exposure is a subset of the vessels the map can actually draw.
    const drawable = new Set(geographicVessels(state).map((v) => v.id));
    for (const v of exposed) expect(drawable.has(v.id)).toBe(true);
  });

  it("identifies the Tuas-bound subset the duty manager owns", () => {
    let state = generateWorld(SEED);
    for (let i = 0; i < 20; i++) state = tick(state);

    const bound = tuasBoundAtSea(state);
    for (const v of bound) expect(v.destinationPortId).toBe(TUAS_PORT_ID);

    const boundIds = new Set(bound.map((v) => v.id));
    for (const v of geographicVessels(state)) {
      if (v.destinationPortId === TUAS_PORT_ID) expect(boundIds.has(v.id)).toBe(true);
    }
  });

  it("keeps the arrival queue distinct from the at-sea Tuas-bound vessels", () => {
    // Two different populations that are easy to conflate, and conflating them
    // is what made an early MDS-1 report claim "only 2 vessels are Tuas-bound"
    // while 18 were approaching or waiting at the anchorage.
    let state = generateWorld(SEED);
    for (let i = 0; i < 300; i++) state = tick(state);

    const { waiting, approaching } = tuasQueueVessels(state);
    const queue = [...waiting, ...approaching];
    expect(queue.length).toBeGreaterThan(0);
    for (const v of waiting) expect(v.status).toBe("anchored");
    for (const v of approaching) expect(v.status).toBe("approaching");

    // The waiting half must be the SAME list Operations shows, not a parallel
    // definition — one answer to "who is waiting".
    expect(waiting.map((v) => v.id)).toEqual(anchorageQueue(state).map((v) => v.id));

    // The queue lives in the D-62 frame, so it must never leak into the
    // geographic map's vessel set (GR-D6 single representation).
    const drawable = new Set(geographicVessels(state).map((v) => v.id));
    for (const v of queue) expect(drawable.has(v.id)).toBe(false);

    // And the at-sea set is enroute by construction — no overlap, ever.
    const atSeaIds = new Set(tuasBoundAtSea(state).map((v) => v.id));
    for (const v of queue) expect(atSeaIds.has(v.id)).toBe(false);
  });
});
