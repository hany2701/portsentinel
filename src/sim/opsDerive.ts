// Operations-module derivations (OPS workstream). Every function here is a
// pure, deterministic projection over SimState: no Date, no rng access (the
// shared state.rng is NEVER read or advanced — asserted by opsDerive.test.ts),
// no mutation. These are isolated Operations-level calculations per the
// approved plan: shared sim derivations (berthFreeTicks et al.) stay the
// single author for everything outside Operations.
import { DOCTRINE } from "./doctrine";
import { MOVES_PER_CRANE_PER_TICK, TICK_SIM_MINUTES, ticksToHours } from "./config";
import { SERVICE_CADENCE_TICKS, SERVICE_JITTER, SERVICE_ROSTER, type Service } from "./roster";
import { ticksUntilTideWindow } from "./tide";
import {
  anchorageQueue,
  berthFreeTicks,
  berthOptions,
  craneUnitsAtBerth,
  isHighPriority,
  lotDwellDays,
  projectedBerthWaitHours,
  remainingStormTicks,
  vesselWaitHours,
  yardBlockOccupiedTEU,
} from "./derive";
import { berthLayout, yardBlockBox, TRUCK_BRANCHES } from "../twin/layout";
import type { Berth, CargoLot, EntityRef, Priority, SimState, Vessel } from "./types";

// Matches derive.ts's private DEPART_TICKS (unberthing manoeuvre) — duplicated
// deliberately: exporting it would touch shared sim code beyond the approved
// berthFreeTicks export.
const DEPART_TICKS = 2;

function hoursToTicks(hours: number): number {
  return Math.round((hours * 60) / TICK_SIM_MINUTES);
}

// ---------------------------------------------------------------------------
// 1. Remaining work for an alongside vessel — LOAD-AWARE projection.
// Inputs: crane units at the vessel's berth, remaining discharge fraction,
// remaining load target, wxOps suspensions, pilotage pool.
// Method: discharge and loading run concurrently (dual-cycling, see workCargo
// in tick.ts), so remaining work = max(dischargeTicks, loadTicks), plus the
// same suspension/pilotage/departure lags berthFreeTicks uses.
// Divergence from shared berthFreeTicks: that function ignores the loading
// phase (underestimates). This one is used ONLY for Operations displays; on a
// discharge-only vessel the two agree exactly (validated by unit test).
// ---------------------------------------------------------------------------
export function vesselRemainingWorkTicks(state: SimState, v: Vessel): number {
  const suspended = state.wxOps.stsSuspended || state.wxOps.movesSuspended;
  const suspensionLag = suspended ? Math.max(remainingStormTicks(state), DOCTRINE.weather.recoveryClearTicks) : 0;
  const pilotageLag =
    state.pilotage.pilotsAvailable < 1 || state.pilotage.tugsAvailable < DOCTRINE.pilotage.tugsPerManoeuvre ? 1 : 0;
  if (v.status !== "alongside" || !v.berthId) return suspensionLag + pilotageLag;
  const rate = craneUnitsAtBerth(state, v.berthId) * MOVES_PER_CRANE_PER_TICK;
  if (rate <= 0) return 999;
  const total = v.manifest.reduce((s, m) => s + m.quantityTEU, 0);
  const dischargeTicks = Math.ceil(((1 - v.workProgress) * total) / rate);
  // Before the first alongside work tick the load claim hasn't happened yet;
  // estimate it the way claimOnwardLots will: yard lots waiting for this
  // vessel's own service, up to load capacity.
  const loadRemaining =
    v.loadTarget !== undefined
      ? (v.loadTarget ?? 0) - (v.loadedTEU ?? 0)
      : Math.min(
          v.loadTEU,
          state.cargoLots
            .filter((l) => l.status === "yard" && l.connectingServiceId === v.serviceId)
            .reduce((s, l) => s + l.quantityTEU, 0),
        );
  const loadTicks = Math.ceil(Math.max(0, loadRemaining) / rate);
  return Math.max(dischargeTicks, loadTicks) + DEPART_TICKS + suspensionLag + pilotageLag;
}

// 2. Projected departure tick for an alongside vessel; null otherwise (no ETD
// field exists in the sim — this is a computed projection, rendered "—" when null).
export function projectedETD(state: SimState, v: Vessel): number | null {
  if (v.status !== "alongside" || !v.berthId) return null;
  return state.clock.tick + vesselRemainingWorkTicks(state, v);
}

// ---------------------------------------------------------------------------
// 3. Berth timeline: per berth, the current occupancy window plus a greedy
// projection of the doctrine-ordered queue (then approaching vessels by ETA)
// onto berths, honouring the same suitability rules assignBerths uses
// (deep-water for neopanamax, tide-window lag, holds, closed skipped).
// Assumes no new disruptions — labelled "projection" in the UI.
// Future service calls are NOT berth-attributed here (that would invent an
// assignment); they are a separate lane via serviceCallSlots.
// ---------------------------------------------------------------------------
export type BerthWindow = {
  kind: "occupied" | "projected";
  vesselId: string;
  vesselName: string;
  startTick: number;
  endTick: number;
  workProgress?: number;
};
export type BerthTimelineRow = {
  berth: Berth;
  windows: BerthWindow[];
};

function estimatedServiceTicks(state: SimState, v: Vessel, berthId: string): number {
  const rate = Math.max(1, craneUnitsAtBerth(state, berthId)) * MOVES_PER_CRANE_PER_TICK;
  const total = v.manifest.reduce((s, m) => s + m.quantityTEU, 0);
  return Math.max(4, Math.ceil(total / rate) + DEPART_TICKS);
}

export function berthTimeline(state: SimState, horizonTicks: number): BerthTimelineRow[] {
  const now = state.clock.tick;
  const horizon = now + horizonTicks;
  const rows = new Map<string, BerthTimelineRow>();
  const freeAt = new Map<string, number>();
  for (const b of state.berths) {
    const row: BerthTimelineRow = { berth: b, windows: [] };
    rows.set(b.id, row);
    if (b.status === "closed") {
      freeAt.set(b.id, Infinity);
      continue;
    }
    const occupant = state.vessels.find((v) => v.id === b.vesselId);
    if (b.status === "occupied" && occupant) {
      const end =
        occupant.status === "alongside"
          ? now + vesselRemainingWorkTicks(state, occupant)
          : now + berthFreeTicks(state, b); // berthing phase: shared estimate
      row.windows.push({
        kind: "occupied",
        vesselId: occupant.id,
        vesselName: occupant.name,
        startTick: now,
        endTick: end,
        workProgress: occupant.workProgress,
      });
      freeAt.set(b.id, end);
    } else {
      freeAt.set(b.id, now + berthFreeTicks(state, b));
    }
  }

  // Candidates in assignment order: doctrine queue first, then approaching by ETA.
  const queue = anchorageQueue(state);
  const approaching = state.vessels
    .filter((v) => v.status === "approaching")
    .sort((a, b) => a.etaTick - b.etaTick || a.id.localeCompare(b.id));
  const tideLagNow = ticksUntilTideWindow(state);
  for (const v of [...queue, ...approaching]) {
    let best: { berthId: string; start: number } | null = null;
    for (const b of state.berths) {
      if (b.status === "closed") continue;
      if (v.class === "neopanamax" && !b.deepWater) continue;
      let start = Math.max(freeAt.get(b.id) ?? now, now);
      if (v.status === "approaching") start = Math.max(start, v.etaTick);
      if (v.heldUntilTick !== undefined) start = Math.max(start, v.heldUntilTick);
      if (v.class === "neopanamax") start = Math.max(start, now + tideLagNow);
      if (best === null || start < best.start) best = { berthId: b.id, start };
    }
    if (!best || best.start > horizon) continue;
    const end = best.start + estimatedServiceTicks(state, v, best.berthId);
    rows.get(best.berthId)!.windows.push({
      kind: "projected",
      vesselId: v.id,
      vesselName: v.name,
      startTick: best.start,
      endTick: end,
    });
    freeAt.set(best.berthId, end);
  }
  return state.berths.map((b) => rows.get(b.id)!);
}

// ---------------------------------------------------------------------------
// 4. Scheduled service calls within a horizon — the jitter-FREE base-slot
// arithmetic of roster.ts nextServiceSlot, WITHOUT the rng draw (reading the
// shared rng from UI code would desync deterministic replays). Actual bookings
// land within ±SERVICE_JITTER ticks of these slots — labelled in the UI.
// ---------------------------------------------------------------------------
export type ServiceCallSlot = { service: Service; slotTick: number };

/**
 * `delayForService` (D-110) shifts a service's projected calls by the slip its
 * rotation is currently carrying, so the forecast tells the same story as the
 * booking in tick.ts. Optional, and defaulting to no delay, because callers that
 * want the undisrupted timetable — and the determinism tests — must still be
 * able to ask for it.
 */
export function serviceCallSlots(
  afterTick: number,
  horizonTicks: number,
  delayForService: (serviceId: string) => number = () => 0,
): ServiceCallSlot[] {
  const P = SERVICE_CADENCE_TICKS;
  const out: ServiceCallSlot[] = [];
  for (const service of SERVICE_ROSTER) {
    const delay = delayForService(service.id);
    let slot = afterTick - (((afterTick % P) + P) % P) + service.phase;
    while (slot <= afterTick + SERVICE_JITTER) slot += P;
    for (; slot <= afterTick + horizonTicks; slot += P) out.push({ service, slotTick: slot + delay });
  }
  return out.sort((a, b) => a.slotTick - b.slotTick || a.service.id.localeCompare(b.service.id));
}

// ---------------------------------------------------------------------------
// 5. Berth conflicts — rule-based exception detection on existing state.
// (a) wait-breach: projected wait exceeds OPS-BERTH target max anchorage wait.
// (b) deepwater-contention: a neopanamax due while every deep-water berth is
//     projected occupied beyond the target wait (foresight for approaching
//     vessels not yet in the queue; anchored ones are covered by (a)).
// (c) closure: a closed berth while vessels queue.
// No new thresholds — reuses DOCTRINE.berth.targetMaxAnchorageWaitHours.
// ---------------------------------------------------------------------------
export type BerthConflict = {
  id: string;
  kind: "wait-breach" | "deepwater-contention" | "closure";
  message: string;
  entities: EntityRef[];
  // Which existing effect kinds can address it (routes to PlanMove / pipeline).
  actionHint: "reberth-or-divert" | "divert-or-hold" | "advisory";
};

export function berthConflicts(state: SimState): BerthConflict[] {
  const out: BerthConflict[] = [];
  const target = DOCTRINE.berth.targetMaxAnchorageWaitHours;
  const queue = anchorageQueue(state);
  for (const v of queue) {
    const projected = projectedBerthWaitHours(state, v);
    if (projected <= target) continue;
    out.push({
      id: `CONF-wait-${v.id}`,
      kind: "wait-breach",
      message: `${v.name} projected to wait ${projected.toFixed(1)} h at anchorage (target max ${target} h).`,
      entities: [{ entityType: "vessel", entityId: v.id }],
      actionHint: "reberth-or-divert",
    });
  }
  const deepWater = state.berths.filter((b) => b.deepWater && b.status !== "closed");
  const tideLag = ticksUntilTideWindow(state);
  for (const v of state.vessels) {
    if (v.class !== "neopanamax" || v.status !== "approaching") continue;
    if (deepWater.length === 0) continue;
    const minFree = Math.min(...deepWater.map((b) => berthFreeTicks(state, b))) + tideLag;
    const availableAt = state.clock.tick + minFree;
    if (ticksToHours(Math.max(0, availableAt - v.etaTick)) <= target) continue;
    out.push({
      id: `CONF-deep-${v.id}`,
      kind: "deepwater-contention",
      message: `${v.name} (neopanamax) due t${v.etaTick} but no deep-water berth projected free until ~t${availableAt}.`,
      entities: [
        { entityType: "vessel", entityId: v.id },
        ...deepWater.map((b) => ({ entityType: "berth" as const, entityId: b.id })),
      ],
      actionHint: "divert-or-hold",
    });
  }
  for (const b of state.berths) {
    if (b.status !== "closed" || queue.length === 0) continue;
    out.push({
      id: `CONF-closed-${b.id}`,
      kind: "closure",
      message: `${b.id} is closed while ${queue.length} vessel${queue.length === 1 ? "" : "s"} wait at anchorage.`,
      entities: [{ entityType: "berth", entityId: b.id }],
      actionHint: "advisory",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 6. Yard inflow/outflow forecast over a horizon, bucketed.
// Inflow: alongside vessels' undischarged TEU spread over their remaining
// discharge ticks; queued/approaching vessels' manifests spread from their
// projected berth-entry tick. Outflow: gate capacity against the import
// backlog (import = lots without an onward service), plus transshipment lifts
// when each onward service's next call lands (serviceCallSlots).
// Deterministic; assumes no new disruptions. No confidence % (no method exists).
// ---------------------------------------------------------------------------
export type YardFlowBucket = {
  startTick: number;
  endTick: number;
  inflowTEU: number;
  outflowTEU: number;
  projectedUtilPct: number;
};

export function yardFlowForecast(state: SimState, horizonTicks: number, bucketTicks: number): YardFlowBucket[] {
  const now = state.clock.tick;
  const nBuckets = Math.max(1, Math.ceil(horizonTicks / bucketTicks));
  const inflow = new Array<number>(nBuckets).fill(0);
  const outflow = new Array<number>(nBuckets).fill(0);
  const bucketOf = (tick: number): number => Math.floor((tick - now) / bucketTicks);
  const spread = (arr: number[], teu: number, fromTick: number, toTick: number): void => {
    const span = Math.max(1, toTick - fromTick);
    const perTick = teu / span;
    for (let t = Math.max(fromTick, now); t < toTick; t++) {
      const bi = bucketOf(t);
      if (bi < 0 || bi >= nBuckets) continue;
      arr[bi] += perTick;
    }
  };

  // Inflow — alongside: remaining discharge at the berth's actual crane rate.
  for (const v of state.vessels) {
    const total = v.manifest.reduce((s, m) => s + m.quantityTEU, 0);
    if (v.status === "alongside" && v.berthId) {
      const rate = craneUnitsAtBerth(state, v.berthId) * MOVES_PER_CRANE_PER_TICK;
      const remaining = Math.max(0, total - v.dischargedTEU);
      if (remaining <= 0 || rate <= 0) continue;
      spread(inflow, remaining, now, now + Math.ceil(remaining / rate));
    } else if (v.status === "anchored" || v.status === "approaching") {
      const entry =
        v.status === "anchored"
          ? now + hoursToTicks(projectedBerthWaitHours(state, v))
          : Math.max(v.etaTick, now) + hoursToTicks(projectedBerthWaitHours(state, v));
      if (entry - now > horizonTicks) continue;
      const rate = 2 * MOVES_PER_CRANE_PER_TICK; // two STS per berth
      spread(inflow, total, entry, entry + Math.ceil(total / rate));
    }
  }

  // Outflow — gate: capacity applied against the import backlog per bucket.
  let importBacklog = state.cargoLots
    .filter((l) => l.status === "yard" && l.connectingServiceId === undefined)
    .reduce((s, l) => s + l.quantityTEU, 0);
  const gatePerBucket = state.wxOps.rtgSuspended ? 0 : state.gate.processingCapacityPerTick * bucketTicks;
  for (let bi = 0; bi < nBuckets; bi++) {
    const lifted = Math.min(importBacklog, gatePerBucket);
    outflow[bi] += lifted;
    importBacklog -= lifted;
  }
  // Outflow — transshipment: waiting TEU per onward service lifts at that
  // service's next scheduled call within the horizon.
  const waitingByService = new Map<string, number>();
  for (const l of state.cargoLots) {
    if (l.status !== "yard" || l.connectingServiceId === undefined) continue;
    waitingByService.set(l.connectingServiceId, (waitingByService.get(l.connectingServiceId) ?? 0) + l.quantityTEU);
  }
  for (const { service, slotTick } of serviceCallSlots(now, horizonTicks)) {
    const teu = waitingByService.get(service.id);
    if (!teu) continue;
    const bi = bucketOf(slotTick);
    if (bi >= 0 && bi < nBuckets) {
      outflow[bi] += teu;
      waitingByService.delete(service.id); // lifted once within the horizon
    }
  }

  const capacity = state.yardBlocks.reduce((s, b) => s + b.capacityTEU, 0);
  let running = state.yardBlocks.reduce((s, b) => s + yardBlockOccupiedTEU(state, b.id), 0);
  return inflow.map((inf, bi) => {
    running = Math.max(0, running + inf - outflow[bi]);
    return {
      startTick: now + bi * bucketTicks,
      endTick: now + (bi + 1) * bucketTicks,
      inflowTEU: Math.round(inf),
      outflowTEU: Math.round(outflow[bi]),
      projectedUtilPct: capacity === 0 ? 0 : Number(((running / capacity) * 100).toFixed(1)),
    };
  });
}

// ---------------------------------------------------------------------------
// 7. AGV metrics — derived operational resource (per approved policy AGVs are
// NOT simulated entities; the twin's trucks are visuals). Demand comes from
// the terminal move log; sustainable rate from working STS units; transfer
// legs pair each discharging berth with the yard blocks its next item type is
// eligible for (mirroring placeDischarge's filters); route pressure counts
// concurrent legs per finger branch (TRUCK_BRANCHES geometry, read-only).
// Transfer TIME is not computed: no configured AGV speed or movement-duration
// source exists in the sim — surface as "Requires data source" in the UI.
// ---------------------------------------------------------------------------
export type AgvTransferLeg = {
  berthId: string;
  vesselId: string;
  vesselName: string;
  cargoType: CargoLot["type"];
  eligibleBlockIds: string[];
  branchIndex: number; // finger branch in TRUCK_BRANCHES
  distanceUnits: number; // world-units along the truck spine (not metres)
};
export type AgvMetrics = {
  demandMovesPerTick: number;
  sustainableMovesPerTick: number;
  utilisationPct: number | null; // null when nothing sustainable (suspended/no work)
  legs: AgvTransferLeg[];
  branchPressure: { branchIndex: number; legCount: number }[];
  suspended: boolean;
};

const SPINE_Z = 4; // TRUCK_PATH main spine (layout.ts)

function legDistance(berthId: string, blockIds: string[]): number {
  const b = berthLayout(berthId);
  if (blockIds.length === 0) return 0;
  const dists = blockIds.map((id) => {
    const box = yardBlockBox(id);
    return Math.abs(b.z - SPINE_Z) + Math.abs(b.fingerX - box.x) + Math.abs(box.z - SPINE_Z);
  });
  return Math.round(dists.reduce((a, d) => a + d, 0) / dists.length);
}

export function agvMetrics(state: SimState): AgvMetrics {
  const suspended = state.wxOps.rtgSuspended || state.wxOps.stsSuspended;
  const lastMoves = state.terminal.moves[state.terminal.moves.length - 1];
  const demand = lastMoves?.productive ?? 0;
  const workingSts = state.cranes.filter(
    (c) => c.kind === "STS" && c.status === "operational" && !state.wxOps.stsSuspended,
  ).length;
  const sustainable = workingSts * MOVES_PER_CRANE_PER_TICK;
  const legs: AgvTransferLeg[] = [];
  for (const v of state.vessels) {
    if (v.status !== "alongside" || !v.berthId) continue;
    const nextItem = (() => {
      let cumulative = 0;
      for (const item of v.manifest) {
        cumulative += item.quantityTEU;
        if (cumulative > v.dischargedTEU) return item;
      }
      return undefined;
    })();
    if (!nextItem) continue;
    const eligible = state.yardBlocks
      .filter((b) =>
        nextItem.type === "reefer" ? b.reeferPowered : nextItem.type === "hazmat" ? b.hazmat : !b.reeferPowered && !b.hazmat,
      )
      .filter((b) => b.capacityTEU - yardBlockOccupiedTEU(state, b.id) >= nextItem.quantityTEU)
      .map((b) => b.id);
    const n = Number(v.berthId.slice(1));
    legs.push({
      berthId: v.berthId,
      vesselId: v.id,
      vesselName: v.name,
      cargoType: nextItem.type,
      eligibleBlockIds: eligible,
      branchIndex: Math.floor((n - 1) / 3),
      distanceUnits: legDistance(v.berthId, eligible),
    });
  }
  const branchPressure = TRUCK_BRANCHES.map((_, branchIndex) => ({
    branchIndex,
    legCount: legs.filter((l) => l.branchIndex === branchIndex).length,
  }));
  return {
    demandMovesPerTick: demand,
    sustainableMovesPerTick: sustainable,
    utilisationPct: sustainable > 0 ? Math.round((demand / sustainable) * 100) : null,
    legs,
    branchPressure,
    suspended,
  };
}

// ---------------------------------------------------------------------------
// 8. Queue entry forecast — per anchored vessel: projected entry tick (from the
// shared class-aware wait projection) plus the cause tags currently in force,
// each from an existing predicate (no new logic).
// ---------------------------------------------------------------------------
export type QueueCause = "queue-position" | "tide-window" | "weather-suspension" | "pilotage" | "hold";
export type QueueEntryForecast = {
  vessel: Vessel;
  queuePosition: number;
  waitedHours: number;
  expectedRemainingWaitHours: number;
  entryTick: number;
  expectedBerthId?: string;
  causes: QueueCause[];
};

export function queueEntryForecast(state: SimState): QueueEntryForecast[] {
  const queue = anchorageQueue(state);
  return queue.map((v, i) => {
    const remaining = projectedBerthWaitHours(state, v);
    const causes: QueueCause[] = [];
    if (i > 0) causes.push("queue-position");
    if (v.class === "neopanamax" && !state.tide.windowOpen) causes.push("tide-window");
    if (state.wxOps.movesSuspended) causes.push("weather-suspension");
    if (
      state.pilotage.pilotsAvailable < 1 ||
      state.pilotage.tugsAvailable < DOCTRINE.pilotage.tugsPerManoeuvre
    )
      causes.push("pilotage");
    if (v.heldUntilTick !== undefined && state.clock.tick < v.heldUntilTick) causes.push("hold");
    return {
      vessel: v,
      queuePosition: i + 1,
      waitedHours: Number(vesselWaitHours(state, v).toFixed(1)),
      expectedRemainingWaitHours: remaining,
      entryTick: state.clock.tick + hoursToTicks(remaining),
      expectedBerthId: berthOptions(state, v)[0]?.berthId,
      causes,
    };
  });
}

// ---------------------------------------------------------------------------
// 9. Cargo journey trace — joins that EXIST in the data model only. CargoLots
// do not record their discharging vessel, so a vessel's post-discharge trail
// and a lot's origin vessel are honest "unavailable" links.
// ---------------------------------------------------------------------------
export type JourneyStage = {
  id: string;
  label: string;
  state: "complete" | "active" | "pending" | "unavailable";
  detail: string;
};

export function cargoJourney(state: SimState, ref: EntityRef): JourneyStage[] | null {
  if (ref.entityType === "vessel") {
    const v = state.vessels.find((x) => x.id === ref.entityId);
    if (!v) return null;
    const total = v.manifest.reduce((s, m) => s + m.quantityTEU, 0);
    const arrived = v.arrivalTick !== undefined;
    const anchoredNow = v.status === "anchored";
    const berthed = v.berthId !== undefined || v.status === "departing";
    const stages: JourneyStage[] = [
      {
        id: "schedule",
        label: "Scheduled call",
        state: "complete",
        detail: `${v.serviceId} · ETA t${v.etaTick}`,
      },
      {
        id: "arrival",
        label: "Regional arrival",
        state: arrived ? "complete" : v.status === "diverted" ? "unavailable" : "pending",
        detail: arrived ? `arrived t${v.arrivalTick}` : v.status === "diverted" ? "diverted before arrival" : "not yet arrived",
      },
      {
        id: "anchorage",
        label: "Anchorage",
        state: anchoredNow ? "active" : arrived ? "complete" : "pending",
        detail: anchoredNow ? `waiting ${vesselWaitHours(state, v).toFixed(1)} h` : "—",
      },
      {
        id: "berth",
        label: "Berth",
        state: v.status === "alongside" || v.status === "berthing" ? "active" : berthed ? "complete" : "pending",
        detail: v.berthId ?? (v.status === "departing" ? "call complete" : "pending assignment"),
      },
      {
        id: "discharge",
        label: "Discharge",
        state: v.status === "alongside" ? "active" : v.dischargedTEU >= total && total > 0 ? "complete" : "pending",
        detail: `${Math.round(v.dischargedTEU)} / ${total} TEU`,
      },
      {
        id: "yard",
        label: "Yard allocation",
        state: "unavailable",
        detail: "Data link unavailable — yard lots do not record their discharging vessel",
      },
    ];
    return stages;
  }
  if (ref.entityType === "cargoLot") {
    const lot = state.cargoLots.find((l) => l.id === ref.entityId);
    if (!lot) return null;
    const transship = lot.connectingServiceId !== undefined;
    const loading = lot.status === "outbound";
    const stages: JourneyStage[] = [
      {
        id: "origin",
        label: "Origin vessel",
        state: "unavailable",
        detail: "Data link unavailable — lots do not record their discharging vessel",
      },
      {
        id: "yard",
        label: `Yard ${lot.blockId ?? "—"}`,
        state: lot.status === "yard" ? "active" : "complete",
        detail: `dwell ${lotDwellDays(state, lot).toFixed(1)} d · ${lot.quantityTEU} TEU`,
      },
      transship
        ? {
            id: "connection",
            label: "Onward connection",
            state: loading ? "active" : "pending",
            detail: loading
              ? `loading onto ${state.vessels.find((v) => v.id === lot.loadingVesselId)?.name ?? lot.loadingVesselId}`
              : `${lot.connectingServiceId} · cut-off t${lot.connectDeadlineTick}${(lot.connectMissedCount ?? 0) > 0 ? ` · missed ×${lot.connectMissedCount}` : ""}`,
          }
        : {
            id: "gate",
            label: "Gate outflow",
            state: "pending",
            detail: `truck gate · ${state.gate.status}`,
          },
    ];
    return stages;
  }
  return null;
}

// 10. Dwell buckets from doctrine thresholds (no new thresholds), split by priority.
export type DwellBucket = {
  bucket: "normal" | "flagged" | "escalated";
  priority: Priority;
  count: number;
  teu: number;
};

export function dwellBuckets(state: SimState): DwellBucket[] {
  const out = new Map<string, DwellBucket>();
  for (const lot of state.cargoLots) {
    if (lot.status !== "yard") continue;
    const days = lotDwellDays(state, lot);
    const bucket: DwellBucket["bucket"] =
      days > DOCTRINE.cargo.dwellEscalateDays ? "escalated" : days > DOCTRINE.cargo.dwellFlagDays ? "flagged" : "normal";
    const priority: Priority = isHighPriority(state, lot.customerId) ? "high" : "normal";
    const key = `${bucket}:${priority}`;
    const b = out.get(key) ?? { bucket, priority, count: 0, teu: 0 };
    b.count += 1;
    b.teu += lot.quantityTEU;
    out.set(key, b);
  }
  return [...out.values()].sort(
    (a, b) => a.bucket.localeCompare(b.bucket) || a.priority.localeCompare(b.priority),
  );
}

// 11. Yard pressure per cargo category, using the doctrine block lists.
export type YardCategoryPressure = {
  category: "reefer" | "hazmat" | "standard";
  occupiedTEU: number;
  capacityTEU: number;
  pct: number;
};

export function yardCategoryPressure(state: SimState): YardCategoryPressure[] {
  const reeferIds = new Set<string>(DOCTRINE.yard.reeferBlockIds);
  const categoryOf = (blockId: string): YardCategoryPressure["category"] =>
    reeferIds.has(blockId) ? "reefer" : blockId === DOCTRINE.yard.hazmatBlockId ? "hazmat" : "standard";
  const out: Record<YardCategoryPressure["category"], YardCategoryPressure> = {
    reefer: { category: "reefer", occupiedTEU: 0, capacityTEU: 0, pct: 0 },
    hazmat: { category: "hazmat", occupiedTEU: 0, capacityTEU: 0, pct: 0 },
    standard: { category: "standard", occupiedTEU: 0, capacityTEU: 0, pct: 0 },
  };
  for (const b of state.yardBlocks) {
    const c = out[categoryOf(b.id)];
    c.capacityTEU += b.capacityTEU;
    c.occupiedTEU += yardBlockOccupiedTEU(state, b.id);
  }
  for (const c of Object.values(out)) {
    c.occupiedTEU = Math.round(c.occupiedTEU);
    c.pct = c.capacityTEU === 0 ? 0 : Number(((c.occupiedTEU / c.capacityTEU) * 100).toFixed(1));
  }
  return [out.reefer, out.hazmat, out.standard];
}
