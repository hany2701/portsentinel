import { yardBlockOccupiedTEU } from "./derive";
import { DOCTRINE } from "./doctrine";
import type { SimState } from "./types";

/**
 * Throws if any structural invariant is violated. Run after every tick and
 * after every effect execution. Cheap enough to run in dev and tests.
 */
export function assertInvariants(state: SimState): void {
  const fail = (msg: string): never => {
    throw new Error(`Invariant violated @tick ${state.clock.tick}: ${msg}`);
  };

  // Berths
  let alongsideOrBerthing = 0;
  for (const berth of state.berths) {
    if (berth.status === "occupied") {
      if (!berth.vesselId) fail(`berth ${berth.id} occupied with no vessel`);
      const v = state.vessels.find((x) => x.id === berth.vesselId);
      if (!v) fail(`berth ${berth.id} references missing vessel`);
      else if (v.berthId !== berth.id) fail(`berth ${berth.id} / vessel ${v.id} berthId mismatch`);
    }
    if (berth.status === "closed" && berth.vesselId) fail(`closed berth ${berth.id} holds a vessel`);
  }
  const berthVesselIds = state.berths.filter((b) => b.vesselId).map((b) => b.vesselId);
  if (new Set(berthVesselIds).size !== berthVesselIds.length) fail("a vessel occupies more than one berth");

  // Vessels
  for (const v of state.vessels) {
    if (v.berthId) {
      const berth = state.berths.find((b) => b.id === v.berthId);
      if (!berth || berth.vesselId !== v.id) fail(`vessel ${v.id} claims berth ${v.berthId} inconsistently`);
    }
    if (v.status === "diverted" && v.berthId) fail(`diverted vessel ${v.id} still holds a berth`);
    if (v.status === "anchored" && v.anchoredSinceTick === undefined) fail(`anchored vessel ${v.id} has no wait start`);
    if ((v.status === "alongside" || v.status === "berthing") && !v.berthId) fail(`${v.status} vessel ${v.id} has no berth`);
    if (v.dischargedTEU > v.manifest.reduce((s, m) => s + m.quantityTEU, 0) + 0.5)
      fail(`vessel ${v.id} discharged more than its manifest`);
  }
  if (state.vessels.filter((v) => v.status === "alongside" || v.status === "berthing").length > state.berths.length)
    fail("more berth-occupying vessels than berths");
  alongsideOrBerthing = state.berths.filter((b) => b.status === "occupied").length;
  if (alongsideOrBerthing > 12) fail(`${alongsideOrBerthing} berths occupied (max 12)`);

  // Yard
  for (const block of state.yardBlocks) {
    const used = yardBlockOccupiedTEU(state, block.id);
    if (used > block.capacityTEU + 0.5) fail(`yard ${block.id} over capacity (${used}/${block.capacityTEU})`);
  }
  for (const lot of state.cargoLots) {
    if (lot.status === "yard" && !lot.blockId) fail(`yard lot ${lot.id} has no block`);
    if (lot.quantityTEU < 0) fail(`lot ${lot.id} has negative TEU`);
  }

  // Weather
  if (state.weather.asOfTick > state.clock.tick) fail("weather asOfTick is in the future");

  // Marine environment (REAL-5, D-83)
  const { meanM, amplitudeM } = DOCTRINE.tide;
  if (Math.abs(state.tide.heightM - meanM) > amplitudeM + 0.01) fail(`tide height ${state.tide.heightM} outside the curve's amplitude`);
  if (state.haze.visibilityKm < DOCTRINE.haze.minVisibilityKm - 0.01 || state.haze.visibilityKm > 12) fail(`haze visibility ${state.haze.visibilityKm} out of range`);

  // Pilotage & towage pool (REAL-4, D-82): free + booked must always equal the pool.
  const bookedPilots = state.pilotage.bookings.length;
  const bookedTugs = bookedPilots * DOCTRINE.pilotage.tugsPerManoeuvre;
  if (state.pilotage.pilotsAvailable < 0 || state.pilotage.tugsAvailable < 0) fail("pilotage pool went negative");
  if (state.pilotage.pilotsAvailable + bookedPilots !== DOCTRINE.pilotage.pilotPoolSize)
    fail(`pilot pool mismatch: ${state.pilotage.pilotsAvailable} free + ${bookedPilots} booked != ${DOCTRINE.pilotage.pilotPoolSize}`);
  if (state.pilotage.tugsAvailable + bookedTugs !== DOCTRINE.pilotage.tugPoolSize)
    fail(`tug pool mismatch: ${state.pilotage.tugsAvailable} free + ${bookedTugs} booked != ${DOCTRINE.pilotage.tugPoolSize}`);

  // Maritime (GR-1). The two coordinate frames must not blur: a vessel is
  // either sailing a geographic route or inside the Tuas FSM, never both.
  const planById = new Map(state.maritime.routePlans.map((p) => [p.id, p]));
  const activePlanCount = new Map<string, number>();
  for (const plan of state.maritime.routePlans) {
    if (plan.status !== "active") continue;
    const seen = (activePlanCount.get(plan.vesselId) ?? 0) + 1;
    activePlanCount.set(plan.vesselId, seen);
    if (seen > 1) fail(`vessel ${plan.vesselId} has ${seen} active route plans`);
    if (!state.vessels.some((v) => v.id === plan.vesselId))
      fail(`route plan ${plan.id} references missing vessel ${plan.vesselId}`);
  }
  for (const v of state.vessels) {
    if (v.status === "enroute" && v.berthId) fail(`enroute vessel ${v.id} still holds a berth`);
    if (!v.track) continue;
    const plan = planById.get(v.track.routePlanId);
    if (!plan) fail(`vessel ${v.id} tracks missing route plan ${v.track.routePlanId}`);
    else if (plan.status === "active" && v.track.edgeIndex >= plan.nodeIds.length)
      fail(`vessel ${v.id} edgeIndex ${v.track.edgeIndex} is past the end of plan ${plan.id}`);
    if (v.track.progressNm < 0) fail(`vessel ${v.id} has negative route progress`);
  }
  // At most one handover in flight per vessel — the frame crossing is a single
  // event, and a second one would mean two engines could claim the vessel.
  const openHandovers = new Map<string, number>();
  for (const h of state.maritime.handovers) {
    if (h.status === "completed") continue;
    const seen = (openHandovers.get(h.vesselId) ?? 0) + 1;
    openHandovers.set(h.vesselId, seen);
    if (seen > 1) fail(`vessel ${h.vesselId} has ${seen} open handovers`);
  }
}
