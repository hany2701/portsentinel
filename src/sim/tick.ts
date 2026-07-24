import { TICK_SIM_MINUTES, KPI_HISTORY_LENGTH, MOVES_PER_CRANE_PER_TICK, CONNECTION_WINDOW_TICKS, CARGO_STALL_LIMIT, TERMINAL_COMPLETIONS_WINDOW, TERMINAL_MOVE_WINDOW_TICKS } from "./config";
import { DOCTRINE, weatherRiskBand } from "./doctrine";
import { randInt, randRange } from "./rng";
import { stepWeather } from "./weather";
import { stepWxOps } from "./wxOps";
import { stepPilotage } from "./pilotage";
import { handOverToRegional, isHandoverTick, stepMaritime } from "./maritimeStep";
import { stepMarineEnvironment } from "./marineFeeds";
import { syncCalibrationMode } from "./calibration";
import { addAlert, escalateStaleCriticals } from "./alerts";
import { computeKpis } from "./resilience";
import { refreshSafetyStockRecs } from "./recLifecycle";
import { validateEffect } from "./validators";
import {
  anchorageQueue,
  atRiskByService,
  craneUnitsAtBerth,
  vesselWaitHours,
  yardBlockOccupiedTEU,
  yardBlockUtilisationPct,
} from "./derive";
import { containerCount, generateManifest, makeSizeMix } from "./voyage";
import { nextServiceSlot, serviceById, SERVICE_CADENCE_TICKS } from "./roster";
import { serviceDelayTicks } from "../maritime/serviceDelay";
import type {
  CargoManifestItem,
  Disruption,
  SimState,
  Vessel,
} from "./types";

function nextId(state: SimState, prefix: string): string {
  return `${prefix}-${state.seq++}`;
}

function isActive(state: SimState, d: Disruption): boolean {
  return state.clock.tick >= d.startTick && state.clock.tick < d.startTick + d.durationTicks;
}

function applyDisruptions(state: SimState): void {
  for (const d of state.disruptions) {
    const active = isActive(state, d);
    const ending = state.clock.tick === d.startTick + d.durationTicks;
    if (d.type === "craneFailure") {
      for (const cid of d.targetIds) {
        const crane = state.cranes.find((c) => c.id === cid);
        if (!crane) continue;
        if (active) {
          crane.status = d.severity === 1 ? "degraded" : "down";
          crane.downUntilTick = d.startTick + d.durationTicks;
        } else if (ending) {
          crane.status = "operational";
          crane.downUntilTick = undefined;
        }
      }
    } else if (d.type === "berthClosure") {
      for (const bid of d.targetIds) {
        const berth = state.berths.find((b) => b.id === bid);
        if (!berth) continue;
        if (active && berth.status === "available") berth.status = "closed";
        else if (ending && berth.status === "closed") berth.status = "available";
      }
    } else if (d.type === "arrivalSurge" && state.clock.tick === d.startTick) {
      const approaching = state.vessels.filter((v) => v.status === "approaching");
      for (const v of approaching.slice(0, 3 + d.severity)) {
        v.etaTick = state.clock.tick + randInt(state.rng, 0, 3);
      }
    }
  }
}

function moveVessels(state: SimState): void {
  // W3 (D-54): low visibility suspends arrivals. The critical band alone does
  // NOT block anchoring — anchoring is the safe move (owner ruling, W5).
  // REAL-5 (D-83): haze (NEA PSI) is a second visibility input alongside the
  // weather feed — either one can be the one that's actually below minimum.
  const arrivalsBlocked =
    state.wxOps.movesSuspended && Math.min(state.weather.visibilityKm, state.haze.visibilityKm) < DOCTRINE.weather.visMinKm;
  for (const v of state.vessels) {
    // GR-3: one movement owner per vessel per tick. A vessel that crossed frames
    // this tick is pinned at the D-62 entry anchor and belongs to neither
    // engine; the Tuas FSM picks it up from the next tick.
    if (isHandoverTick(state, v.id)) continue;
    if (v.status === "approaching" && state.clock.tick >= v.etaTick && !arrivalsBlocked) {
      v.status = "anchored";
      v.anchoredSinceTick = state.clock.tick;
      v.arrivalTick = state.clock.tick; // REAL-3 (D-81): reached the port
    } else if (v.status === "berthing" && v.phaseEndsTick !== undefined && state.clock.tick >= v.phaseEndsTick) {
      v.status = "alongside";
      v.phaseEndsTick = undefined;
    } else if (v.status === "departing" && v.phaseEndsTick !== undefined && state.clock.tick >= v.phaseEndsTick) {
      recycleVessel(state, v);
    } else if (v.status === "diverted" && v.phaseEndsTick !== undefined && state.clock.tick >= v.phaseEndsTick) {
      recycleVessel(state, v);
    }
  }
  assignBerths(state);
}

function recycleVessel(state: SimState, v: Vessel): void {
  // GR-3: a tracked maritime vessel does not re-book a Tuas service slot — it
  // resumes its geographic route from the approved exit node, keeping its id,
  // route-version lineage and operational history. Only the 22 frozen Tuas
  // vessels recycle through the weekly roster below.
  if (v.scope !== undefined) {
    const berth = state.berths.find((b) => b.id === v.berthId);
    if (berth && berth.vesselId === v.id) {
      berth.status = "available";
      berth.vesselId = undefined;
    }
    v.berthId = undefined;
    v.anchoredSinceTick = undefined;
    v.phaseEndsTick = undefined;
    v.heldUntilTick = undefined;
    v.divertToPortId = undefined;
    v.arrivalTick = undefined;
    v.berthedTick = undefined;
    v.manifest = [];
    v.dischargedTEU = 0;
    v.loadTEU = 0;
    v.loadTarget = undefined;
    v.loadedTEU = undefined;
    v.workProgress = 0;
    handOverToRegional(state, v);
    return;
  }

  // REAL-1 (D-79): the same ship runs the same weekly loop — its class and
  // service stay fixed; re-book onto the service's next scheduled slot instead
  // of a uniform random ETA, so congestion emerges from schedule clustering.
  const service = serviceById(v.serviceId)!;
  v.status = "approaching";
  // D-110: a disruption anywhere on this service's rotation slips its next call.
  // Without this the baseline fleet booked its slot straight off the timetable
  // and arrived exactly on time however bad the weather was at Hormuz or Suez —
  // so a remote disruption provably could not change Tuas traffic. The slip is a
  // PROPORTION of the cadence, not raw hours (see serviceDelay.ts), and reads
  // pure state, so determinism is untouched: no rng is drawn here.
  v.etaTick =
    nextServiceSlot(state.rng, service, state.clock.tick) + serviceDelayTicks(state, v.serviceId);
  v.manifest = generateManifest(state.rng, () => nextId(state, "MF"), state.customers, v.class, v.serviceId);
  const manifestTotal = v.manifest.reduce((s, m) => s + m.quantityTEU, 0);
  v.dischargedTEU = 0;
  v.loadTEU = Math.round(manifestTotal * randRange(state.rng, 1.0, 1.3)); // load capacity >= discharge (D-80)
  v.workProgress = 0;
  v.loadTarget = undefined; // REAL-2: loading phase reset for the new voyage
  v.loadedTEU = undefined;
  v.berthId = undefined;
  v.anchoredSinceTick = undefined;
  v.divertToPortId = undefined;
  v.phaseEndsTick = undefined;
  v.heldUntilTick = undefined;
  v.arrivalTick = undefined; // REAL-3: stamps belong to the completed call
  v.berthedTick = undefined;
}

function assignBerths(state: SimState): void {
  // W3/W5 (D-54): no berth assignment while vessel moves are suspended.
  if (state.wxOps.movesSuspended) return;
  // W4 (D-54): in the severe band, feeders skip berthing moves.
  const severe = weatherRiskBand(state.weather.riskIndex).id === "severe";
  const queue = anchorageQueue(state);
  let qi = 0;
  for (const berth of state.berths) {
    if (berth.status !== "available") continue;
    while (qi < queue.length) {
      const v = queue[qi++];
      if (v.class === "neopanamax" && !berth.deepWater) continue;
      // REAL-5 (D-83): neopanamax needs sufficient water under keel — wait for
      // the tide window rather than berthing on a low tide (OPS-TIDE §1).
      if (v.class === "neopanamax" && !state.tide.windowOpen) continue;
      if (severe && v.class === "feeder") continue;
      // D-58 condition 3: an approved hold is the earliest possible release —
      // the vessel may not berth before heldUntilTick.
      if (v.heldUntilTick !== undefined && state.clock.tick < v.heldUntilTick) continue;
      berth.status = "occupied";
      berth.vesselId = v.id;
      v.berthId = berth.id;
      v.status = "berthing";
      v.anchoredSinceTick = undefined;
      v.berthedTick = state.clock.tick; // REAL-3 (D-81): berth-on-arrival if == arrivalTick
      v.phaseEndsTick = state.clock.tick + randInt(state.rng, 1, 2);
      break;
    }
  }
}

function placeDischarge(state: SimState, item: CargoManifestItem): boolean {
  const candidate = state.yardBlocks
    .filter((b) => (item.type === "reefer" ? b.reeferPowered : item.type === "hazmat" ? b.hazmat : !b.reeferPowered && !b.hazmat))
    .filter((b) => b.capacityTEU - yardBlockOccupiedTEU(state, b.id) >= item.quantityTEU)
    .sort((a, b) => yardBlockUtilisationPct(state, a.id) - yardBlockUtilisationPct(state, b.id))[0];
  if (!candidate) return false;
  const mix = makeSizeMix(state.rng, item.quantityTEU);
  // REAL-2 (D-80): a discharged transshipment box inherits its onward service and
  // gets a connection deadline; it now waits in the yard for that service's call
  // (never the gate). Import boxes (no connectingServiceId) still leave via the gate.
  const transship = item.connectingServiceId !== undefined;
  state.cargoLots.push({
    id: nextId(state, "LOT"), quantityTEU: item.quantityTEU, containerCount: containerCount(mix), sizeMix: mix,
    blockId: candidate.id, slotRegion: `${candidate.id}-in`, type: item.type, status: "yard",
    arrivalTick: state.clock.tick, customerId: item.customerId, priority: item.priority,
    dwellStartTick: state.clock.tick,
    connectingServiceId: item.connectingServiceId,
    connectDeadlineTick: transship ? state.clock.tick + CONNECTION_WINDOW_TICKS : undefined,
    connectMissedCount: transship ? 0 : undefined,
  });
  return true;
}

// REAL-2 (D-80): when a vessel finishes discharge it claims the onward boxes
// waiting for its own service — earliest deadline first (protect the connections
// closest to missing) — up to its load capacity. Claimed lots become "outbound"
// (still occupying the yard) and are lifted when loading completes. Returns the
// claimed TEU (the loadTarget for this call).
function claimOnwardLots(state: SimState, v: Vessel): number {
  const waiting = state.cargoLots
    .filter((l) => l.status === "yard" && l.connectingServiceId === v.serviceId)
    .sort((a, b) => (a.connectDeadlineTick ?? 0) - (b.connectDeadlineTick ?? 0));
  let claimed = 0;
  for (const lot of waiting) {
    if (claimed > 0 && claimed + lot.quantityTEU > v.loadTEU) break;
    lot.status = "outbound";
    lot.loadingVesselId = v.id;
    claimed += lot.quantityTEU;
  }
  return claimed;
}

// REAL-2 (D-80): as loading progresses, release the claimed lots the vessel has
// already lifted (earliest deadline first) so their yard space frees DURING the
// call — this is what lets a discharge stalled by a full yard recover.
function releaseLoadedLots(state: SimState, v: Vessel): { moves: number; rehandles: number } {
  const claimed = state.cargoLots
    .filter((l) => l.loadingVesselId === v.id)
    .sort((a, b) => (a.connectDeadlineTick ?? 0) - (b.connectDeadlineTick ?? 0));
  let remaining = claimed.reduce((s, l) => s + l.quantityTEU, 0);
  const stillToLoad = (v.loadTarget ?? 0) - (v.loadedTEU ?? 0);
  const remove = new Set<string>();
  let moves = 0, rehandles = 0;
  for (const lot of claimed) {
    if (remaining - lot.quantityTEU < stillToLoad) break; // keep enough to cover the unloaded portion
    remaining -= lot.quantityTEU;
    remove.add(lot.id);
    // REAL-3 (D-81): each lifted lot is a productive move; retrieving from a dense
    // block also incurs unproductive rehandles (digging boxes out), rising with util.
    moves += lot.containerCount;
    const util = lot.blockId ? yardBlockUtilisationPct(state, lot.blockId) / 100 : 0;
    rehandles += Math.round(lot.containerCount * Math.max(0, util - 0.5) * 0.5);
  }
  if (remove.size > 0) state.cargoLots = state.cargoLots.filter((l) => !remove.has(l.id));
  return { moves, rehandles };
}

function workCargo(state: SimState): void {
  // W1/W5 (D-54): STS suspension now lives in the wxOps state machine (with
  // staged recovery) instead of a raw per-tick gust check.
  const stsSuspended = state.wxOps.stsSuspended;
  // REAL-3 (D-81): container-move tallies for this tick, feeding the gross crane
  // rate and rehandle ratio.
  let tickProductive = 0, tickRehandle = 0, tickCraneTicks = 0;
  for (const v of state.vessels) {
    if (v.status !== "alongside" || !v.berthId) continue;
    const units = craneUnitsAtBerth(state, v.berthId);
    const total = v.manifest.reduce((s, m) => s + m.quantityTEU, 0);
    const dischargedBefore = v.dischargedTEU;
    let vesselMoves = 0, vesselRehandles = 0;
    if (total === 0) {
      v.workProgress = 1;
    } else if (!stsSuspended) {
      v.workProgress = Math.min(1, v.workProgress + (units * MOVES_PER_CRANE_PER_TICK) / total);
    }
    // Discharge manifest items in order up to the current work fraction, stalling if
    // the yard is full — or if RTGs are weather-suspended (W2: discharge cannot place lots).
    let cumulative = 0;
    for (const item of v.manifest) {
      const start = cumulative;
      cumulative += item.quantityTEU;
      if (start < v.dischargedTEU) continue; // already discharged
      if (cumulative > v.workProgress * total + 0.5) break; // not reached yet
      if (!state.wxOps.rtgSuspended && placeDischarge(state, item)) {
        v.dischargedTEU = cumulative;
        vesselMoves += item.containerCount; // REAL-3: discharged containers are moves
      } else {
        v.workProgress = Math.min(v.workProgress, total === 0 ? 1 : start / total);
        break;
      }
    }

    // REAL-2 (D-80): loading runs CONCURRENTLY with discharge (dual-cycling). The
    // onward boxes are claimed on the first alongside tick and lifted at crane
    // rate, freeing their yard space as they go — so loading never waits on a
    // stalled discharge, and a full yard recovers instead of deadlocking.
    if (v.loadTarget === undefined) {
      v.loadTarget = claimOnwardLots(state, v);
      v.loadedTEU = 0;
    }
    if (v.loadTarget > 0 && !stsSuspended && !state.wxOps.rtgSuspended) {
      v.loadedTEU = Math.min(v.loadTarget, (v.loadedTEU ?? 0) + units * MOVES_PER_CRANE_PER_TICK);
      const lifted = releaseLoadedLots(state, v);
      vesselMoves += lifted.moves;
      vesselRehandles += lifted.rehandles;
    }
    // REAL-3 (D-81): a working crane-tick only counts when moves actually happened.
    if (vesselMoves > 0) tickCraneTicks += units;
    tickProductive += vesselMoves;
    tickRehandle += vesselRehandles;

    const dischargeDone = v.workProgress >= 1 && v.dischargedTEU >= total - 0.5;
    const loadDone = (v.loadedTEU ?? 0) >= (v.loadTarget ?? 0);

    // Liveness (D-80): loading is done but discharge is wedged by a full yard
    // while cranes are working — count the stall, and after CARGO_STALL_LIMIT cut
    // the call short (sail with the undischarged remainder) so the berth frees.
    const cranesFree = !stsSuspended && !state.wxOps.rtgSuspended;
    if (!dischargeDone && loadDone && cranesFree && v.dischargedTEU === dischargedBefore) {
      v.stallTicks = (v.stallTicks ?? 0) + 1;
    } else {
      v.stallTicks = 0;
    }
    const shortCall = (v.stallTicks ?? 0) >= CARGO_STALL_LIMIT;

    if ((dischargeDone && loadDone) || shortCall) {
      if (shortCall) v.dischargedTEU = total; // remainder carried onward
      state.cargoLots = state.cargoLots.filter((l) => l.loadingVesselId !== v.id); // lift claimed load
      const berth = state.berths.find((b) => b.id === v.berthId);
      if (berth) {
        berth.status = "available";
        berth.vesselId = undefined;
      }
      v.berthId = undefined;
      v.status = "departing";
      v.stallTicks = 0;
      v.phaseEndsTick = state.clock.tick + randInt(state.rng, 1, 2);
      // REAL-3 (D-81): record the completed call for turnaround + berth-on-arrival
      // (skip genesis-warmup vessels that have no arrival stamp).
      if (v.arrivalTick !== undefined) {
        state.terminal.completions.push({
          turnaroundTicks: state.clock.tick - v.arrivalTick,
          berthOnArrival: v.berthedTick === v.arrivalTick,
        });
        if (state.terminal.completions.length > TERMINAL_COMPLETIONS_WINDOW) state.terminal.completions.shift();
      }
    }
  }

  // REAL-3 (D-81): log this tick's move activity for the gross-rate + rehandle window.
  state.terminal.moves.push({ productive: tickProductive, rehandle: tickRehandle, craneTicks: tickCraneTicks });
  if (state.terminal.moves.length > TERMINAL_MOVE_WINDOW_TICKS) state.terminal.moves.shift();
}

// REAL-2 (D-80): connection lifecycle upkeep. A waiting transshipment box whose
// deadline passes without being lifted has MISSED its connection — it re-books
// onto the onward service's next weekly call (deadline += cadence) and raises a
// critical alert once per miss (addAlert dedups the repeats).
function stepConnections(state: SimState): void {
  for (const lot of state.cargoLots) {
    if (lot.status !== "yard" || lot.connectingServiceId === undefined || lot.connectDeadlineTick === undefined) continue;
    if (state.clock.tick > lot.connectDeadlineTick) {
      lot.connectMissedCount = (lot.connectMissedCount ?? 0) + 1;
      lot.connectDeadlineTick += SERVICE_CADENCE_TICKS;
      const svc = serviceById(lot.connectingServiceId);
      addAlert(
        state,
        "critical",
        `Missed transshipment connection to ${svc ? svc.name : lot.connectingServiceId} — ${lot.quantityTEU} TEU re-booked to the next weekly call.`,
        { entityType: "cargoLot", entityId: lot.id },
      );
    }
  }
}

function stepYardAndGate(state: SimState): void {
  // W2 (D-54): suspended RTGs stop all yard-to-gate outflow.
  let toRemove = state.wxOps.rtgSuspended ? 0 : state.gate.processingCapacityPerTick;
  // REAL-2 (D-80): the truck gate only handles IMPORT cargo. Transshipment lots
  // (connectingServiceId set) never leave via the gate — they wait to be loaded
  // onto their onward service's vessel.
  const yardLots = state.cargoLots
    .filter((l) => l.status === "yard" && l.connectingServiceId === undefined)
    .sort((a, b) => a.arrivalTick - b.arrivalTick);
  for (const lot of yardLots) {
    if (toRemove <= 0) break;
    const take = Math.min(lot.quantityTEU, toRemove);
    lot.quantityTEU -= take;
    toRemove -= take;
    if (lot.quantityTEU <= 0) lot.status = "delivered";
    else {
      const mix = makeSizeMix(state.rng, lot.quantityTEU);
      lot.containerCount = containerCount(mix);
      lot.sizeMix = mix;
    }
  }
  state.cargoLots = state.cargoLots.filter((l) => l.status !== "delivered");

  // While outflow is stopped the truck queue only builds — this is the
  // GateState cascade the twin's truck density mirrors (D-58/D-38).
  const drift = state.wxOps.rtgSuspended ? randInt(state.rng, 0, 5) : randInt(state.rng, -4, 5);
  const q = Math.max(0, state.gate.queuedTrucks + drift);
  state.gate.queuedTrucks = q;
  state.gate.averageWaitMinutes = Math.max(5, Math.round(8 + q * 0.6));
  state.gate.status = q < 30 ? "normal" : q < 60 ? "busy" : "congested";
}

function evaluateAlerts(state: SimState): void {
  for (const block of state.yardBlocks) {
    if (yardBlockUtilisationPct(state, block.id) > DOCTRINE.yard.criticalPct) {
      addAlert(state, "critical", `Yard ${block.id} above ${DOCTRINE.yard.criticalPct}% — stop inbound allocation.`, { entityType: "yardBlock", entityId: block.id });
    }
  }
  // Weather suspension/resumption alerts are transition-driven in stepWxOps
  // (D-53/D-54) — the old per-tick gust + critical-band alerts lived here.
  const worst = anchorageQueue(state)[0];
  if (worst && vesselWaitHours(state, worst) > DOCTRINE.berth.targetMaxAnchorageWaitHours) {
    addAlert(state, "warning", `${worst.name} has waited over ${DOCTRINE.berth.targetMaxAnchorageWaitHours} h at anchorage.`, { entityType: "vessel", entityId: worst.id });
  }
  // REAL-2 (D-80): transshipment connections nearing their deadline un-lifted —
  // one warning per onward service (soonest deadline first).
  for (const g of atRiskByService(state).slice(0, 3)) {
    addAlert(state, "warning", `${g.count} transshipment connection${g.count > 1 ? "s" : ""} to ${g.serviceName} at risk — ${g.teu} TEU awaiting the onward call (OPS-TRANS §1).`, { entityType: "cargoLot", entityId: g.serviceId });
  }
  escalateStaleCriticals(state); // D-77: ignored criticals demand attention once
}

// D-85 (AIF-1): the automatic rule engine was removed — the AI agent
// (propose_action) and the duty manager (Plan move / panel actions) are the
// only proposers. This stage keeps two source-agnostic guarantees for every
// pending rec: D-56 freshness (safety-stock quantities track the live
// shortfall) and displayed = executed (re-validation against the new state).
function refreshPendingRecommendations(state: SimState): void {
  refreshSafetyStockRecs(state);
  for (const rec of state.recommendations) {
    if (rec.status !== "pending") continue;
    const validation = validateEffect(state, rec.proposedEffect);
    rec.validationStatus = validation.status;
    rec.validatedEffect = validation.status === "valid" ? rec.proposedEffect : undefined;
    rec.validationMessage = validation.message;
  }
}

function snapshotKpis(state: SimState): void {
  state.kpiHistory.push(computeKpis(state));
  if (state.kpiHistory.length > KPI_HISTORY_LENGTH) {
    state.kpiHistory.splice(0, state.kpiHistory.length - KPI_HISTORY_LENGTH);
  }
}

/**
 * Advances the simulation by one deterministic tick. Pure: clones the input and
 * returns a new state, so the caller's state is never mutated (enables what-if
 * previews later, per D-50).
 */
export function tick(prev: SimState): SimState {
  // REAL-6 (D-84): self-heal the global DOCTRINE/roster regime from the
  // state's OWN calibrationMode before anything else — makes tick() a pure
  // function of state again despite DOCTRINE being a mutable module-level
  // singleton (a resumed session or a preview branch can never see a stale
  // mode left over from whatever ran last).
  syncCalibrationMode(prev.calibrationMode);
  const state: SimState = structuredClone(prev);
  state.clock.tick += 1;                                   // 1. clock
  state.clock.simMinutes += TICK_SIM_MINUTES;
  applyDisruptions(state);                                 // 2. disruptions
  stepWeather(state);                                      // 3. weather
  stepMarineEnvironment(state);                             // 3a. lightning/haze/tide (D-83)
  stepWxOps(state);                                        // 3b. weather→ops state machine (D-54)
  stepPilotage(state);                                     // 3c. pilot/tug resource contention (D-82)
  stepMaritime(state);                                     // 3d. geographic movement + frame handover (GR-3)
  moveVessels(state);                                      // 4. vessel movement + berth assignment
  workCargo(state);                                        // 5. cargo operations
  stepConnections(state);                                  // 5b. transshipment connection lifecycle (D-80)
  stepYardAndGate(state);                                  // 6. yard & gate (import outflow)
  evaluateAlerts(state);                                   // 7. alerts
  refreshPendingRecommendations(state);                    // 8. pending-rec freshness + re-validation (D-85)
  snapshotKpis(state);                                     // 9. KPI snapshot
  return state;
}

export function clone(state: SimState): SimState {
  return structuredClone(state);
}
