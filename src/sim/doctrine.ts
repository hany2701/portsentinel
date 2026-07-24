import { SERVICE_CADENCE_TICKS, SERVICE_ROSTER, DEMO_SERVICE_CADENCE_TICKS, PRODUCTION_SERVICE_CADENCE_TICKS, setServiceCadence } from "./roster";
import { TRANSSHIP_SHARE, CONNECTION_WINDOW_TICKS } from "./config";
// GR-9: the maritime routing thresholds the MAR-ROUTE sections quote. It is a
// leaf module with no imports of its own, so this cannot form a cycle.
import { MARITIME_DOCTRINE } from "../maritime/maritimeDoctrine";
import type { CalibrationMode } from "./types";

// REAL-6 (D-84): DEMO_DOCTRINE is the compressed-clock value set this sim has
// always run on. PRODUCTION_DOCTRINE overrides only the fields the CALIBRATION
// record below documents as actually differing in the real world — everything
// else (crane gust limits, yard bands, weather bands, score weights, pilotage
// pool, tide/haze constants) has no separately-disclosed "real" value, so it
// stays identical between modes rather than inventing one.
const DEMO_DOCTRINE = {
  crane: {
    stsSuspendGustKts: 35,
    stsResumeBelowKts: 35,
    rtgSuspendGustKts: 45,
    degradedProductivity: 0.5,
    reberthBelowProductivity: 0.5,
  },
  berth: {
    deepWaterBerthIds: ["B1", "B2", "B3", "B4", "B5", "B6"],
    reberthMinWaitHoursSaved: 2,
    targetMaxAnchorageWaitHours: 4,
  },
  yard: {
    normalBelowPct: 70,
    elevatedBelowPct: 85,
    reviewBelowPct: 92,
    criticalPct: 92,
    reeferBlockIds: ["YB-A", "YB-B"],
    hazmatBlockId: "YB-H",
  },
  weather: {
    normalMax: 30,
    cautionMax: 60,
    severeMax: 80,
    // W3 (D-54): below this visibility, arrivals + berthing moves suspend.
    // Calibrated so sev-3 storms (which converge to 2.5 km) trigger it (D-51 precedent).
    visMinKm: 3,
    // Anti-flap (D-54): suspend instantly, resume only after this many
    // consecutive clear ticks (3 ticks = 15 sim-min).
    recoveryClearTicks: 3,
    // D-78: lightning proxy — convective precipitation at/above this rate
    // implies lightning risk at the terminal. At real Tuas, lightning stops
    // crane work more often than wind; production would use a detection feed.
    lightningPrecipMm: 14,
  },
  cargo: {
    highPriorityDelayHours: 4,
    dwellFlagDays: 5,
    dwellEscalateDays: 8,
  },
  score: {
    weights: {
      queueAndWait: 25,
      craneAvailability: 20,
      berthOccupancy: 15,
      yardUtilisation: 15,
      weatherRisk: 15,
      gateCongestion: 10,
    },
  },
  escalation: {
    normalAtOrAbove: 70,
    heightenedAtOrAbove: 40,
  },
  pilotage: {
    // REAL-4 (D-82): a deliberately small shared pool, so contention is an
    // occasional real wait cause rather than a permanent bottleneck.
    pilotPoolSize: 3,
    tugPoolSize: 6,
    tugsPerManoeuvre: 2,
  },
  tide: {
    // REAL-5 (D-83): semi-diurnal approximation for the Singapore Strait.
    // Deep-draft berthing needs the open (upper) half of the cycle.
    periodMinutes: 745,
    amplitudeM: 1.2,
    meanM: 1.5,
    minBerthingHeightM: 1.5,
  },
  haze: {
    // REAL-5 (D-83): PSI → visibility mapping + the calm-air simulated
    // fallback used when the NEA PSI feed is unreachable.
    baselinePsi: 45,
    hazardousPsi: 300,
    minVisibilityKm: 1.5,
  },
};

type DoctrineValues = typeof DEMO_DOCTRINE;

const PRODUCTION_DOCTRINE: DoctrineValues = {
  ...DEMO_DOCTRINE,
  berth: { ...DEMO_DOCTRINE.berth, targetMaxAnchorageWaitHours: 12 },
  cargo: { ...DEMO_DOCTRINE.cargo, highPriorityDelayHours: 24 },
};

// The live, mutable value set every other module reads via `DOCTRINE.foo` —
// object identity never changes, only the leaf values (applyCalibrationMode
// mutates in place via Object.assign), so no consumer needs to change how it
// imports or reads DOCTRINE.
export const DOCTRINE: DoctrineValues = structuredClone(DEMO_DOCTRINE);

// REAL-6 (D-84): switch the active regime. Mutates DOCTRINE's leaf values,
// swaps the service cadence (roster.ts), and rebuilds DOCTRINE_CORPUS so its
// interpolated prose never lies about which numbers are live. Does NOT touch
// the TF-IDF search index (would create a circular import with searchIndex.ts,
// which already imports DOCTRINE_CORPUS from here) — callers use
// sim/calibration.ts's syncCalibrationMode, which sequences both.
export function applyCalibrationMode(mode: CalibrationMode): void {
  const src = mode === "production" ? PRODUCTION_DOCTRINE : DEMO_DOCTRINE;
  Object.assign(DOCTRINE.crane, src.crane);
  Object.assign(DOCTRINE.berth, src.berth);
  Object.assign(DOCTRINE.yard, src.yard);
  Object.assign(DOCTRINE.weather, src.weather);
  Object.assign(DOCTRINE.cargo, src.cargo);
  Object.assign(DOCTRINE.score, src.score);
  Object.assign(DOCTRINE.escalation, src.escalation);
  Object.assign(DOCTRINE.pilotage, src.pilotage);
  Object.assign(DOCTRINE.tide, src.tide);
  Object.assign(DOCTRINE.haze, src.haze);
  setServiceCadence(mode);
  DOCTRINE_CORPUS = buildDoctrineCorpus();
}

// Canonical weather-band model (D-52): the single source of truth for the
// weather-risk band a given risk index falls into. Derived from the
// DOCTRINE.weather thresholds above so there is exactly one definition. Every
// consumer (gauge, band bar, header dot, twin, chatbot) reads its band from
// weatherRiskBand(); colours live once in the shared palette (twin/colors.ts).
export type WeatherBandId = "normal" | "caution" | "severe" | "critical";

export type WeatherBand = {
  id: WeatherBandId;
  minInclusive: number;
  maxInclusive: number;
  label: string;
  // Operational restriction shown in parentheses; empty for the normal band.
  operationalMeaning: string;
};

export const WEATHER_BANDS: readonly WeatherBand[] = [
  { id: "normal", minInclusive: 0, maxInclusive: DOCTRINE.weather.normalMax, label: "Normal", operationalMeaning: "" },
  { id: "caution", minInclusive: DOCTRINE.weather.normalMax + 1, maxInclusive: DOCTRINE.weather.cautionMax, label: "Caution", operationalMeaning: "slow approaches" },
  { id: "severe", minInclusive: DOCTRINE.weather.cautionMax + 1, maxInclusive: DOCTRINE.weather.severeMax, label: "Severe", operationalMeaning: "no feeder berthing moves" },
  { id: "critical", minInclusive: DOCTRINE.weather.severeMax + 1, maxInclusive: 100, label: "Critical", operationalMeaning: "all vessel moves suspended" },
];

// Lookup the band for a risk index (0–100). Ladders on maxInclusive; anything
// above the last threshold falls into critical.
export function weatherRiskBand(risk: number): WeatherBand {
  return WEATHER_BANDS.find((b) => risk <= b.maxInclusive) ?? WEATHER_BANDS[WEATHER_BANDS.length - 1];
}

// D-78: lightning risk is DERIVED from precipitation, never stored — one
// predicate feeds the wxOps gates, the chatbot snapshot and the corpus text.
// REAL-5 (D-83): this is now the FALLBACK source (sim/marineFeeds.ts prefers
// the live NEA feed when reachable) — kept unchanged so existing call sites
// and tests are undisturbed.
export function lightningRiskAt(precipMm: number): boolean {
  return precipMm >= DOCTRINE.weather.lightningPrecipMm;
}

// REAL-5 (D-83): PSI → visibility, linear from clear (12 km at PSI<=50, the
// "Good"/"Moderate" bands) down to the hazardous floor.
export function hazeVisibilityKm(psi: number): number {
  const { hazardousPsi, minVisibilityKm } = DOCTRINE.haze;
  const clear = 12;
  if (psi <= 50) return clear;
  if (psi >= hazardousPsi) return minVisibilityKm;
  const t = (psi - 50) / (hazardousPsi - 50);
  return Number((clear - t * (clear - minVisibilityKm)).toFixed(1));
}

// D-78: demo vs real-world values for constants recalibrated to the compressed
// sim clock (D-51). Switching to production values is a data change, not a code
// change — this map is the transparent record of that gap.
export const CALIBRATION: readonly { label: string; demo: string; real: string }[] = [
  { label: "Anchorage-wait action trigger", demo: `${DOCTRINE.berth.targetMaxAnchorageWaitHours} h`, real: "12 h" },
  { label: "High-priority cargo delay threshold", demo: `${DOCTRINE.cargo.highPriorityDelayHours} h`, real: "24 h" },
  { label: "Storm scenario duration", demo: "60 ticks (5 sim-h)", real: "2–6 h squall passage" },
  { label: "Lightning detection", demo: `precip ≥ ${DOCTRINE.weather.lightningPrecipMm} mm/h proxy`, real: "dedicated lightning feed (e.g. NEA)" },
  { label: "Service cadence", demo: `${DEMO_SERVICE_CADENCE_TICKS}-tick compressed loop`, real: `${PRODUCTION_SERVICE_CADENCE_TICKS}-tick (7-day) weekly service loop` },
  { label: "Transshipment connection window", demo: `${CONNECTION_WINDOW_TICKS} ticks (~2x cadence)`, real: "per-service guaranteed-connection SLA" },
  { label: "Gross crane rate", demo: "compressed-clock moves/h (inflated)", real: "~30 moves/crane·h" },
  { label: "Pilot/tug booking lead time", demo: "instant availability check", real: "≥ 2 h advance booking (MPA compulsory pilotage)" },
  { label: "Haze/PSI source", demo: "NEA PSI (west region), 10-min poll, calm-air fallback", real: "NEA PSI + local sensor network, 1-min refresh" },
  { label: "Tide model", demo: "harmonic sine approximation (seeded phase)", real: "MPA/NEA published tide tables" },
];

export type DoctrineSection = {
  docId: string;
  sectionId: string;
  title: string;
  keywords: string[];
  body: string;
};

// REAL-6 (D-84): a FUNCTION, not a static array, so its interpolated prose can
// be rebuilt from whichever DOCTRINE/cadence values are currently active
// (applyCalibrationMode calls this after switching). DOCTRINE_CORPUS is the
// live export every consumer (retrieval, search index, contextBuilder, UI,
// tests) already imports by name — declared `let` below so ES module live
// bindings pick up the reassignment without any consumer needing to change.
function buildDoctrineCorpus(): DoctrineSection[] {
  return [
  {
    docId: "OPS-CRANE",
    sectionId: "OPS-CRANE §1",
    title: "Crane wind limits",
    keywords: ["crane", "wind", "gust", "sts", "rtg", "suspend", "lightning"],
    body: `STS crane operations suspend at gusts >= ${DOCTRINE.crane.stsSuspendGustKts} kt and resume only after ${DOCTRINE.weather.recoveryClearTicks} consecutive clear ticks (15 sim-min) below ${DOCTRINE.crane.stsResumeBelowKts} kt. RTG suspends at gusts >= ${DOCTRINE.crane.rtgSuspendGustKts} kt with the same staged recovery; while RTGs are suspended, yard-to-gate outflow stops and discharge cannot place lots. In the critical weather band all cranes suspend regardless of gusts. ALL crane operations also suspend while lightning risk is present at the terminal (convective precipitation >= ${DOCTRINE.weather.lightningPrecipMm} mm/h), with the same staged recovery.`,
  },
  {
    docId: "OPS-CRANE",
    sectionId: "OPS-CRANE §3",
    title: "Crane breakdown response",
    keywords: ["crane", "breakdown", "failure", "reberth", "productivity"],
    body: `On breakdown, redistribute work to the berth's remaining cranes. A degraded crane runs at ${DOCTRINE.crane.degradedProductivity * 100}% productivity. If berth productivity falls below ${DOCTRINE.crane.reberthBelowProductivity * 100}%, consider re-berthing.`,
  },
  {
    docId: "OPS-BERTH",
    sectionId: "OPS-BERTH §1",
    title: "Berth suitability",
    keywords: ["berth", "neopanamax", "deep water", "suitability"],
    body: `Neopanamax vessels berth only on ${DOCTRINE.berth.deepWaterBerthIds.join(", ")} (F1/F2 deep-water quay). Panamax and feeder vessels may use any berth.`,
  },
  {
    docId: "OPS-BERTH",
    sectionId: "OPS-BERTH §3",
    title: "Re-berthing and diversion",
    keywords: ["berth", "reberth", "divert", "wait", "queue", "reroute", "hold"],
    body: `Re-berth when expected wait reduction >= ${DOCTRINE.berth.reberthMinWaitHoursSaved} h or safety requires. Target max anchorage wait ${DOCTRINE.berth.targetMaxAnchorageWaitHours} h. Divert a vessel only when its projected berth wait exceeds the extra sailing time to the alternate; otherwise hold it at sea until conditions clear. Spread diversions across the approved alternates rather than loading one port. Diversions name an alternate port from the approved list, always subject to confirmation with the receiving terminal.`,
  },
  {
    docId: "OPS-YARD",
    sectionId: "OPS-YARD §1",
    title: "Yard utilization bands",
    keywords: ["yard", "utilization", "block", "reallocate", "capacity"],
    body: `Yard bands: <${DOCTRINE.yard.normalBelowPct}% normal, ${DOCTRINE.yard.normalBelowPct}-${DOCTRINE.yard.elevatedBelowPct}% elevated, >${DOCTRINE.yard.elevatedBelowPct}% re-allocation review, >${DOCTRINE.yard.criticalPct}% critical (stop inbound allocation to that block). Reefer only in ${DOCTRINE.yard.reeferBlockIds.join("/")}; hazmat segregated to ${DOCTRINE.yard.hazmatBlockId}.`,
  },
  {
    docId: "OPS-WX",
    sectionId: "OPS-WX §1",
    title: "Weather risk bands",
    keywords: ["weather", "storm", "risk", "wind", "wave", "diversion"],
    body: `Weather risk bands: ${WEATHER_BANDS.map((b) => `${b.minInclusive}-${b.maxInclusive} ${b.label.toLowerCase()}${b.operationalMeaning ? ` (${b.operationalMeaning})` : ""}`).join(", ")}. Caution slows approaching vessels mechanically (ETA slips). Visibility below ${DOCTRINE.weather.visMinKm} km suspends arrivals and berthing moves. In the critical band no berthing or unberthing moves occur, but approaching vessels may still anchor — anchoring is the safe move. Suspensions lift only after ${DOCTRINE.weather.recoveryClearTicks} consecutive clear ticks. At severe+, advise diverting approaching vessels to an alternate port before they commit to the anchorage.`,
  },
  {
    docId: "OPS-WX",
    sectionId: "OPS-WX §2",
    title: "Lightning and haze sources",
    keywords: ["lightning", "haze", "psi", "nea", "air quality"],
    body: `Lightning risk is sourced primarily from live NEA observations near the terminal; if that feed is unreachable, the precipitation-rate proxy (>= ${DOCTRINE.weather.lightningPrecipMm} mm/h, OPS-CRANE §1) takes over. Haze (NEA PSI, west region) adds a second, independent input to the visibility gate (OPS-WX §1) — heavy haze can suspend berthing and unberthing even on a calm, rain-free day. Both feeds degrade the same way as the weather feed: live when reachable, stale on the last-good reading if polling fails, simulated fallback if no reading has ever succeeded.`,
  },
  {
    docId: "OPS-TIDE",
    sectionId: "OPS-TIDE §1",
    title: "Tidal berthing windows",
    keywords: ["tide", "tidal", "neopanamax", "deep water", "berthing window", "harmonic"],
    body: `Neopanamax vessels need sufficient water under keel and may only berth while the tide is at or above ${DOCTRINE.tide.minBerthingHeightM} m — the open half of a deterministic ${DOCTRINE.tide.periodMinutes}-minute semi-diurnal cycle. A neopanamax vessel that is otherwise ready waits at anchorage until the next window opens — a berth-side wait distinct from a weather suspension (OPS-WX §1) or a pilot/tug shortage (OPS-PILOT §1). Panamax and feeder vessels are not tide-gated.`,
  },
  {
    docId: "OPS-CARGO",
    sectionId: "OPS-CARGO §2",
    title: "Cargo priority and safety stock",
    keywords: ["cargo", "customer", "priority", "safety stock", "reefer", "delay", "inventory"],
    body: `High priority = customer default priority high or temperature-sensitive. Raise a safety-stock advisory when a high-priority customer's cargo is delayed > ${DOCTRINE.cargo.highPriorityDelayHours} h. Flag dwell > ${DOCTRINE.cargo.dwellFlagDays} days, escalate > ${DOCTRINE.cargo.dwellEscalateDays} days.`,
  },
  {
    docId: "OPS-CARGO",
    sectionId: "OPS-CARGO §4",
    title: "Safety-stock adjustment",
    keywords: ["safety stock", "inventory", "cover", "adjustment", "consumption"],
    body: `If expected cargo delay (days) exceeds the customer's days of cover remaining, recommend raising safety stock by the shortfall, rounded up. This is a calculated quantity, never an AI estimate.`,
  },
  {
    docId: "OPS-SCORE",
    sectionId: "OPS-SCORE §1",
    title: "Resilience score composition",
    keywords: ["resilience", "score", "kpi", "composition", "weights"],
    body: `Resilience = 100 - sum of weighted stress: queue & wait ${DOCTRINE.score.weights.queueAndWait}%, crane availability ${DOCTRINE.score.weights.craneAvailability}%, berth occupancy ${DOCTRINE.score.weights.berthOccupancy}%, yard utilization ${DOCTRINE.score.weights.yardUtilisation}%, weather risk ${DOCTRINE.score.weights.weatherRisk}%, gate congestion ${DOCTRINE.score.weights.gateCongestion}%. The score is calculated; explain contributions, never adjust it.`,
  },
  {
    docId: "OPS-TRANS",
    sectionId: "OPS-TRANS §1",
    title: "Transshipment connections",
    keywords: ["transshipment", "connection", "onward", "service", "load", "discharge", "yard", "missed", "window", "hub"],
    body: `Tuas is a transshipment hub — about ${Math.round(TRANSSHIP_SHARE * 100)}% of discharged boxes are transshipment, bound for an onward service rather than the truck gate. A discharged transshipment box waits in the yard for its onward service's next call, then is LOADED onto that vessel; only import boxes leave via the gate, so a congested gate never blocks transshipment. Each box has a connection window (demo ${CONNECTION_WINDOW_TICKS} ticks): as its deadline nears un-lifted the connection is AT RISK, and past the deadline it has MISSED and re-books onto the onward service's next weekly call. Protect at-risk connections by prioritising the onward vessel's berthing so it lifts the waiting boxes before the window closes.`,
  },
  {
    docId: "OPS-SVC",
    sectionId: "OPS-SVC §1",
    title: "Weekly service schedules",
    keywords: ["service", "schedule", "weekly", "roster", "arrival", "cadence", "bunching", "clustering", "loop"],
    body: `Vessels arrive on fixed weekly service loops, not at random. Each service (e.g. ${SERVICE_ROSTER.slice(0, 3).map((s) => s.name).join(", ")}) calls on a set weekly slot, and the same vessel re-books onto its service's next slot after it departs. Congestion is driven by schedule clustering: when several services call in the same window their arrivals bunch and lengthen the anchorage queue. The demo runs a compressed ${SERVICE_CADENCE_TICKS}-tick cadence standing in for a real 7-day loop (see calibration).`,
  },
  {
    docId: "OPS-KPI",
    sectionId: "OPS-KPI §1",
    title: "Terminal performance metrics",
    keywords: ["kpi", "metric", "berth on arrival", "turnaround", "crane", "moves", "rehandle", "productivity", "gcr"],
    body: `Terminal performance uses the metrics operators publish: berth-on-arrival % (share of arrivals that berth without anchoring — it declines when the anchorage backs up), vessel turnaround hours (arrival to departure), gross crane moves per hour (productivity per working STS crane — it goes to zero when cranes are weather-suspended), and rehandle ratio (share of yard moves that are unproductive rehandles — it rises as the yard fills). All are calculated from per-vessel arrival/berth/departure stamps and per-tick move counts, never estimated. The gross crane rate runs on the compressed demo clock so its absolute value is inflated (see calibration); trends and relative moves are what read true.`,
  },
  {
    docId: "OPS-PILOT",
    sectionId: "OPS-PILOT §1",
    title: "Compulsory pilotage & towage",
    keywords: ["pilot", "tug", "pilotage", "towage", "berthing", "unberthing", "manoeuvre", "booking"],
    body: `Every berthing and unberthing manoeuvre requires compulsory pilotage: one duty pilot plus ${DOCTRINE.pilotage.tugsPerManoeuvre} harbour tugs, drawn from a shared pool of ${DOCTRINE.pilotage.pilotPoolSize} pilots and ${DOCTRINE.pilotage.tugPoolSize} tugs. If the pool cannot cover a manoeuvre right now, the berth stays reserved but the vessel waits until a pilot and both tugs are free — a wait cause distinct from a weather suspension (OPS-WX §1) or a berth queue (OPS-BERTH §3). Real pilotage requires advance booking lead time; the sim compresses this to an availability check (see calibration).`,
  },
  {
    docId: "OPS-ESC",
    sectionId: "OPS-ESC §1",
    title: "Escalation thresholds",
    keywords: ["escalation", "resilience", "management", "monitoring"],
    body: `Resilience >= ${DOCTRINE.escalation.normalAtOrAbove} normal, ${DOCTRINE.escalation.heightenedAtOrAbove}-${DOCTRINE.escalation.normalAtOrAbove - 1} heightened monitoring, < ${DOCTRINE.escalation.heightenedAtOrAbove} inform terminal management. The assistant recommends escalation; humans perform it.`,
  },
  {
    docId: "OPS-OOD",
    sectionId: "OPS-OOD §1",
    title: "Conflicting reports and out-of-distribution data",
    keywords: ["conflict", "conflicting", "discrepancy", "disagree", "mismatch", "report", "supplier", "carrier", "anomaly", "anomalous", "unknown", "unrecognised", "verify", "reconcile", "provenance", "distribution"],
    body: `When sources disagree at the same tick — a carrier's reported ETA against the berth schedule, a supplier's "in transit" against a vessel shown diverted, a manual figure against the live feed — do not average them or silently choose. Reconcile by provenance precedence: a fresh live_external reading and the current simulated snapshot outrank an operator's verbal report, which outranks any value from earlier in the conversation. State both figures with their provenance and name the disagreement. While it is unresolved, reason from the worse-for-resilience case and protect safety and priority / cold-chain cargo over cost — recommend the conservative action (hold, flag, verify). A value outside a physically plausible range, or naming a vessel, berth, customer, service or port absent from the snapshot, is out-of-distribution: treat it as anomalous, do not act on it, flag it for verification, and hold any vessel involved until confirmed. The assistant frames the decision and escalates; it never adjudicates a data conflict on the duty manager's behalf.`,
  },

  // --- GR-9: maritime routing doctrine (MAR-ROUTE). ------------------------
  // Institutional POLICY for voyage-level rerouting — the stable text the
  // assistant retrieves and cites. Fast-changing operational values (positions,
  // costs, candidates, ETAs) are NOT here: they arrive as structured runtime
  // context, because a retrieved document that quoted them would go stale
  // between ticks and invite the model to cite a number that no longer holds.
  {
    docId: "MAR-ROUTE",
    sectionId: "MAR-ROUTE §1",
    title: "Reroute versus hold",
    keywords: ["reroute", "hold", "divert", "route", "voyage", "wait", "alternative", "decision"],
    body: `Three instruments answer a degraded route, and they are not interchangeable. REROUTE keeps the destination and changes the path — use it when a valid alternative reaches the same port at lower total cost. HOLD keeps the path and delays the vessel — use it when the obstruction is temporary and no cheaper path exists, so waiting costs less than the detour. DIVERT changes the destination to an approved alternate port (OPS-BERTH §3) — reserved for when the destination itself is the problem, not the route to it. Prefer the least disruptive instrument that clears the hazard. A vessel already inside the Tuas approach is governed by terminal doctrine: hold or divert it, do not reroute it.`,
  },
  {
    docId: "MAR-ROUTE",
    sectionId: "MAR-ROUTE §2",
    title: "Weather-driven rerouting",
    keywords: ["weather", "storm", "reroute", "risk", "hazard", "blocked", "severe", "avoid"],
    body: `Edge weather risk runs 0-100 and is derived from the same weather state and bands as terminal operations (OPS-WX §1) — one storm is never classified two ways. At or above ${MARITIME_DOCTRINE.routing.highRiskWeatherThreshold} a segment is shown as hazardous so the duty manager sees deterioration early. At or above ${MARITIME_DOCTRINE.routing.rerouteWeatherThreshold} a route change is worth proposing. At or above ${MARITIME_DOCTRINE.routing.blockWeatherRiskAtOrAbove} the segment is removed from the routing graph entirely: it is unsafe rather than merely expensive, and no detour length can buy passage through it. A reroute advisory is raised when a shorter alternative is either hazard-free or — when a basin-wide storm leaves no fully-clear route to the port — strictly reduces high-risk exposure versus the current route (D-89). Vessels slow before they divert — service speed is cut to ${MARITIME_DOCTRINE.movement.cautionSpeedFactor * 100}% in the caution band and ${MARITIME_DOCTRINE.movement.severeSpeedFactor * 100}% in the severe band.`,
  },
  {
    docId: "MAR-ROUTE",
    sectionId: "MAR-ROUTE §3",
    title: "Congestion and expected port waiting time",
    keywords: ["congestion", "traffic", "wait", "queue", "port", "density", "approach"],
    body: `Traffic density on a segment is the count of tracked vessels currently sailing it, saturating at ${MARITIME_DOCTRINE.congestion.vesselsForFullCongestion} vessels; at or above ${MARITIME_DOCTRINE.congestion.highTrafficRisk} the segment reads as heavily congested. Congestion delays, weather endangers — so congestion is weighted below weather in route cost. Expected berth wait at the destination enters the cost at ${MARITIME_DOCTRINE.routing.portWaitMinPerHour} minutes per hour of wait, which is what lets a longer route to a clear port beat a short route into a queue. Congestion on the shared approach to a vessel's OWN destination is not a rerouting problem: every corridor funnels through it and no alternative avoids it. That is an arrival problem for berth and anchorage doctrine (OPS-BERTH §3).`,
  },
  {
    docId: "MAR-ROUTE",
    sectionId: "MAR-ROUTE §4",
    title: "Corridor and strait operating guidance",
    keywords: ["corridor", "strait", "malacca", "sunda", "singapore", "waypoint", "chokepoint", "passage"],
    body: `Routes follow documented maritime waypoints, not straight lines between ports: constrained water is transited through its approved passage (Malacca and Singapore Straits, Sunda, the Sicily Channel, Gibraltar, Ushant, Suez). The Malacca-Singapore axis is the primary artery to Tuas; Sunda south of Sumatra is the genuine alternative when Malacca degrades, at materially greater distance. Chokepoints concentrate both traffic and risk, so a single storm across a strait can affect many voyages at once. This is a simulated conceptual network built on documented geographic waypoints — it is not an AIS-derived lane map and carries no navigational authority.`,
  },
  {
    docId: "MAR-ROUTE",
    sectionId: "MAR-ROUTE §5",
    title: "Reading route cost",
    keywords: ["cost", "minutes", "compare", "candidate", "ranking", "delay", "distance", "explain"],
    body: `Route cost is expressed in MINUTES throughout so travel time, weather exposure, congestion and port waiting are directly comparable and can be summed. Cost = travel time + weather penalty (${MARITIME_DOCTRINE.routing.weatherPenaltyMinPerPoint} min per risk point) + congestion penalty (${MARITIME_DOCTRINE.routing.congestionPenaltyMinPerPoint} min per point) + expected port wait + any safety restriction. All terms are non-negative, which is what makes the Dijkstra search valid. Candidates are produced under three weightings of this one model — baseline, weather-averse, congestion-averse — and ranked by total cost. A candidate's headline figures are minutes saved against the current route and additional distance in nautical miles: a route that saves time while adding distance is normal and usually means it avoided a penalty, not that it is shorter.`,
  },
  {
    docId: "MAR-ROUTE",
    sectionId: "MAR-ROUTE §6",
    title: "Same-destination alternative routing",
    keywords: ["destination", "alternative", "same", "port", "scope", "divert", "change"],
    body: `A reroute offers a different way to the SAME destination port. The origin is the vessel's present position and the destination is unchanged; only the corridor differs. Changing the destination is a diversion, a separate decision with separate consequences for cargo, customers and the receiving terminal, and it follows OPS-BERTH §3. The validator enforces this: a proposed route whose final node is not the vessel's current destination is rejected. Do not describe a reroute as sending a vessel to a different port.`,
  },
  {
    docId: "MAR-ROUTE",
    sectionId: "MAR-ROUTE §7",
    title: "Safety restrictions and blocked segments",
    keywords: ["safety", "restricted", "blocked", "unavailable", "prohibited", "exclusion"],
    body: `A restricted segment stays visible in the graph so the reason it was avoided can be inspected, but is priced beyond any plausible detour and will never appear in a candidate route. A blocked segment is removed from the search outright. Neither may be traversed by an approved reroute, and the validator rejects any proposal crossing one — including the temporary connector a vessel uses to rejoin the network after a route change, which must lie on validated water and may not cross land, a blocked edge or an exclusion zone. Safety constraints are not tradable against time.`,
  },
  {
    docId: "MAR-ROUTE",
    sectionId: "MAR-ROUTE §8",
    title: "Approval and execution governance",
    keywords: ["approve", "approval", "execute", "govern", "authority", "propose", "validate", "human"],
    body: `No route changes from free-form text. The sequence is fixed: the routing service generates candidates deterministically, the assistant explains the trade-offs, a deterministic validator checks the proposal, the duty manager previews its impact, and only an explicit human approval changes the active route. The assistant may propose; it never executes, and it never computes a route itself — it explains figures the routing service produced. On approval the vessel does not move: it keeps its exact position and progress, completes the valid remainder of its current leg, and joins the new route at the next node ahead. A reroute decision executes exactly once. The vessel keeps one canonical identity, and its superseded route is retained for comparison.`,
  },
  ];
}

export let DOCTRINE_CORPUS: DoctrineSection[] = buildDoctrineCorpus();
