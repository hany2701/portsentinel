import { describe, it, expect } from "vitest";
import { generateWorld } from "./worldGen";
import { tick, clone } from "./tick";
import { stepWeather, refreshWeather } from "./weather";
import { assertInvariants } from "./invariants";
import { validateEffect } from "./validators";
import { applyEffect } from "./effects";
import { previewEffect } from "./preview";
import { anchorageQueue, berthOptions, maxAnchorageWait, safetyStockShortfallDays, vesselWaitHours, yardBlockOccupiedTEU, connectionsAtRisk, connectionsMissed, transshipmentWaiting, projectedBerthWaitHours } from "./derive";
import { ticksUntilTideWindow } from "./tide";
import { resilienceBreakdown, resilienceScore, computeKpis } from "./resilience";
import { firstGustBreach } from "../utils/weatherMapper";
import { addAlert, escalateStaleCriticals, CRITICAL_ESCALATE_AFTER_TICKS } from "./alerts";
import { RULE_COOLDOWN_TICKS } from "./config";
import { buildHandoverReport, buildCustomerNotice } from "../utils/reports";
import type { Recommendation } from "./types";
import { mapWeather } from "../utils/weatherMapper";
import { retrieveDoctrine, retrieveDoctrineScored } from "./retrieval";
import { searchDoctrine } from "./searchIndex";
import { parseAgentToolUse, SEARCH_DOCTRINE_TOOL, PROPOSE_ACTION_TOOL } from "../utils/responseParser";
import { classifyVessel, suitableBerths } from "../utils/vesselClassifier";
import { buildSystemPrompt, buildChatContext } from "../utils/contextBuilder";
import { WEATHER_BANDS, weatherRiskBand, lightningRiskAt, CALIBRATION, DOCTRINE_CORPUS, DOCTRINE } from "./doctrine";
import { SERVICE_ROSTER, SERVICE_CADENCE_TICKS, DEMO_SERVICE_CADENCE_TICKS, PRODUCTION_SERVICE_CADENCE_TICKS, SERVICE_JITTER, serviceById, nextServiceSlot } from "./roster";
import { syncCalibrationMode } from "./calibration";
import { makeRng } from "./rng";
import { WEATHER_BAND_COLOR } from "../twin/colors";
import type { OpenMeteoRaw } from "../services/weatherClient";
import type { SimState, VesselStatus, WeatherReading } from "./types";

function run(seed: number, ticks: number): SimState {
  let state = generateWorld(seed);
  for (let i = 0; i < ticks; i++) state = tick(state);
  return state;
}

function countStatus(state: SimState, status: VesselStatus): number {
  return state.vessels.filter((v) => v.status === status).length;
}

describe("world generation", () => {
  const world = generateWorld(20260710);

  it("builds 4 fingers and 12 berths", () => {
    expect(world.fingers).toHaveLength(4);
    expect(world.berths).toHaveLength(12);
    expect(world.berths.filter((b) => b.deepWater)).toHaveLength(6);
  });

  it("builds 8 yard blocks with reefer and hazmat designations", () => {
    expect(world.yardBlocks).toHaveLength(8);
    expect(world.yardBlocks.filter((b) => b.reeferPowered).map((b) => b.id)).toEqual(["YB-A", "YB-B"]);
    expect(world.yardBlocks.find((b) => b.hazmat)?.id).toBe("YB-H");
  });

  it("generates 22 Tuas vessels in the D-27 genesis distribution, plus the tracked population", () => {
    // GR-2: the world now holds one authoritative population — the 22 frozen
    // Tuas baseline vessels (no scope) plus 108 tracked maritime vessels. The
    // D-27 distribution governs the baseline only.
    expect(world.vessels.filter((v) => v.scope === undefined)).toHaveLength(22);
    expect(world.vessels).toHaveLength(130);
    expect(countStatus(world, "alongside")).toBe(9);
    expect(countStatus(world, "berthing")).toBe(1);
    expect(countStatus(world, "departing")).toBe(1);
    expect(countStatus(world, "anchored")).toBe(6);
    expect(countStatus(world, "approaching")).toBe(5);
  });

  it("assigns every genesis vessel a roster service of its own class (REAL-1/D-79)", () => {
    for (const v of world.vessels) {
      const svc = serviceById(v.serviceId);
      expect(svc, `vessel ${v.id} has no valid service`).toBeDefined();
      expect(svc!.class).toBe(v.class);
    }
  });

  it("has 7 customers with inventory fields and 2 alternate ports", () => {
    expect(world.customers).toHaveLength(7);
    expect(world.customers.every((c) => c.safetyStockDays > 0 && c.dailyConsumptionTEU > 0)).toBe(true);
    expect(world.alternatePorts.map((p) => p.name)).toEqual(["Tanjung Pelepas", "Port Klang"]);
  });

  it("satisfies invariants at genesis", () => {
    expect(() => assertInvariants(world)).not.toThrow();
  });
});

describe("determinism (D-32)", () => {
  it("produces identical state from the same seed after 200 ticks", () => {
    const a = run(12345, 200);
    const b = run(12345, 200);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("produces different state from different seeds", () => {
    const a = run(1, 200);
    const b = run(2, 200);
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b));
  });
});

describe("invariants hold over a long run", () => {
  it("never violates invariants over 10,000 ticks", () => {
    let state = generateWorld(777);
    for (let i = 0; i < 10000; i++) {
      state = tick(state);
      assertInvariants(state);
    }
  });

  it("keeps the Tuas vessel pool at 22 and never exceeds 12 alongside", () => {
    let state = generateWorld(4242);
    for (let i = 0; i < 2000; i++) {
      state = tick(state);
      // GR-2: the frozen baseline stays exactly 22. Tracked maritime vessels
      // are counted separately and may join the Tuas FSM (capped at 3), so the
      // total is asserted as a bound rather than an equality.
      expect(state.vessels.filter((v) => v.scope === undefined)).toHaveLength(22);
      expect(state.vessels).toHaveLength(130);
      expect(state.berths.filter((b) => b.status === "occupied").length).toBeLessThanOrEqual(12);
    }
  });
});

describe("weekly service schedules (REAL-1, D-79)", () => {
  it("nextServiceSlot returns a future tick on the service phase, within jitter", () => {
    const svc = serviceById("SVC-AE7")!; // phase 8
    const rng = makeRng(123);
    for (let after = 0; after < 300; after += 7) {
      const slot = nextServiceSlot(rng, svc, after);
      expect(slot).toBeGreaterThan(after);
      const off = (((slot - svc.phase) % SERVICE_CADENCE_TICKS) + SERVICE_CADENCE_TICKS) % SERVICE_CADENCE_TICKS;
      const dist = Math.min(off, SERVICE_CADENCE_TICKS - off);
      expect(dist).toBeLessThanOrEqual(SERVICE_JITTER);
    }
  });

  it("is deterministic for a given rng seed", () => {
    const svc = SERVICE_ROSTER[0];
    expect(nextServiceSlot(makeRng(9), svc, 55)).toBe(nextServiceSlot(makeRng(9), svc, 55));
  });

  it("recycled vessels keep their class + service across voyages", () => {
    let state = generateWorld(4242);
    const before = new Map(state.vessels.map((v) => [v.id, { class: v.class, serviceId: v.serviceId }]));
    for (let i = 0; i < 500; i++) state = tick(state);
    for (const v of state.vessels) {
      const b = before.get(v.id)!;
      expect(v.class).toBe(b.class); // the same ship runs the same weekly loop
      expect(v.serviceId).toBe(b.serviceId);
    }
  });

  it("arrivals bunch on service phases — clustering emerges, not uniform (weekly bunching)", () => {
    // POOLED across seeds (GR-9). The index of dispersion on a SINGLE 4000-tick
    // run is a high-variance estimator: across seeds it ranges ~0.8–2.1 even
    // though the weekly-schedule model (REAL-1/D-79) is unchanged, so any one
    // seed can dip below the clustering floor by chance. (This surfaced when the
    // GR-9 land-routing pass shifted maritime corridor distances, which moves the
    // tick at which tracked vessels berth at Tuas and thus the shared RNG stream
    // — the same class of reshuffle flagged at REAL-4/REAL-5.) Pooling the
    // arrivals of several seeds into one histogram averages out that noise and
    // measures the invariant itself; it does not lower the bar.
    const SEEDS = [777, 20260710, 20260753];
    const phaseHits = new Array(SERVICE_CADENCE_TICKS).fill(0);
    for (const seed of SEEDS) {
      let state = generateWorld(seed);
      let prev = new Map(state.vessels.map((v) => [v.id, v.status]));
      for (let i = 0; i < 4000; i++) {
        state = tick(state);
        // GR-3: only the roster-scheduled Tuas baseline is measured here. Tracked
        // maritime vessels arrive when their voyage reaches the approach fence —
        // sailing time, not a weekly phase — so counting them would smear the
        // very clustering this asserts.
        for (const v of state.vessels) {
          if (v.scope !== undefined) continue;
          if (v.status === "anchored" && prev.get(v.id) !== "anchored") {
            phaseHits[state.clock.tick % SERVICE_CADENCE_TICKS]++;
          }
        }
        prev = new Map(state.vessels.map((v) => [v.id, v.status]));
      }
    }
    const total = phaseHits.reduce((s, n) => s + n, 0);
    const mean = total / SERVICE_CADENCE_TICKS;

    // THE INVARIANT UNDER TEST is overall arrival OVERDISPERSION: arrivals
    // concentrate on the roster's three phase clusters instead of spreading
    // evenly across the cadence period. It is deliberately NOT a statement
    // about the maximum single-bucket concentration — any one bucket's height
    // is noisy, and a distribution can be strongly clustered without any
    // individual bucket standing out.
    //
    // WHY THE OLD PROXY WAS REPLACED (GR-3). This used to assert "≥3 empty
    // buckets", which is a peak/gap proxy and is sample-size sensitive: as the
    // arrival count rises, even a clustered distribution fills its gap buckets
    // (for mean m, the expected empty-bucket count decays like e^-m). The three
    // tracked maritime vessels that berth at Tuas draw RNG when they berth and
    // work cargo, shifting the shared stream — the same class of reshuffle that
    // forced recalibration at REAL-4 (D-82) and REAL-5 (D-83) — which lifted
    // baseline arrivals ~16% and dropped empty buckets to 1.
    //
    // CONTROL RUN (seed 777, 4000 ticks, tracked population set to 0 vs 108):
    //   0 tracked : total 128, empty 3, peak/mean 2.19
    //   108 tracked: total 148, empty 1, peak/mean 2.43
    // Clustering did not weaken — it strengthened. Only the proxy degraded.
    //
    // WHAT THE NEW ASSERTION MEASURES. The index of dispersion (variance/mean)
    // over the phase histogram. It is scale-free in the sample count, so it
    // stays comparable as throughput changes. Uniformly-timed arrivals are
    // Poisson, giving ≈1.0; the roster's three clusters push it well above.
    //
    // WHY 1.25. It sits above Poisson noise (uniformly-timed arrivals give ≈1.0)
    // while the POOLED value is 1.64 — a real margin in both directions. It is a
    // floor on a property that must hold, not a value fitted to one run: do not
    // lower it to make a failing run pass. A drop below it on the pooled sample
    // means arrivals have genuinely gone uniform and the weekly-schedule model
    // (REAL-1/D-79) has regressed.
    const variance = phaseHits.reduce((s, n) => s + (n - mean) ** 2, 0) / SERVICE_CADENCE_TICKS;
    const dispersion = variance / mean;
    expect(total).toBeGreaterThan(150);
    expect(dispersion, "arrivals look uniform, not clustered on service phases").toBeGreaterThan(1.25);
  });

  it("carries the schedule story into doctrine, calibration and the snapshot", () => {
    const svc = DOCTRINE_CORPUS.find((s) => s.sectionId === "OPS-SVC §1")!;
    expect(svc).toBeDefined();
    expect(svc.keywords).toContain("weekly");
    expect(searchDoctrine("weekly service schedule").some((h) => h.section.docId === "OPS-SVC")).toBe(true);
    expect(CALIBRATION.some((c) => c.label === "Service cadence" && c.demo !== c.real)).toBe(true);
    expect(buildSystemPrompt(generateWorld(20260710), "when do vessels arrive?")).toContain("Scheduled arrivals");
  });
});

describe("transshipment flows (REAL-2, D-80)", () => {
  it("every onward service has at least one vessel to lift its boxes (coverage)", () => {
    for (const seed of [777, 4242, 20260710, 1, 99, 5]) {
      const covered = new Set(generateWorld(seed).vessels.map((v) => v.serviceId));
      for (const s of SERVICE_ROSTER) expect(covered.has(s.id), `seed ${seed} left ${s.id} uncovered`).toBe(true);
    }
  });

  it("most cargo is transshipment, tagged with an onward service (~85%)", () => {
    const w = generateWorld(20260710);
    const items = w.vessels.flatMap((v) => v.manifest);
    const transItems = items.filter((m) => m.connectingServiceId !== undefined);
    expect(transItems.length / items.length).toBeGreaterThan(0.65);
    // every transshipment box points at a real, different service than its carrier
    for (const v of w.vessels) {
      for (const m of v.manifest) {
        if (m.connectingServiceId) {
          expect(serviceById(m.connectingServiceId)).toBeDefined();
          expect(m.connectingServiceId).not.toBe(v.serviceId);
        }
      }
    }
  });

  it("the truck gate drains only import cargo — transshipment never leaves via the gate", () => {
    const state = generateWorld(20260710);
    state.vessels = []; // isolate: no loading, so only the gate can remove lots
    const transLot = state.cargoLots.find((l) => l.status === "yard" && l.connectingServiceId)!;
    transLot.connectDeadlineTick = 99999; // don't let it miss during the test
    const block = state.yardBlocks.find((b) => !b.reeferPowered && !b.hazmat)!;
    // Oldest lot in the yard, so the gate reaches it first (arrivalTick order).
    state.cargoLots.push({ ...transLot, id: "IMP", connectingServiceId: undefined, connectDeadlineTick: undefined, connectMissedCount: undefined, blockId: block.id, quantityTEU: 60, arrivalTick: -100000, status: "yard" });
    let s = state;
    for (let i = 0; i < 5; i++) s = tick(s);
    expect(s.cargoLots.find((l) => l.id === "IMP")).toBeUndefined(); // import drained by the gate
    expect(s.cargoLots.find((l) => l.id === transLot.id)?.status).toBe("yard"); // transshipment still waiting
  });

  it("transshipment boxes are discharged, wait, then loaded onto their onward service (connections made)", () => {
    let state = generateWorld(20260710);
    let connectionsMade = 0;
    let prevOutbound = new Map(state.cargoLots.filter((l) => l.status === "outbound").map((l) => [l.id, l]));
    for (let i = 0; i < 400; i++) {
      state = tick(state);
      const nowIds = new Set(state.cargoLots.map((l) => l.id));
      for (const id of prevOutbound.keys()) if (!nowIds.has(id)) connectionsMade++; // a claimed lot that vanished = lifted onto its onward vessel
      prevOutbound = new Map(state.cargoLots.filter((l) => l.status === "outbound").map((l) => [l.id, l]));
    }
    expect(connectionsMade).toBeGreaterThan(0);
  });

  it("a missed connection re-books to the next weekly call and raises a critical alert", () => {
    const state = generateWorld(20260710);
    state.vessels = []; // isolate the connection lifecycle from loading
    const lot = state.cargoLots.find((l) => l.status === "yard" && l.connectingServiceId)!;
    lot.connectDeadlineTick = state.clock.tick; // sitting exactly at its deadline
    const before = lot.connectDeadlineTick;
    const missedBefore = lot.connectMissedCount ?? 0;
    const next = tick(state);
    const nlot = next.cargoLots.find((l) => l.id === lot.id)!;
    expect(nlot.connectMissedCount).toBe(missedBefore + 1);
    expect(nlot.connectDeadlineTick).toBe(before + SERVICE_CADENCE_TICKS); // re-booked to next weekly call
    expect(next.alerts.some((a) => a.severity === "critical" && a.message.includes("Missed transshipment"))).toBe(true);
  });

  it("a storm suspends berthing so onward vessels can't lift — connections go at risk", () => {
    let state = generateWorld(20260710);
    for (let i = 0; i < 200; i++) state = tick(state); // reach steady state
    expect(connectionsAtRisk(state).length).toBe(0); // calm: connections are being made
    state.disruptions.push({ id: "D-STORM", type: "storm", targetIds: [], startTick: state.clock.tick + 1, durationTicks: 150, severity: 3 });
    let sawAtRisk = false;
    for (let i = 0; i < 150; i++) {
      state = tick(state);
      if (connectionsAtRisk(state).length > 0) sawAtRisk = true;
    }
    expect(sawAtRisk).toBe(true);
    expect(connectionsMissed(state).length).toBeGreaterThan(0); // the storm made some connections miss
  });

  it("carries the connections picture into KPIs, doctrine, calibration and the snapshot", () => {
    let state = generateWorld(20260710);
    for (let i = 0; i < 20; i++) state = tick(state);
    expect(computeKpis(state)).toHaveProperty("connectionsAtRisk");
    const trans = DOCTRINE_CORPUS.find((s) => s.sectionId === "OPS-TRANS §1")!;
    expect(trans).toBeDefined();
    expect(trans.keywords).toContain("transshipment");
    expect(searchDoctrine("transshipment onward connection").some((h) => h.section.docId === "OPS-TRANS")).toBe(true);
    expect(CALIBRATION.some((c) => c.label.includes("connection window") && c.demo !== c.real)).toBe(true);
    expect(transshipmentWaiting(state).length).toBeGreaterThan(0);
    expect(buildSystemPrompt(state, "how are transshipment connections?")).toContain("Transshipment connections");
  });
});

describe("real terminal KPIs (REAL-3, D-81)", () => {
  it("computes the four terminal metrics from the rolling logs", () => {
    let state = generateWorld(20260710);
    for (let i = 0; i < 300; i++) state = tick(state);
    expect(state.terminal.completions.length).toBeGreaterThan(0);
    const k = computeKpis(state);
    expect(k.berthOnArrivalPct).toBeGreaterThanOrEqual(0);
    expect(k.berthOnArrivalPct).toBeLessThanOrEqual(100);
    expect(k.turnaroundHours).toBeGreaterThan(0); // vessels completed calls
    expect(k.craneMovesPerHour).toBeGreaterThan(0); // cranes moved boxes
    expect(k.rehandleRatio).toBeGreaterThanOrEqual(0);
    // every completion has a non-negative arrival→departure span
    expect(state.terminal.completions.every((c) => c.turnaroundTicks >= 0)).toBe(true);
    expect(state.terminal.completions.some((c) => c.berthOnArrival)).toBe(true); // some berthed with no wait
  });

  it("gross crane rate + rehandle ratio go to zero while cranes are weather-suspended, then recover", () => {
    let state = generateWorld(20260710);
    for (let i = 0; i < 200; i++) state = tick(state);
    expect(computeKpis(state).craneMovesPerHour).toBeGreaterThan(0);
    state.disruptions.push({ id: "D-STORM", type: "storm", targetIds: [], startTick: state.clock.tick + 1, durationTicks: 150, severity: 3 });
    for (let i = 0; i < 100; i++) state = tick(state); // whole move window now inside the suspension
    expect(state.wxOps.stsSuspended).toBe(true);
    expect(computeKpis(state).craneMovesPerHour).toBe(0);
    expect(computeKpis(state).rehandleRatio).toBe(0);
    for (let i = 0; i < 130; i++) state = tick(state); // storm clears, cranes resume
    expect(computeKpis(state).craneMovesPerHour).toBeGreaterThan(0);
  });

  it("berth-on-arrival falls and turnaround rises across a storm (the anchorage backs up)", () => {
    let state = generateWorld(20260710);
    for (let i = 0; i < 200; i++) state = tick(state);
    const calm = computeKpis(state);
    state.disruptions.push({ id: "D-STORM", type: "storm", targetIds: [], startTick: state.clock.tick + 1, durationTicks: 150, severity: 3 });
    // Track the worst point across the storm + recovery (metrics rebound once the
    // backlog clears, so a single late sample is timing-fragile).
    let minBoA = calm.berthOnArrivalPct, maxTurnaround = calm.turnaroundHours;
    for (let i = 0; i < 250; i++) {
      state = tick(state);
      const k = computeKpis(state);
      minBoA = Math.min(minBoA, k.berthOnArrivalPct);
      maxTurnaround = Math.max(maxTurnaround, k.turnaroundHours);
    }
    expect(minBoA).toBeLessThan(calm.berthOnArrivalPct); // storm-delayed arrivals anchored first
    expect(maxTurnaround).toBeGreaterThan(calm.turnaroundHours); // those calls took far longer
  });

  it("carries the terminal metrics into doctrine, calibration and the snapshot", () => {
    const kpi = DOCTRINE_CORPUS.find((s) => s.sectionId === "OPS-KPI §1")!;
    expect(kpi).toBeDefined();
    expect(kpi.keywords).toContain("rehandle");
    expect(searchDoctrine("crane moves per hour rehandle turnaround").some((h) => h.section.docId === "OPS-KPI")).toBe(true);
    expect(CALIBRATION.some((c) => c.label === "Gross crane rate" && c.demo !== c.real)).toBe(true);
    let state = generateWorld(20260710);
    for (let i = 0; i < 50; i++) state = tick(state);
    expect(buildSystemPrompt(state, "how is crane productivity?")).toContain("Terminal performance");
  });
});

describe("effect validation and execution", () => {
  it("re-berths an anchored vessel to an available berth and preserves invariants", () => {
    const state = generateWorld(20260710);
    const berth = state.berths.find((b) => b.status === "available");
    const vessel = state.vessels.find((v) => v.status === "anchored" && (v.class !== "neopanamax" || berth?.deepWater));
    expect(berth).toBeDefined();
    expect(vessel).toBeDefined();
    const effect = { kind: "reassignBerth", vesselId: vessel!.id, toBerthId: berth!.id } as const;
    expect(validateEffect(state, effect).status).toBe("valid");
    applyEffect(state, effect);
    expect(() => assertInvariants(state)).not.toThrow();
    expect(state.berths.find((b) => b.id === berth!.id)?.vesselId).toBe(vessel!.id);
    expect(state.vessels.find((v) => v.id === vessel!.id)?.berthId).toBe(berth!.id);
  });

  it("rejects diverting a vessel to an unknown port", () => {
    const state = generateWorld(1);
    const vessel = state.vessels.find((v) => v.status === "approaching")!;
    const result = validateEffect(state, { kind: "divertVessel", vesselId: vessel.id, toPortId: "PORT-NOWHERE" });
    expect(result.status).toBe("invalid");
  });

  it("rejects re-allocating yard cargo into an over-capacity block", () => {
    const state = generateWorld(99);
    const lot = state.cargoLots.find((l) => l.status === "yard" && l.type === "standard")!;
    const full = state.yardBlocks.find((b) => b.id === "YB-C")!;
    // Fill YB-C to capacity so it genuinely cannot accept the lot.
    const free = full.capacityTEU - yardBlockOccupiedTEU(state, full.id);
    state.cargoLots.push({ ...lot, id: "LOT-FILLER", blockId: full.id, quantityTEU: free, status: "yard" });
    const result = validateEffect(state, { kind: "reallocateYard", lotIds: [lot.id], toBlockId: full.id });
    expect(result.status).toBe("invalid");
  });
});

describe("weather feed (IP-3)", () => {
  function raw(): OpenMeteoRaw {
    return {
      forecast: [
        { current: { time: 1000, wind_speed_10m: 10, wind_gusts_10m: 20, wind_direction_10m: 225, precipitation: 0, visibility: 12000 }, hourly: { time: [1000, 4600, 8200], wind_gusts_10m: [20, 25, 30] } },
        { current: { time: 900, wind_speed_10m: 20, wind_gusts_10m: 30, wind_direction_10m: 90, precipitation: 2, visibility: 8000 }, hourly: { time: [900], wind_gusts_10m: [22] } },
      ],
      marine: [{ current: { time: 1000, wave_height: 1.0 } }, { current: { time: 900, wave_height: 2.0 } }],
    };
  }

  it("fuses two points with correct units and future-only forecast", () => {
    const { reading, forecast } = mapWeather(raw());
    expect(reading.windKts).toBe(15); // mean(10, 20)
    expect(reading.gustKts).toBe(25); // mean(20, 30)
    expect(reading.windDirDeg).toBe(225); // primary (Tuas) point, no wraparound averaging
    expect(reading.waveHeightM).toBe(1.5); // mean(1, 2) from marine
    expect(reading.visibilityKm).toBe(10); // mean(12000, 8000) m → km
    expect(reading.asOfMs).toBe(1_000_000); // max(time) * 1000
    expect(forecast).toHaveLength(3); // all Tuas hours >= asOfMs
  });

  const reading: WeatherReading = { asOfMs: 1_000_000, windKts: 15, gustKts: 25, windDirDeg: 225, waveHeightM: 1.5, visibilityKm: 10, precipMm: 1 };

  it("stepWeather uses a live reading with live_external provenance when no storm", () => {
    const state = generateWorld(20260710);
    state.weatherFeed = { reading, freshness: "live" };
    stepWeather(state);
    expect(state.weather.provenance).toBe("live_external");
    expect(state.weather.freshness).toBe("live");
    expect(state.weather.gustKts).toBe(25);
    expect(state.weather.asOfMs).toBe(1_000_000);
    expect(state.weather.stormOverlay).toBe(false);
  });

  it("stepWeather labels a live reading stale when the feed is stale", () => {
    const state = generateWorld(20260710);
    state.weatherFeed = { reading, freshness: "stale" };
    stepWeather(state);
    expect(state.weather.freshness).toBe("stale");
    expect(state.weather.provenance).toBe("live_external");
  });

  it("storm overlay overrides a live reading and stays simulated", () => {
    const state = generateWorld(20260710);
    state.weatherFeed = { reading, freshness: "live" };
    state.disruptions.push({ id: "D", type: "storm", targetIds: [], startTick: 0, durationTicks: 60, severity: 3 });
    stepWeather(state);
    expect(state.weather.stormOverlay).toBe(true);
    expect(state.weather.provenance).toBe("simulated");
  });

  it("falls back to simulated when no reading has ever arrived", () => {
    const state = generateWorld(20260710);
    stepWeather(state);
    expect(state.weather.provenance).toBe("simulated");
    expect(state.weather.freshness).toBe("simulated");
  });

  it("refreshWeather applies a reading without advancing the RNG", () => {
    const state = generateWorld(20260710);
    const rngBefore = JSON.stringify(state.rng);
    state.weatherFeed = { reading, freshness: "live" };
    refreshWeather(state);
    expect(JSON.stringify(state.rng)).toBe(rngBefore); // no RNG consumed
    expect(state.weather.provenance).toBe("live_external");
    expect(state.weather.gustKts).toBe(25);
  });
});

describe("TF-IDF doctrine search (D-66)", () => {
  it("is deterministic — same query, identical ranked results", () => {
    const a = searchDoctrine("divert vessels in a storm");
    const b = searchDoctrine("divert vessels in a storm");
    expect(a.map((h) => [h.section.sectionId, h.score])).toEqual(b.map((h) => [h.section.sectionId, h.score]));
  });

  it("retrieves on body terms the curated keywords never listed", () => {
    // "visibility" and "dwell" appear only in section bodies — the old binary
    // keyword scoring returned nothing for these.
    expect(searchDoctrine("what happens when visibility drops?")[0].section.sectionId).toBe("OPS-WX §1");
    expect(searchDoctrine("dwell rules?")[0].section.sectionId).toBe("OPS-CARGO §2");
  });

  it("weights a keyword-field hit above a body-only hit", () => {
    // "reefer" is a curated keyword on OPS-CARGO §2 but only body text in OPS-YARD §1.
    const hits = searchDoctrine("reefer");
    const cargo = hits.findIndex((h) => h.section.sectionId === "OPS-CARGO §2");
    const yard = hits.findIndex((h) => h.section.sectionId === "OPS-YARD §1");
    expect(cargo).toBeGreaterThanOrEqual(0);
    expect(yard).toBeGreaterThanOrEqual(0);
    expect(cargo).toBeLessThan(yard);
  });

  it("handles plural/singular via the shared normalisation", () => {
    // Corpus says "gusts"; a singular query still ranks the crane wind-limit doc first.
    expect(searchDoctrine("gust")[0].section.docId).toBe("OPS-CRANE");
  });

  it("returns nothing for noise queries (min-score floor)", () => {
    expect(searchDoctrine("hello there friend")).toEqual([]);
  });

  it("keeps forced docs and exposes score/forced metadata (D-68 contract)", () => {
    const state = generateWorld(20260710);
    state.disruptions.push({ id: "D", type: "storm", targetIds: [], startTick: 0, durationTicks: 60, severity: 3 });
    const scored = retrieveDoctrineScored(state, "should I divert vessels because of the weather?");
    const wx = scored.filter((r) => r.section.docId === "OPS-WX");
    expect(wx.length).toBeGreaterThan(0);
    expect(wx.every((r) => r.forced)).toBe(true); // forced by the active storm
    const berth = scored.find((r) => r.section.sectionId === "OPS-BERTH §3");
    expect(berth).toBeDefined();
    expect(berth!.forced).toBe(false);
    expect(berth!.score).toBeGreaterThan(0);
  });
});

describe("lightning + calibration (D-78)", () => {
  const CALM_GUSTS: WeatherReading = { asOfMs: 1, windKts: 8, gustKts: 10, windDirDeg: 90, waveHeightM: 0.3, visibilityKm: 12, precipMm: 0 };

  it("lightning risk suspends STS and RTG at calm gusts, then recovers", () => {
    let state = generateWorld(20260710);
    // Heavy convective rain, calm wind, good visibility → non-critical band, no gust trigger.
    state.weatherFeed = { reading: { ...CALM_GUSTS, precipMm: DOCTRINE.weather.lightningPrecipMm + 2 }, freshness: "live" };
    state = tick(state);
    expect(weatherRiskBand(state.weather.riskIndex).id).not.toBe("critical");
    expect(state.wxOps.stsSuspended).toBe(true);
    expect(state.wxOps.rtgSuspended).toBe(true);
    expect(state.alerts.some((a) => a.message.includes("Lightning risk"))).toBe(true);

    // Rain stops → staged recovery after the clear-tick target.
    state.weatherFeed = { reading: CALM_GUSTS, freshness: "live" };
    for (let i = 0; i < DOCTRINE.weather.recoveryClearTicks; i++) state = tick(state);
    expect(state.wxOps.stsSuspended).toBe(false);
    expect(state.wxOps.rtgSuspended).toBe(false);
  });

  it("a severity-3 storm overlay converges into lightning territory", () => {
    let state = generateWorld(20260710);
    state.disruptions.push({ id: "D", type: "storm", targetIds: [], startTick: 0, durationTicks: 60, severity: 3 });
    for (let i = 0; i < 10; i++) state = tick(state);
    expect(lightningRiskAt(state.weather.precipMm)).toBe(true); // sev-3 precip target 18 ≥ 14
  });

  it("prompt, corpus and calibration record carry the lightning rule", () => {
    const state = generateWorld(20260710);
    state.weather.precipMm = DOCTRINE.weather.lightningPrecipMm + 1;
    expect(buildSystemPrompt(state, "status?")).toContain("LIGHTNING RISK");
    const crane1 = DOCTRINE_CORPUS.find((s) => s.sectionId === "OPS-CRANE §1")!;
    expect(crane1.body).toContain("lightning risk");
    expect(crane1.keywords).toContain("lightning");
    expect(CALIBRATION.length).toBeGreaterThanOrEqual(4);
    for (const c of CALIBRATION) expect(c.demo).not.toBe(c.real);
  });
});

describe("pilotage & towage (REAL-4, D-82)", () => {
  it("a manoeuvring vessel waits when the pilot/tug pool is exhausted, then proceeds once resources release", () => {
    let state = generateWorld(20260710);
    const manoeuvring = state.vessels.filter((v) => v.status === "berthing" || v.status === "departing");
    for (const v of manoeuvring) v.phaseEndsTick = state.clock.tick + 5; // hold steady while the pool is saturated
    state.pilotage = {
      pilotsAvailable: 0,
      tugsAvailable: 0,
      bookings: manoeuvring.map((v) => ({ vesselId: v.id })),
    };
    const blocked = state.vessels.find((v) => v.status === "anchored")!;
    blocked.status = "berthing";
    const originalPhaseEnds = (blocked.phaseEndsTick = state.clock.tick + 1);

    state = tick(state);
    const after1 = state.vessels.find((v) => v.id === blocked.id)!;
    expect(after1.pilotageWaiting).toBe(true);
    expect(after1.status).toBe("berthing"); // did NOT complete despite phaseEndsTick being reached
    expect(after1.phaseEndsTick).toBeGreaterThan(originalPhaseEnds);
    expect(state.alerts.some((a) => a.message.includes("waiting for pilot/tug"))).toBe(true);

    // Release: one booked vessel finishes its manoeuvre externally — its pilot
    // and tugs return to the pool, which the waiting vessel immediately claims.
    const freedId = manoeuvring[0].id;
    state.vessels.find((v) => v.id === freedId)!.status = "alongside";
    state = tick(state);
    const after2 = state.vessels.find((v) => v.id === blocked.id)!;
    expect(after2.pilotageWaiting).toBe(false);
    expect(state.pilotage.bookings.some((b) => b.vesselId === blocked.id)).toBe(true);
    expect(state.alerts.some((a) => a.message.includes("secured pilot and tugs"))).toBe(true);
  });

  it("pool conservation holds after 200 ticks (free + booked == pool size)", () => {
    let state = generateWorld(20260710);
    for (let i = 0; i < 200; i++) {
      state = tick(state);
      assertInvariants(state);
    }
  });

  it("prompt, corpus and calibration record carry the pilotage/towage rule", () => {
    const state = generateWorld(20260710);
    const v = state.vessels.find((x) => x.status === "berthing" || x.status === "departing")!;
    v.pilotageWaiting = true;
    expect(buildSystemPrompt(state, "why is my vessel waiting?")).toContain("Pilotage & towage");
    const pilot1 = DOCTRINE_CORPUS.find((s) => s.sectionId === "OPS-PILOT §1")!;
    expect(pilot1.body).toContain("pilot");
    expect(pilot1.keywords).toContain("pilot");
    expect(CALIBRATION.some((c) => c.label.includes("Pilot") && c.demo !== c.real)).toBe(true);
  });
});

describe("Singapore marine environment (REAL-5, D-83)", () => {
  it("lightning: NEA feed live/stale is primary; the precipitation proxy is only the fallback", () => {
    let state = generateWorld(20260710);
    // Calm weather (no proxy trigger), but the NEA feed reports lightning.
    state.lightningFeed = { reading: { asOfMs: 1, active: true }, freshness: "live" };
    state = tick(state);
    expect(state.lightning.source).toBe("nea");
    expect(state.lightning.freshness).toBe("live");
    expect(state.lightning.active).toBe(true);
    expect(state.wxOps.stsSuspended).toBe(true); // gate reads state.lightning, not the proxy directly

    // Feed goes stale — last-good reading (still active) holds.
    state.lightningFeed = { ...state.lightningFeed, freshness: "stale" };
    state = tick(state);
    expect(state.lightning.freshness).toBe("stale");
    expect(state.lightning.active).toBe(true);

    // No feed at all (never polled successfully) — falls back to the proxy,
    // which reads calm precip here, so lightning clears through the fallback.
    state.lightningFeed = { reading: null, freshness: "live" };
    for (let i = 0; i < DOCTRINE.weather.recoveryClearTicks + 1; i++) state = tick(state);
    expect(state.lightning.source).toBe("precip_proxy");
    expect(state.lightning.freshness).toBe("simulated");
  });

  it("haze: PSI feed degrades to a calm-air baseline and can trigger the visibility gate alone", () => {
    let state = generateWorld(20260710);
    expect(state.haze.freshness).toBe("simulated"); // genesis: no feed yet
    expect(state.haze.visibilityKm).toBe(12);

    // Hazardous PSI, calm otherwise — haze alone drops effective visibility
    // below the gate threshold and suspends moves.
    state.hazeFeed = { reading: { asOfMs: 1, psi: 320 }, freshness: "live" };
    state = tick(state);
    expect(state.haze.freshness).toBe("live");
    expect(state.haze.visibilityKm).toBeLessThan(DOCTRINE.weather.visMinKm);
    expect(state.wxOps.movesSuspended).toBe(true);
    expect(state.alerts.some((a) => a.message.includes("haze"))).toBe(true);

    // Feed lost, never recovers — falls back to the calm-air baseline (not stuck hazardous).
    state.hazeFeed = { reading: null, freshness: "live" };
    state = tick(state);
    expect(state.haze.freshness).toBe("simulated");
    expect(state.haze.visibilityKm).toBe(12);
  });

  it("tide: the harmonic curve gates neopanamax berthing until the window opens, panamax/feeder unaffected", () => {
    let state = generateWorld(20260710);
    // Force the window shut and try to berth a neopanamax at an open deep-water berth
    // (genesis has every deep-water berth occupied — free one for the test).
    state.tide = { heightM: 0, windowOpen: false };
    const berth = state.berths.find((b) => b.deepWater)!;
    berth.status = "available";
    berth.vesselId = undefined;
    const vessel = state.vessels.find((v) => v.status === "anchored")!;
    vessel.class = "neopanamax";
    const otherAnchored = state.vessels.filter((v) => v.status === "anchored" && v.id !== vessel.id);
    for (const v of otherAnchored) v.status = "diverted"; // isolate: vessel is alone at the front of the queue
    const before = berth.status;
    state = tick(state);
    const berthAfter = state.berths.find((b) => b.id === berth.id)!;
    const vesselAfter = state.vessels.find((v) => v.id === vessel.id)!;
    expect(before).toBe("available");
    expect(berthAfter.status).toBe("available"); // still free — the tide window blocked the match
    expect(vesselAfter.status).toBe("anchored");

    // Force the window open — the same vessel berths on the next tick.
    state.tide = { heightM: 3, windowOpen: true };
    // Recompute from the already-clean tick's tide via a manual override next tick too,
    // since stepMarineEnvironment recalculates tide from sim time each tick — so instead
    // advance until the deterministic curve itself opens the window.
    let opened = false;
    for (let i = 0; i < 160 && !opened; i++) {
      state = tick(state);
      if (state.tide.windowOpen) opened = true;
    }
    expect(opened).toBe(true);
    for (let i = 0; i < 3; i++) state = tick(state);
    const finalVessel = state.vessels.find((v) => v.id === vessel.id)!;
    expect(["berthing", "alongside"]).toContain(finalVessel.status);
  });

  it("ticksUntilTideWindow feeds a wait lag into projectedBerthWaitHours/berthOptions for neopanamax only", () => {
    const state = generateWorld(20260710);
    state.tide = { heightM: 0, windowOpen: false };
    const neo = state.vessels.find((v) => v.status === "anchored")!;
    neo.class = "neopanamax";
    const feeder = { ...neo, class: "feeder" as const };
    expect(ticksUntilTideWindow(state)).toBeGreaterThan(0);
    expect(projectedBerthWaitHours(state, neo)).toBeGreaterThan(projectedBerthWaitHours(state, feeder));
  });

  it("pool/state invariants hold over 200 ticks with an injected storm (tide+haze+lightning all exercised)", () => {
    let state = generateWorld(20260710);
    state.disruptions.push({ id: "D", type: "storm", targetIds: [], startTick: 5, severity: 3, durationTicks: 60 });
    for (let i = 0; i < 200; i++) {
      state = tick(state);
      assertInvariants(state);
    }
  });

  it("prompt, corpus and calibration record carry the marine-environment rules", () => {
    const state = generateWorld(20260710);
    state.lightning = { active: true, freshness: "live", provenance: "live_external", source: "nea" };
    state.haze = { psi: 120, visibilityKm: 6, freshness: "live", provenance: "live_external" };
    state.tide = { heightM: 0.5, windowOpen: false };
    const prompt = buildSystemPrompt(state, "why is the neopanamax still waiting?");
    expect(prompt).toContain("Marine environment");
    const wx2 = DOCTRINE_CORPUS.find((s) => s.sectionId === "OPS-WX §2")!;
    expect(wx2.body).toContain("NEA");
    const tide1 = DOCTRINE_CORPUS.find((s) => s.sectionId === "OPS-TIDE §1")!;
    expect(tide1.body).toContain("neopanamax");
    expect(CALIBRATION.some((c) => c.label.includes("Haze") && c.demo !== c.real)).toBe(true);
    expect(CALIBRATION.some((c) => c.label.includes("Tide") && c.demo !== c.real)).toBe(true);
  });
});

describe("production calibration mode (REAL-6, D-84)", () => {
  it("switching modes swaps DOCTRINE thresholds, service cadence, and the doctrine corpus — data-only, no code path change", () => {
    syncCalibrationMode("demo"); // isolate from whatever a prior test left active
    expect(DOCTRINE.berth.targetMaxAnchorageWaitHours).toBe(4);
    expect(DOCTRINE.cargo.highPriorityDelayHours).toBe(4);
    expect(SERVICE_CADENCE_TICKS).toBe(DEMO_SERVICE_CADENCE_TICKS);
    const demoBerth3 = DOCTRINE_CORPUS.find((s) => s.sectionId === "OPS-BERTH §3")!;
    expect(demoBerth3.body).toContain("4 h");
    const demoSvc = DOCTRINE_CORPUS.find((s) => s.sectionId === "OPS-SVC §1")!;
    expect(demoSvc.body).toContain(`${DEMO_SERVICE_CADENCE_TICKS}-tick`);

    syncCalibrationMode("production");
    expect(DOCTRINE.berth.targetMaxAnchorageWaitHours).toBe(12);
    expect(DOCTRINE.cargo.highPriorityDelayHours).toBe(24);
    expect(SERVICE_CADENCE_TICKS).toBe(PRODUCTION_SERVICE_CADENCE_TICKS);
    const prodBerth3 = DOCTRINE_CORPUS.find((s) => s.sectionId === "OPS-BERTH §3")!;
    expect(prodBerth3.body).toContain("12 h");
    expect(prodBerth3.body).not.toContain("4 h");
    const prodSvc = DOCTRINE_CORPUS.find((s) => s.sectionId === "OPS-SVC §1")!;
    expect(prodSvc.body).toContain(`${PRODUCTION_SERVICE_CADENCE_TICKS}-tick`);

    // Fields with no disclosed production value stay identical (not invented).
    expect(DOCTRINE.crane.stsSuspendGustKts).toBe(35);
    expect(DOCTRINE.pilotage.pilotPoolSize).toBe(3);

    // A section that never cited either swapped field is untouched by identity
    // of content (still reflects the OTHER live values correctly either way).
    const pilot1 = DOCTRINE_CORPUS.find((s) => s.sectionId === "OPS-PILOT §1")!;
    expect(pilot1.body).toContain("3 pilots");

    syncCalibrationMode("demo"); // leave global state clean for later tests
  });

  it("the search index is rebuilt after a mode switch — stale-text sections never rank", () => {
    syncCalibrationMode("production");
    const hit = searchDoctrine("anchorage wait target")[0];
    expect(hit.section.body).toContain("12 h");
    syncCalibrationMode("demo");
    const hitDemo = searchDoctrine("anchorage wait target")[0];
    expect(hitDemo.section.body).toContain("4 h");
  });

  it("switching mode is idempotent and self-heals inside tick() from state.calibrationMode alone", () => {
    syncCalibrationMode("demo");
    let state = generateWorld(20260710, "production");
    expect(state.calibrationMode).toBe("production");
    expect(DOCTRINE.berth.targetMaxAnchorageWaitHours).toBe(12); // genesis synced the global

    // Simulate another part of the app switching the global to demo behind
    // this state's back (e.g. a different tick() call elsewhere) — the next
    // tick() on THIS state must re-sync to production from its own field.
    syncCalibrationMode("demo");
    expect(DOCTRINE.berth.targetMaxAnchorageWaitHours).toBe(4);
    state = tick(state);
    expect(DOCTRINE.berth.targetMaxAnchorageWaitHours).toBe(12);
    expect(state.calibrationMode).toBe("production");

    syncCalibrationMode("demo"); // leave global state clean for later tests
  });

  it("invariants + determinism hold over 200 ticks in production mode", () => {
    let a = generateWorld(20260710, "production");
    let b = generateWorld(20260710, "production");
    for (let i = 0; i < 200; i++) {
      a = tick(a);
      assertInvariants(a);
    }
    for (let i = 0; i < 200; i++) b = tick(b);
    expect(a).toEqual(b);
    syncCalibrationMode("demo"); // leave global state clean for later tests
  });

  it("the system prompt discloses the active calibration mode", () => {
    const demoState = generateWorld(20260710, "demo");
    expect(buildSystemPrompt(demoState, "status?")).toContain("DEMO");
    const prodState = generateWorld(20260710, "production");
    expect(buildSystemPrompt(prodState, "status?")).toContain("PRODUCTION");
    syncCalibrationMode("demo"); // leave global state clean for later tests
  });
});

describe("alert lifecycle + reports (D-77)", () => {
  it("collapses identical unacknowledged alerts into a ×N count; acknowledged restarts fresh", () => {
    const state = generateWorld(20260710);
    addAlert(state, "warning", "Test alert");
    state.clock.tick += RULE_COOLDOWN_TICKS;
    addAlert(state, "warning", "Test alert");
    const matches = state.alerts.filter((a) => a.message === "Test alert");
    expect(matches).toHaveLength(1);
    expect(matches[0].count).toBe(2);
    expect(matches[0].tick).toBe(state.clock.tick);
    matches[0].acknowledged = true;
    state.clock.tick += RULE_COOLDOWN_TICKS;
    addAlert(state, "warning", "Test alert");
    expect(state.alerts.filter((a) => a.message === "Test alert")).toHaveLength(2);
  });

  it("escalates an ignored critical exactly once, and never re-escalates the escalation", () => {
    const state = generateWorld(20260710);
    addAlert(state, "critical", "Big problem");
    state.clock.tick += CRITICAL_ESCALATE_AFTER_TICKS;
    escalateStaleCriticals(state);
    expect(state.alerts.filter((a) => a.message.includes("Unacknowledged critical"))).toHaveLength(1);
    escalateStaleCriticals(state);
    state.clock.tick += CRITICAL_ESCALATE_AFTER_TICKS;
    escalateStaleCriticals(state);
    expect(state.alerts.filter((a) => a.message.includes("Unacknowledged critical"))).toHaveLength(1);
  });

  it("keeps 24 sim-hours of KPI history (288 entries)", () => {
    const state = run(20260710, 300);
    expect(state.kpiHistory.length).toBe(288);
  });

  it("handover report captures the shift picture", () => {
    const state = run(20260710, 30);
    const rep = buildHandoverReport(state);
    expect(rep).toContain(`tick ${state.clock.tick}`);
    expect(rep).toContain("Resilience");
    expect(rep).toContain("OPEN DECISIONS");
    expect(rep).toContain("UNACKNOWLEDGED ALERTS");
    expect(rep).toContain("simulated data");
  });

  it("customer notice carries the calculated advisory fields", () => {
    const state = generateWorld(20260710);
    const customer = state.customers[0];
    const rec: Recommendation = {
      id: "REC-T",
      source: "rule",
      type: "safetyStock",
      title: "Advise",
      rationale: "r",
      impact: {},
      proposedEffect: { kind: "safetyStockAdvisory", customerId: customer.id, days: 2, note: "storm delays" },
      validationStatus: "valid",
      status: "pending",
      createdTick: 0,
      provenance: "calculated",
    };
    const notice = buildCustomerNotice(state, rec)!;
    expect(notice).toContain(customer.name);
    expect(notice).toContain("raise safety stock by 2 day(s)");
    expect(notice).toContain("OPS-CARGO §4");
    expect(notice).toContain("fictional");
  });
});

describe("AI agent layer (IP-4)", () => {
  it("retrieval forces the storm doc and matches keywords (D-33)", () => {
    const state = generateWorld(20260710);
    state.disruptions.push({ id: "D", type: "storm", targetIds: [], startTick: 0, durationTicks: 60, severity: 3 });
    const sections = retrieveDoctrine(state, "should I divert vessels because of the weather?");
    expect(sections.some((s) => s.docId === "OPS-WX")).toBe(true); // forced by active storm
    expect(sections.some((s) => s.docId === "OPS-BERTH")).toBe(true); // keyword "divert"
  });

  it("ranks berth options by earliest availability with the deep-water rule (D-70)", () => {
    const state = generateWorld(20260710);
    const anchored = state.vessels.find((v) => v.status === "anchored")!;

    const opts = berthOptions(state, { ...anchored, class: "feeder" });
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < opts.length; i++) {
      expect(opts[i].freesInHours).toBeGreaterThanOrEqual(opts[i - 1].freesInHours);
    }

    // Neopanamax options honour OPS-BERTH §1: deep-water berths only.
    const neoOpts = berthOptions(state, { ...anchored, class: "neopanamax" });
    for (const o of neoOpts) {
      expect(state.berths.find((b) => b.id === o.berthId)!.deepWater).toBe(true);
    }

    // Closed berths never appear.
    const closed = clone(state);
    const target = closed.berths.find((b) => b.id === opts[0].berthId)!;
    target.status = "closed";
    target.vesselId = undefined;
    expect(berthOptions(closed, { ...anchored, class: "feeder" }).some((o) => o.berthId === target.id)).toBe(false);
  });

  it("system prompt carries the calculated berth-options block (D-70)", () => {
    const state = generateWorld(20260710);
    const prompt = buildSystemPrompt(state, "where can I move the waiting vessels?");
    expect(prompt).toContain("Berth options [calculated]");
    expect(prompt).toContain("projected wait");
    const first = anchorageQueue(state)[0];
    expect(prompt).toMatch(new RegExp(`${first.id}: B\\d+`));
    // D-74: every option carries its action validity so the agent never
    // proposes a reassign to a berth that only frees later.
    expect(prompt).toContain("[valid reassign target]");
    expect(prompt).toContain("[NOT yet a valid target — hold until free]");
    expect(prompt).toContain("free NOW");
  });

  it("resilience breakdown reproduces the score arithmetic (D-75)", () => {
    const state = run(20260710, 30);
    const bd = resilienceBreakdown(state);
    expect(bd).toHaveLength(6);
    expect(bd.reduce((s, f) => s + f.weightPct, 0)).toBe(100);
    const penalty = bd.reduce((s, f) => s + f.contribution, 0);
    expect(Math.max(0, Math.min(100, Math.round(100 - penalty)))).toBe(resilienceScore(state));
    for (const f of bd) {
      expect(f.stress).toBeGreaterThanOrEqual(0);
      expect(f.stress).toBeLessThanOrEqual(1);
      expect(f.contribution).toBeCloseTo(f.stress * f.weightPct, 10);
    }
  });

  it("maxAnchorageWait surfaces the worst waiter (D-75)", () => {
    const state = run(20260710, 30);
    const worst = maxAnchorageWait(state);
    const anchored = state.vessels.filter((v) => v.status === "anchored");
    if (anchored.length === 0) {
      expect(worst).toBeNull();
    } else {
      const manualMax = Math.max(...anchored.map((v) => vesselWaitHours(state, v)));
      expect(worst!.hours).toBeCloseTo(Number(manualMax.toFixed(1)), 5);
      expect(anchored.some((v) => v.id === worst!.vessel.id)).toBe(true);
    }
  });

  it("firstGustBreach finds the earliest limit crossing with the right scope (D-75)", () => {
    const now = 1_000_000_000_000;
    const h = 3_600_000;
    const limits = { stsKts: 35, rtgKts: 45 };
    // Below both limits → null.
    expect(firstGustBreach([{ timeMs: now + h, gustKts: 20 }], now, limits)).toBeNull();
    // STS-only crossing at +3 h; earlier points below limit are skipped.
    const sts = firstGustBreach(
      [
        { timeMs: now + h, gustKts: 30 },
        { timeMs: now + 3 * h, gustKts: 38 },
        { timeMs: now + 5 * h, gustKts: 50 },
      ],
      now,
      limits,
    )!;
    expect(sts.scope).toBe("STS");
    expect(sts.limitKts).toBe(35);
    expect(sts.inHours).toBeCloseTo(3, 5);
    // A first crossing already over the RTG limit reports ALL cranes.
    const all = firstGustBreach([{ timeMs: now + 2 * h, gustKts: 47 }], now, limits)!;
    expect(all.scope).toBe("ALL");
    expect(all.limitKts).toBe(45);
    // Points before now are ignored.
    expect(firstGustBreach([{ timeMs: now - h, gustKts: 60 }], now, limits)).toBeNull();
  });

  it("system prompt carries the gust-forecast line when a forecast is provided (D-75)", () => {
    const state = generateWorld(20260710);
    const now = Date.now();
    const { system } = buildChatContext(state, "status?", [
      { timeMs: now + 2 * 3_600_000, gustKts: 40 },
    ]);
    expect(system).toContain("Gust forecast [live_external]");
    expect(system).toContain("STS cranes would suspend");
    // Without a forecast the line degrades honestly.
    expect(buildSystemPrompt(state, "status?")).toContain("Gust forecast [live_external]: no forecast data.");
  });

  it("ships both agent tools; search_doctrine takes only a query (D-67)", () => {
    expect(PROPOSE_ACTION_TOOL.name).toBe("propose_action");
    expect(SEARCH_DOCTRINE_TOOL.name).toBe("search_doctrine");
    expect((SEARCH_DOCTRINE_TOOL.input_schema as { required: string[] }).required).toEqual(["query"]);
  });

  it("parses a valid agent re-berth that survives validation (gate)", () => {
    const state = generateWorld(20260710);
    const berth = state.berths.find((b) => b.status === "available")!;
    const vessel = state.vessels.find((v) => v.status === "anchored" && (v.class !== "neopanamax" || berth.deepWater))!;
    const rec = parseAgentToolUse(
      state,
      { kind: "reassignBerth", vesselId: vessel.id, toBerthId: berth.id, title: "Re-berth", rationale: "waited too long [OPS-BERTH §3]" },
      "REC-A-1",
    );
    expect(rec.source).toBe("agent");
    expect(rec.provenance).toBe("ai_generated");
    expect(rec.validationStatus).toBe("valid");
    expect(rec.validatedEffect).toEqual({ kind: "reassignBerth", vesselId: vessel.id, toBerthId: berth.id });
  });

  it("marks a malformed or unexecutable agent proposal invalid", () => {
    const state = generateWorld(20260710);
    const missing = parseAgentToolUse(state, { kind: "reassignBerth", vesselId: "V1", title: "x", rationale: "y" }, "REC-A-2");
    expect(missing.validationStatus).toBe("invalid");
    expect(missing.validatedEffect).toBeUndefined();

    const badPort = parseAgentToolUse(state, { kind: "divertVessel", vesselId: state.vessels[0].id, toPortId: "PORT-NOWHERE", title: "x", rationale: "y" }, "REC-A-3");
    expect(badPort.validationStatus).toBe("invalid");
  });

  it("classifies an over-waited anchored vessel and honours the deep-water rule", () => {
    const state = generateWorld(20260710);
    const v = state.vessels.find((x) => x.status === "anchored")!;
    v.anchoredSinceTick = state.clock.tick - 200; // long wait
    const c = classifyVessel(state, v);
    expect(c.risk).not.toBe("normal");
    expect(c.reasons.length).toBeGreaterThan(0);

    const neo = { ...v, class: "neopanamax" as const };
    expect(suitableBerths(state, neo).every((b) => b.deepWater)).toBe(true);
  });

  it("system prompt is tick-stamped with provenance labels and doctrine", () => {
    const state = generateWorld(20260710);
    const prompt = buildSystemPrompt(state, "what is the weather doing to the yard?");
    expect(prompt).toContain("# Persona");
    expect(prompt).toContain(`tick ${state.clock.tick}`);
    expect(prompt).toContain("[calculated]");
    expect(prompt).toContain("[simulated]");
    expect(prompt).toContain("Doctrine index:");
    // Chatbot weather line carries the canonical band label (D-52).
    expect(prompt).toContain(`(${weatherRiskBand(state.weather.riskIndex).label} band)`);
  });

  it("system prompt carries the D-120 structured output style contract", () => {
    const state = generateWorld(20260710);
    const prompt = buildSystemPrompt(state, "status?");
    expect(prompt).toContain("# Output style");
    // D-120 (supersedes D-65's plain-text rule): the four renderable prefixes.
    for (const prefix of ["STATUS:", "METRIC:", "SECTION:", "POINT:"]) {
      expect(prompt).toContain(prefix);
    }
    // Figures belong in METRIC lines, not buried in a paragraph.
    expect(prompt).toContain("Never bury figures inside a paragraph");
    // Markdown headings/tables stay banned; the prefixes replace them.
    expect(prompt).toContain("Never use markdown headings");
    // D-122: no em/en dashes, and the compact per-entity list form.
    expect(prompt).toContain("Never use em dashes");
    expect(prompt).toContain("compact POINT line");
    // Substance-preserving brevity survives the restructure.
    expect(prompt).toContain("never drops substance");
    // Style rides between constraints and action logic in the assembly order.
    expect(prompt.indexOf("# Output style")).toBeGreaterThan(prompt.indexOf("# Constraints"));
    expect(prompt.indexOf("# Output style")).toBeLessThan(prompt.indexOf("# Action logic"));
  });

  it("system prompt, corpus and retrieval carry the D-111 conflict/OOD policy", () => {
    const state = generateWorld(20260710);
    const prompt = buildSystemPrompt(state, "a carrier says the vessel is on time but the map shows it diverted");
    // The prompt section is present and rides after action logic.
    expect(prompt).toContain("# Data conflicts and out-of-distribution");
    expect(prompt.indexOf("# Data conflicts and out-of-distribution")).toBeGreaterThan(prompt.indexOf("# Action logic"));
    // The four load-bearing behaviours: precedence, safety-default, OOD, escalate.
    expect(prompt).toContain("provenance precedence");
    expect(prompt).toContain("worse-for-resilience");
    expect(prompt).toContain("out-of-distribution");
    expect(prompt).toContain("[OPS-OOD §1]");
    // The behaviour is citable doctrine, not just an instruction.
    const ood = DOCTRINE_CORPUS.find((s) => s.sectionId === "OPS-OOD §1")!;
    expect(ood).toBeDefined();
    expect(ood.keywords).toContain("conflicting");
    expect(ood.body).toContain("provenance precedence");
    // A conflict question retrieves the section by its body/keyword terms (TF-IDF).
    expect(searchDoctrine("conflicting supplier report discrepancy").some((h) => h.section.docId === "OPS-OOD")).toBe(true);
  });
});

describe("weather bands (D-52 single source of truth)", () => {
  // Boundary values called out in the INT-1 gate.
  const cases: [number, string][] = [
    [0, "normal"],
    [30, "normal"],
    [31, "caution"],
    [60, "caution"],
    [61, "severe"],
    [80, "severe"],
    [81, "critical"],
    [100, "critical"],
  ];

  it.each(cases)("risk %i maps to the %s band", (risk, id) => {
    expect(weatherRiskBand(risk).id).toBe(id);
  });

  it("bands are contiguous and cover 0–100 with no gaps or overlaps", () => {
    expect(WEATHER_BANDS[0].minInclusive).toBe(0);
    expect(WEATHER_BANDS[WEATHER_BANDS.length - 1].maxInclusive).toBe(100);
    for (let i = 1; i < WEATHER_BANDS.length; i++) {
      expect(WEATHER_BANDS[i].minInclusive).toBe(WEATHER_BANDS[i - 1].maxInclusive + 1);
    }
  });

  it("every band has a palette entry so all renderers derive one colour per band", () => {
    for (const b of WEATHER_BANDS) {
      const c = WEATHER_BAND_COLOR[b.id];
      expect(c).toBeDefined();
      expect(c.hex).toMatch(/^#[0-9a-f]{6}$/i);
      expect(c.bg).toContain("bg-");
      expect(c.stroke).toContain("stroke-");
      expect(c.dot).toContain("bg-");
    }
    // The severe orange formerly duplicated as a literal in Weather.tsx.
    expect(WEATHER_BAND_COLOR.severe.hex).toBe("#e07b39");
  });

  it("gauge colour is not inverted: high risk is red (critical), low risk green (normal)", () => {
    // The bug this phase fixes — resilience semantics (high = green) were applied
    // to risk. Gauge, band bar and header all read the stroke/bg from this map.
    expect(WEATHER_BAND_COLOR[weatherRiskBand(90).id].stroke).toContain("#d03b3b");
    expect(WEATHER_BAND_COLOR[weatherRiskBand(90).id].stroke).not.toContain("#1baf7a");
    expect(WEATHER_BAND_COLOR[weatherRiskBand(10).id].stroke).toContain("#1baf7a");
  });

  it("a swept risk always resolves to a band with a palette colour", () => {
    for (let risk = 0; risk <= 100; risk++) {
      const band = weatherRiskBand(risk);
      expect(WEATHER_BAND_COLOR[band.id]).toBeDefined();
    }
  });
});

describe("weather→ops coupling (D-54, INT-3)", () => {
  // Feed presets (risk = gust·1.4 + wave·22 + precip·2.5 + vis term):
  const CALM = { asOfMs: 0, windKts: 8, gustKts: 10, windDirDeg: 90, waveHeightM: 0.3, visibilityKm: 12, precipMm: 0 }; // risk ~21 normal
  const GUST_STS = { ...CALM, gustKts: 40 }; // risk ~63 severe — STS gust trigger, RTG clear
  const GUST_RTG = { ...CALM, gustKts: 50 }; // risk ~77 severe — STS+RTG gust triggers
  const LOW_VIS = { ...CALM, visibilityKm: 2 }; // risk ~39 caution — W3 moves trigger only
  const CRITICAL_CLEAR_VIS = { ...CALM, gustKts: 30, waveHeightM: 2, precipMm: 8 }; // risk 100 critical, vis fine
  const CAUTION = { ...CALM, gustKts: 25, waveHeightM: 0.5 }; // risk ~46 caution

  function withFeed(state: SimState, reading: WeatherReading, freshness: "live" | "stale" = "live"): SimState {
    state.weatherFeed = { reading, freshness };
    return state;
  }

  it("W1: gusts at the STS limit suspend STS work and freeze progress", () => {
    let state = withFeed(generateWorld(20260710), GUST_STS);
    state = tick(state);
    expect(state.wxOps.stsSuspended).toBe(true);
    expect(state.wxOps.rtgSuspended).toBe(false);
    // STS suspension freezes crane WORK, not vessel movement (a berthing vessel
    // can still become alongside), so compare progress per-vessel by id rather
    // than as a whole array (D-80: the alongside set can grow within a tick).
    const before = new Map(state.vessels.filter((v) => v.status === "alongside").map((v) => [v.id, v.workProgress]));
    state = tick(state);
    for (const v of state.vessels) {
      if (before.has(v.id)) expect(v.workProgress).toBe(before.get(v.id)); // frozen ops don't progress
    }
  });

  it("W1: resume needs 3 consecutive clear ticks; a flap resets the counter", () => {
    let state = withFeed(generateWorld(20260710), GUST_STS);
    state = tick(state);
    expect(state.wxOps.stsSuspended).toBe(true);
    // Two clear ticks — still suspended.
    withFeed(state, CALM);
    state = tick(state);
    state = tick(state);
    expect(state.wxOps.stsSuspended).toBe(true);
    // Flap: gusts return for one tick → counter resets.
    withFeed(state, GUST_STS);
    state = tick(state);
    withFeed(state, CALM);
    state = tick(state);
    state = tick(state);
    expect(state.wxOps.stsSuspended).toBe(true); // only 2 clear ticks since the flap
    state = tick(state);
    expect(state.wxOps.stsSuspended).toBe(false); // 3rd clear tick resumes
    expect(state.alerts.some((a) => a.message.includes("STS crane operations resumed"))).toBe(true);
  });

  it("W2: RTG suspension stops yard outflow and discharge placement", () => {
    let state = withFeed(generateWorld(20260710), GUST_RTG);
    state = tick(state);
    expect(state.wxOps.rtgSuspended).toBe(true);
    expect(state.wxOps.movesSuspended).toBe(false); // severe, not critical; vis fine
    const yardTEU = (s: SimState) => s.cargoLots.filter((l) => l.status === "yard").reduce((t, l) => t + l.quantityTEU, 0);
    const before = yardTEU(state);
    state = tick(state);
    expect(yardTEU(state)).toBe(before); // no outflow, no new placements
  });

  it("W3: low visibility suspends arrivals and freezes berthing timers", () => {
    let state = withFeed(generateWorld(20260710), LOW_VIS);
    const arriving = state.vessels.find((v) => v.status === "approaching")!;
    arriving.etaTick = state.clock.tick + 1; // due next tick
    const berthing = state.vessels.find((v) => v.status === "berthing");
    state = tick(state);
    expect(state.wxOps.movesSuspended).toBe(true);
    const arrivingAfter = state.vessels.find((v) => v.id === arriving.id)!;
    expect(arrivingAfter.status).toBe("approaching"); // arrival suspended
    if (berthing) {
      const b = state.vessels.find((v) => v.id === berthing.id)!;
      expect(b.status).toBe("berthing"); // manoeuvre frozen, not completed
    }
    // Several more frozen ticks: the berthing vessel still never completes.
    state = tick(state);
    state = tick(state);
    if (berthing) {
      expect(state.vessels.find((v) => v.id === berthing.id)!.status).toBe("berthing");
    }
  });

  it("W4: in the severe band feeders skip berthing while larger classes berth", () => {
    const world = withFeed(generateWorld(20260710), GUST_STS); // severe band
    // Isolate the queue: a feeder (head) and a panamax behind it, equal priority.
    const anchored = world.vessels.filter((v) => v.status === "anchored");
    const [feeder, panamax] = anchored;
    feeder.class = "feeder";
    feeder.manifest = [];
    feeder.anchoredSinceTick = -20;
    panamax.class = "panamax";
    panamax.manifest = [];
    panamax.anchoredSinceTick = -10;
    for (const v of anchored.slice(2)) {
      v.status = "approaching";
      v.etaTick = world.clock.tick + 100;
      v.anchoredSinceTick = undefined;
    }
    // Guarantee an open berth.
    const berth = world.berths.find((b) => b.status === "available") ?? world.berths[0];
    if (berth.status !== "available") {
      const occupant = world.vessels.find((v) => v.id === berth.vesselId);
      if (occupant) { occupant.status = "departing"; occupant.berthId = undefined; occupant.phaseEndsTick = 1; }
      berth.status = "available";
      berth.vesselId = undefined;
    }
    const after = tick(world);
    expect(after.vessels.find((v) => v.id === feeder.id)!.status).toBe("anchored"); // skipped
    expect(after.vessels.find((v) => v.id === panamax.id)!.status).toBe("berthing"); // berthed
  });

  it("W5: critical band suspends cranes and moves regardless of gusts, but anchoring stays allowed", () => {
    let state = withFeed(generateWorld(20260710), CRITICAL_CLEAR_VIS);
    const arriving = state.vessels.find((v) => v.status === "approaching")!;
    arriving.etaTick = state.clock.tick + 1;
    state = tick(state);
    expect(weatherRiskBand(state.weather.riskIndex).id).toBe("critical");
    expect(state.wxOps.stsSuspended).toBe(true); // gust 30 < 35, critical still suspends
    expect(state.wxOps.rtgSuspended).toBe(true);
    expect(state.wxOps.movesSuspended).toBe(true);
    expect(state.vessels.find((v) => v.id === arriving.id)!.status).toBe("anchored"); // safe move allowed
  });

  it("W-caution: approaching ETAs slip +1 every 3 consecutive caution ticks, deterministically", () => {
    const run = () => {
      let state = withFeed(generateWorld(20260710), CAUTION);
      const v = state.vessels.find((x) => x.status === "approaching")!;
      state.vessels.forEach((x) => { if (x.status === "approaching") x.etaTick = 500; });
      for (let i = 0; i < 6; i++) state = tick(state);
      return { eta: state.vessels.find((x) => x.id === v.id)!.etaTick, snapshot: JSON.stringify(state) };
    };
    const a = run();
    const b = run();
    expect(a.eta).toBe(502); // two slips over 6 caution ticks
    expect(a.snapshot).toBe(b.snapshot); // same seed + same feed → identical state
  });

  it("W7: a stale feed holds current suspensions and triggers no new ones", () => {
    // Hold: suspend live, then go stale with calm values — stays suspended.
    let held = withFeed(generateWorld(20260710), GUST_STS);
    held = tick(held);
    expect(held.wxOps.stsSuspended).toBe(true);
    withFeed(held, CALM, "stale");
    for (let i = 0; i < 5; i++) held = tick(held);
    expect(held.wxOps.stsSuspended).toBe(true); // no release while stale
    expect(held.alerts.some((a) => a.message.includes("degraded confidence"))).toBe(true);
    // No new: stormy values arriving already-stale never suspend.
    let calm = withFeed(generateWorld(20260710), GUST_RTG, "stale");
    calm = tick(calm);
    expect(calm.wxOps.stsSuspended).toBe(false);
    expect(calm.wxOps.rtgSuspended).toBe(false);
  });

  it("KPI: weather-suspended cranes count unavailable in craneAvailabilityPct", () => {
    let state = withFeed(generateWorld(20260710), CRITICAL_CLEAR_VIS);
    state = tick(state);
    const kpis = state.kpiHistory[state.kpiHistory.length - 1];
    expect(kpis.craneAvailabilityPct).toBe(0); // all STS + RTG suspended
  });

  it("suspension alerts carry entityRefs and truthful critical-band text", () => {
    let state = withFeed(generateWorld(20260710), CRITICAL_CLEAR_VIS);
    state = tick(state);
    const sts = state.alerts.find((a) => a.message.includes("STS crane operations suspended"));
    expect(sts?.entityRef?.entityType).toBe("crane");
    const moves = state.alerts.find((a) => a.message.includes("berthing and unberthing suspended"));
    expect(moves).toBeDefined();
    expect(moves!.message).toContain("may still anchor"); // the text is now true
    expect(moves?.entityRef?.entityType).toBe("vessel");
  });
});

// D-85 (AIF-1): the rule-economics tests that lived here (weather divert/hold,
// port spreading, proposal cap, congestion rules) were deleted with the rule
// engine itself. The agent proposal path and preview purity remain under test.
describe("agent holds & previews (D-55, INT-5)", () => {
  function stormWorld(seed = 20260710, durationTicks = 150): SimState {
    const state = generateWorld(seed);
    state.disruptions.push({ id: "D-STORM", type: "storm", targetIds: [], startTick: 0, durationTicks, severity: 3 });
    return tick(state); // storm overlay + wxOps engage
  }

  it("agent holdVessel round-trip: parsed, validated, executed to heldUntilTick", () => {
    const state = generateWorld(20260710);
    const anchored = state.vessels.find((v) => v.status === "anchored")!;
    const rec = parseAgentToolUse(
      state,
      { kind: "holdVessel", title: `Hold ${anchored.name}`, rationale: "Congestion per OPS-BERTH §3.", vesselId: anchored.id, untilTick: state.clock.tick + 12 },
      "REC-AGENT-HOLD",
    );
    expect(rec.type).toBe("hold");
    expect(rec.validationStatus).toBe("valid");
    applyEffect(state, rec.validatedEffect!);
    expect(state.vessels.find((v) => v.id === anchored.id)!.heldUntilTick).toBe(state.clock.tick + 12);
    // Past-tick holds are rejected by the existing validator.
    const bad = parseAgentToolUse(state, { kind: "holdVessel", title: "t", rationale: "r", vesselId: anchored.id, untilTick: 0 }, "REC-BAD");
    expect(bad.validationStatus).toBe("invalid");
  });

  it("preview purity is unchanged: previewing a hold never touches live state", () => {
    const state = stormWorld();
    const hold = { kind: "holdVessel", vesselId: state.vessels.find((v) => v.status === "anchored")!.id, untilTick: state.clock.tick + 10 } as const;
    const before = JSON.stringify(state);
    const result = previewEffect(state, hold, 5);
    expect(JSON.stringify(state)).toBe(before);
    expect(result.valid).toBe(true);
    expect(result.withEffect).toBeDefined();
  });
});

describe("safety-stock contract (D-56, INT-6)", () => {
  // One high-priority customer with exactly one delayed shipment we control.
  function delayedWorld(waitHours: number, coverDays: number) {
    const state = generateWorld(20260710);
    const customer = state.customers.find((c) => c.defaultPriority === "high" || c.temperatureSensitive)!;
    customer.daysOfCoverRemaining = coverDays;
    // Strip the customer from every other manifest so the delay we set is the only one.
    for (const v of state.vessels) v.manifest = v.manifest.filter((m) => m.customerId !== customer.id);
    const vessel = state.vessels.find((v) => v.status === "anchored")!;
    vessel.anchoredSinceTick = state.clock.tick - waitHours * 12; // 12 ticks/hour
    vessel.manifest.push({ id: "MF-D56", quantityTEU: 400, containerCount: 20, sizeMix: { twentyFt: 10, fortyFt: 10 }, type: "standard", customerId: customer.id, priority: "high" });
    return { state, customer, vessel };
  }

  it("preview surfaces the customer's cover delta, not the unchanged port KPIs (D-121)", () => {
    const { state, customer } = delayedWorld(60, 2); // a real delayed shipment, thin cover
    const effect = { kind: "safetyStockAdvisory", customerId: customer.id, days: 2, note: "" } as const;
    const result = previewEffect(state, effect, 24);
    expect(result.valid).toBe(true);
    // The reported symptom: port KPIs are genuinely identical with/without, because
    // an advisory touches inventory, not port throughput.
    expect(result.withEffect.resilienceScore).toBe(result.without.resilienceScore);
    expect(result.withEffect.teuAtRisk).toBe(result.without.teuAtRisk);
    expect(result.withEffect.vesselsWaiting).toBe(result.without.vesselsWaiting);
    // The fix: the field the action actually moves is now surfaced and non-zero.
    expect(result.coverDelta).toBeDefined();
    expect(result.coverDelta!.customerName).toBe(customer.name);
    expect(result.coverDelta!.afterDays - result.coverDelta!.beforeDays).toBeCloseTo(2, 5);
  });

  it("a non-advisory effect carries no coverDelta", () => {
    const { state, vessel } = delayedWorld(60, 2);
    const hold = { kind: "holdVessel", vesselId: vessel.id, untilTick: state.clock.tick + 10 } as const;
    expect(previewEffect(state, hold, 5).coverDelta).toBeUndefined();
  });

  it("shortfall edges: delay under cover floors at 1; fractional delays round up", () => {
    const under = delayedWorld(6, 5); // delay 0.3 d < cover 5 d
    expect(safetyStockShortfallDays(under.state, under.customer.id)).toBe(1);
    const frac = delayedWorld(60, 1); // delay 2.5 d, cover 1 → ceil(1.5) = 2
    expect(safetyStockShortfallDays(frac.state, frac.customer.id)).toBe(2);
  });

  it("expected delay aggregates as the MAX across the customer's delayed vessels", () => {
    const { state, customer } = delayedWorld(24, 2); // vessel A: 1.0 d
    const other = state.vessels.filter((v) => v.status === "anchored")[1];
    other.anchoredSinceTick = state.clock.tick - 100 * 12; // vessel B: ~4.2 d — the worst shipment
    other.manifest.push({ id: "MF-D56B", quantityTEU: 100, containerCount: 5, sizeMix: { twentyFt: 5, fortyFt: 0 }, type: "standard", customerId: customer.id, priority: "high" });
    expect(safetyStockShortfallDays(state, customer.id)).toBe(Math.ceil(4.2 - 2)); // 3 — not vessel A's 1.0 d
  });

  it("displayed = executed round-trip: the queued days are exactly what approval applies", () => {
    // D-85: seeded via the agent path — the only automatic proposer left. The
    // tick's pending refresh must still rewrite days + rationale in place.
    let { state, customer } = delayedWorld(60, 1);
    state.recommendations.push(
      parseAgentToolUse(
        state,
        { kind: "safetyStockAdvisory", title: "Advisory", rationale: "Cover shortfall per OPS-CARGO §4.", customerId: customer.id, days: 99 },
        "REC-D56-RT",
      ),
    );
    state = tick(state);
    const rec = state.recommendations.find((r) => r.id === "REC-D56-RT")!;
    expect(rec).toBeDefined();
    const effect = rec.proposedEffect as { kind: "safetyStockAdvisory"; customerId: string; days: number };
    expect(effect.days).toBeGreaterThanOrEqual(2); // not the old hard-coded +2 by accident: assert text agreement too
    expect(rec.rationale).toContain(`Raise safety stock by ${effect.days} d`);
    expect(rec.validationStatus).toBe("valid");
    const cust = state.customers.find((c) => c.id === customer.id)!;
    const before = { safety: cust.safetyStockDays, cover: cust.daysOfCoverRemaining };
    applyEffect(state, rec.validatedEffect!);
    expect(cust.safetyStockDays - before.safety).toBe(effect.days);
    expect(Number((cust.daysOfCoverRemaining - before.cover).toFixed(1))).toBe(effect.days);
  });

  it("invalid days are rejected by the validator", () => {
    const { state, customer } = delayedWorld(24, 1);
    expect(validateEffect(state, { kind: "safetyStockAdvisory", customerId: customer.id, days: 0 }).status).toBe("invalid");
    expect(validateEffect(state, { kind: "safetyStockAdvisory", customerId: customer.id, days: 2.5 }).status).toBe("invalid");
    expect(validateEffect(state, { kind: "safetyStockAdvisory", customerId: customer.id, days: 3 }).status).toBe("valid");
  });

  it("pending advisories refresh in place when the delay worsens", () => {
    // D-85: agent-seeded pending advisory; the tick wiring of
    // refreshSafetyStockRecs must keep its days tracking the live shortfall.
    let { state, customer, vessel } = delayedWorld(30, 1); // delay 1.3 d → shortfall 1
    state.recommendations.push(
      parseAgentToolUse(
        state,
        { kind: "safetyStockAdvisory", title: "Advisory", rationale: "Cover shortfall per OPS-CARGO §4.", customerId: customer.id },
        "REC-D56-REFRESH",
      ),
    );
    state = tick(state);
    const rec = () => state.recommendations.find((r) => r.id === "REC-D56-REFRESH")!;
    const firstDays = (rec().proposedEffect as { days: number }).days;
    // The shipment slips much further behind.
    state.vessels.find((v) => v.id === vessel.id)!.anchoredSinceTick = state.clock.tick - 120 * 12; // ~5 d
    state = tick(state);
    const refreshed = (rec().proposedEffect as { days: number }).days;
    expect(refreshed).toBeGreaterThan(firstDays);
    expect(rec().rationale).toContain(`Raise safety stock by ${refreshed} d`); // rationale tracked the effect
  });

  it("agent parity: the parser computes days; any LLM-authored quantity is ignored", () => {
    const { state, customer } = delayedWorld(60, 1);
    const rec = parseAgentToolUse(
      state,
      { kind: "safetyStockAdvisory", title: "Advisory", rationale: "Cover shortfall per OPS-CARGO §4.", customerId: customer.id, days: 99 },
      "REC-AGENT-SS",
    );
    expect(rec.validationStatus).toBe("valid");
    const effect = rec.proposedEffect as { days: number };
    expect(effect.days).toBe(safetyStockShortfallDays(state, customer.id));
    expect(effect.days).not.toBe(99);
  });

  it("system prompt carries the structured [calculated] safety-stock block", () => {
    const { state, customer } = delayedWorld(60, 1);
    const prompt = buildSystemPrompt(state, "should any customer raise safety stock?");
    expect(prompt).toContain("Safety-stock outlook [calculated]");
    const line = prompt.split("\n").find((l) => l.includes(customer.name) && l.includes("computed shortfall"))!;
    expect(line).toBeDefined();
    for (const field of ["affected", "TEU", "cover", "expected delay", "computed shortfall", "advisory"]) {
      expect(line).toContain(field);
    }
  });
});

describe("integrated storm arc + chatbot grounding (INT-7)", () => {
  const CALM_READING: WeatherReading = { asOfMs: 0, windKts: 8, gustKts: 10, windDirDeg: 90, waveHeightM: 0.3, visibilityKm: 12, precipMm: 0 };

  // One seeded arc: sev-3 storm at tick 2 for 60 ticks; the live feed returns
  // calm at tick 70 (the storm's simulated drift decays too slowly for a
  // bounded test — a recovered feed is the realistic post-storm signal).
  function runArc() {
    let state = generateWorld(20260710);
    state.disruptions.push({ id: "D-ARC", type: "storm", targetIds: [], startTick: 2, durationTicks: 60, severity: 3 });
    const marks = { suspendedTick: -1, resumedTick: -1 };
    for (let i = 0; i < 120; i++) {
      if (state.clock.tick === 70) state.weatherFeed = { reading: CALM_READING, freshness: "live" };
      state = tick(state);
      const wx = state.wxOps;
      if (marks.suspendedTick < 0 && wx.stsSuspended && wx.rtgSuspended && wx.movesSuspended) marks.suspendedTick = state.clock.tick;
      if (marks.suspendedTick > 0 && marks.resumedTick < 0 && !wx.stsSuspended && !wx.rtgSuspended && !wx.movesSuspended) marks.resumedTick = state.clock.tick;
    }
    return { state, marks };
  }

  // D-85 (AIF-1): the arc no longer asserts auto-generated recommendations —
  // proposing is the agent's job now (covered by the IP-4/D-74 tests).
  it("one deterministic arc: inject → suspend → recover", () => {
    const a = runArc();
    expect(a.marks.suspendedTick).toBeGreaterThan(0); // full W5 suspension engaged
    expect(a.marks.resumedTick).toBeGreaterThan(a.marks.suspendedTick); // staged recovery completed
    expect(a.state.alerts.some((al) => al.message.includes("suspended"))).toBe(true);
    expect(a.state.alerts.some((al) => al.message.includes("resumed"))).toBe(true);
    expect(() => assertInvariants(a.state)).not.toThrow();
    const b = runArc();
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state)); // same seed → identical arc
  });

  it("mid-storm system prompt grounds suspensions, holds and forced doctrine", () => {
    let state = generateWorld(20260710);
    state.disruptions.push({ id: "D-ARC", type: "storm", targetIds: [], startTick: 0, durationTicks: 60, severity: 3 });
    for (let i = 0; i < 15; i++) state = tick(state);
    expect(state.wxOps.stsSuspended).toBe(true);
    const anchored = state.vessels.find((v) => v.status === "anchored")!;
    applyEffect(state, { kind: "holdVessel", vesselId: anchored.id, untilTick: state.clock.tick + 30 });
    const prompt = buildSystemPrompt(state, "why are the cranes stopped and which vessels are held?");
    expect(prompt).toContain("Weather-ops suspensions [simulated]");
    expect(prompt).toContain("STS cranes suspended");
    expect(prompt).toContain("clear ticks toward resume");
    expect(prompt).toContain("Held vessels [simulated]");
    expect(prompt).toContain(`held until tick ${state.clock.tick + 30}`);
    expect(prompt).toContain("[OPS-CRANE §1]"); // retrieval forced by the suspension
    expect(prompt).toContain("[OPS-WX §1]");
  });

  it("weather-clear snapshot says so instead of omitting the lines", () => {
    const state = generateWorld(20260710);
    const prompt = buildSystemPrompt(state, "status?");
    expect(prompt).toContain("Weather-ops suspensions [simulated]: none");
    expect(prompt).toContain("Held vessels [simulated]: none");
  });
});

describe("AI-first queue (D-85, AIF-1)", () => {
  it("the tick never creates recommendations — even through a severe storm", () => {
    let state = generateWorld(20260710);
    state.disruptions.push({ id: "D-STORM", type: "storm", targetIds: [], startTick: 1, durationTicks: 100, severity: 3 });
    for (let i = 0; i < 150; i++) {
      state = tick(state);
      expect(state.recommendations).toHaveLength(0);
    }
  });
});
