import { randInt } from "./rng";
import { TICK_SIM_MINUTES } from "./config";
import type { CalibrationMode, Rng, VesselClass } from "./types";

// REAL-1 (D-79): vessels arrive on fixed weekly service loops, not at random.
// Each service calls on a set slot within the cadence period; the same vessel
// re-books onto its service's next slot after it departs (see recycleVessel).
// Congestion/bunching EMERGES because several services share a nearby phase.

// Compressed demo cadence standing in for a real 7-day weekly loop. Tuned to
// keep the 12-berth port busy at 22 vessels (mean away-time ~=
// SERVICE_CADENCE_TICKS / 2) while the clustered phases below drive visible
// arrival peaks.
export const DEMO_SERVICE_CADENCE_TICKS = 40;
// REAL-6 (D-84): the real 7-day weekly loop, on the same compressed clock —
// switching to it (production calibration mode) is a data change, not a code
// change (the promise the CALIBRATION record made in D-78, now live).
export const PRODUCTION_SERVICE_CADENCE_TICKS = Math.round((7 * 24 * 60) / TICK_SIM_MINUTES);
export let SERVICE_CADENCE_TICKS = DEMO_SERVICE_CADENCE_TICKS;
// Seeded arrival jitter (+/- ticks) so bookings are not robotically exact.
export const SERVICE_JITTER = 3;

export type Service = {
  id: string;
  name: string;
  class: VesselClass;
  // Slot within the cadence period [0, SERVICE_CADENCE_TICKS) this service calls
  // on, derived from phaseFraction so the period is the single tuning knob.
  phase: number;
  cadenceNote: string;
  rotationNote: string;
};

// Fictional Tuas roster: transshipment mix weighted to intra-Asia feeders with
// regional panamax and mainline east-west neopanamax loops. Phase fractions form
// three clusters (~10-20%, ~45-55%, ~75-85% of the period) with gaps between —
// the gaps are the source of the arrival bunching.
const ROSTER_SEED: readonly (Omit<Service, "phase"> & { phaseFraction: number })[] = [
  // Cluster 1 (~10-20%)
  { id: "SVC-STX", name: "Straits Express", class: "feeder", phaseFraction: 0.10, cadenceNote: "Weekly", rotationNote: "Singapore – Port Klang – Penang" },
  { id: "SVC-RIAU", name: "Riau Connector", class: "feeder", phaseFraction: 0.15, cadenceNote: "Weekly", rotationNote: "Singapore – Batam – Bintan" },
  { id: "SVC-AE7", name: "Asia–Europe AE7", class: "neopanamax", phaseFraction: 0.20, cadenceNote: "Weekly", rotationNote: "Singapore – Rotterdam – Hamburg" },
  // Cluster 2 (~45-55%)
  { id: "SVC-MEK", name: "Mekong Link", class: "feeder", phaseFraction: 0.45, cadenceNote: "Weekly", rotationNote: "Singapore – Ho Chi Minh – Bangkok" },
  { id: "SVC-BOB", name: "Bay of Bengal Service", class: "panamax", phaseFraction: 0.50, cadenceNote: "Weekly", rotationNote: "Singapore – Chennai – Colombo" },
  { id: "SVC-NAS", name: "North Asia Shuttle", class: "panamax", phaseFraction: 0.55, cadenceNote: "Weekly", rotationNote: "Singapore – Hong Kong – Kaohsiung" },
  // Cluster 3 (~75-85%)
  { id: "SVC-JAVA", name: "Java Loop", class: "feeder", phaseFraction: 0.75, cadenceNote: "Weekly", rotationNote: "Singapore – Jakarta – Surabaya" },
  { id: "SVC-GULF", name: "Gulf Passage", class: "panamax", phaseFraction: 0.80, cadenceNote: "Weekly", rotationNote: "Singapore – Jebel Ali" },
  { id: "SVC-TP3", name: "Transpacific TP3", class: "neopanamax", phaseFraction: 0.85, cadenceNote: "Weekly", rotationNote: "Singapore – Los Angeles – Long Beach" },
];

function buildRoster(cadenceTicks: number): Service[] {
  return ROSTER_SEED.map(({ phaseFraction, ...s }) => ({
    ...s,
    phase: Math.round(phaseFraction * cadenceTicks),
  }));
}

export let SERVICE_ROSTER: readonly Service[] = buildRoster(SERVICE_CADENCE_TICKS);

// REAL-6 (D-84): swap the cadence (and re-derive every service's phase tick
// from it) between demo and production. nextServiceSlot below reads
// SERVICE_CADENCE_TICKS live, so only FUTURE bookings pick up the new cadence
// — an already-scheduled vessel's etaTick is not retroactively rescheduled.
export function setServiceCadence(mode: CalibrationMode): void {
  SERVICE_CADENCE_TICKS = mode === "production" ? PRODUCTION_SERVICE_CADENCE_TICKS : DEMO_SERVICE_CADENCE_TICKS;
  SERVICE_ROSTER = buildRoster(SERVICE_CADENCE_TICKS);
}

// Inter-port lanes (maritime COR-TPX / COR-SGN). These never call at Tuas, so
// they are deliberately OUTSIDE SERVICE_ROSTER: that roster drives Tuas berth
// scheduling, arrival forecasting and the genesis vessel draw, and a service
// that never arrives must not book a berth or expect a Tuas hull. `phase` is
// unused for them and stays 0 — nothing schedules an inter-port call.
export const INTERPORT_SERVICES: readonly Service[] = [
  { id: "SVC-TPX", name: "Transpacific TPX", class: "neopanamax", phase: 0, cadenceNote: "Weekly", rotationNote: "Hong Kong – Los Angeles – Long Beach" },
  { id: "SVC-SGN", name: "Saigon–Hong Kong Feeder", class: "feeder", phase: 0, cadenceNote: "Weekly", rotationNote: "Ho Chi Minh City – Hong Kong" },
];

// Looks up Tuas services AND inter-port lanes: callers that need a service's
// class or name (the maritime population generator, vessel panels) must resolve
// both. Callers that schedule Tuas calls iterate SERVICE_ROSTER directly and so
// remain unaffected by the inter-port entries.
export function serviceById(id: string): Service | undefined {
  return SERVICE_ROSTER.find((s) => s.id === id) ?? INTERPORT_SERVICES.find((s) => s.id === id);
}

export function servicesForClass(vclass: VesselClass): Service[] {
  return SERVICE_ROSTER.filter((s) => s.class === vclass);
}

// Next scheduled call for a service strictly after `afterTick`, with seeded
// jitter. The base slot is advanced past `afterTick + SERVICE_JITTER` so that a
// negative jitter can never place the booking in the past — the returned tick is
// always > afterTick, keeping the vessel from arriving instantly on recycle.
export function nextServiceSlot(rng: Rng, service: Service, afterTick: number): number {
  const P = SERVICE_CADENCE_TICKS;
  const jitter = randInt(rng, -SERVICE_JITTER, SERVICE_JITTER);
  let slot = afterTick - ((afterTick % P) + P) % P + service.phase;
  while (slot <= afterTick + SERVICE_JITTER) slot += P;
  return slot + jitter;
}
