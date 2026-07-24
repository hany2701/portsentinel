import {
  activePlanFor,
  exposedVessels,
  geographicVessels,
  trackedVessels,
  tuasBaselineVessels,
  tuasBoundAtSea,
  tuasFrameVessels,
  tuasQueueVessels,
} from "../maritime/selectors";
import { routeCandidates } from "../maritime/routeEngine";
import { routeNodeById } from "../maritime/network";
import { arrivalShiftHours, tuasImpact } from "../maritime/tuasImpact";
import { serviceDelays } from "../maritime/serviceDelay";
import { TUAS_PORT_ID } from "../maritime/ports";
import { TICK_SIM_MINUTES } from "../sim/config";
import {
  DOCTRINE,
  computeKpis,
  formatSimTime,
  anchorageQueue,
  vesselPriorityRank,
  vesselWaitHours,
  yardBlockUtilisationPct,
  retrieveDoctrineScored,
  doctrineIndex,
  berthOptions,
  projectedBerthWaitHours,
  safetyStockOutlook,
  weatherRiskBand,
  lightningRiskAt,
  serviceById,
  atRiskByService,
  connectionsMissed,
  transshipmentWaiting,
  ticksToHours,
  ticksUntilTideWindow,
} from "../sim";
import type { SimState, RetrievedSection, RetrievalMode } from "../sim";
import { atRiskVessels, suitableBerths } from "./vesselClassifier";
import { firstGustBreach, type WeatherForecastPoint } from "./weatherMapper";
import { PERSONA, CONSTRAINTS, ACTION_LOGIC, OUTPUT_STYLE, UNCERTAINTY_POLICY } from "../prompts";

function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// REAL-6 (D-84): the active doctrine regime — never let the assistant cite a
// threshold without disclosing which regime produced it.
function calibrationModeLine(state: SimState): string {
  return state.calibrationMode === "production"
    ? "Calibration mode [live_external, D-84]: PRODUCTION — real-world doctrine thresholds are active (see CALIBRATION for the demo values they replaced)."
    : "Calibration mode [simulated, D-84]: DEMO — compressed/instructional doctrine thresholds are active (see CALIBRATION for the real-world values).";
}

function weatherLine(state: SimState): string {
  const w = state.weather;
  const prov =
    w.freshness === "live" ? `[live_external — as of ${w.asOfMs ? hhmm(w.asOfMs) : "?"}]`
    : w.freshness === "stale" ? `[live_external — STALE, last good ${w.asOfMs ? hhmm(w.asOfMs) : "?"}]`
    : w.stormOverlay ? "[simulated — storm overlay]" : "[simulated]";
  const lightning = lightningRiskAt(w.precipMm) ? " LIGHTNING RISK at the terminal — all crane operations suspend (OPS-CRANE §1)." : "";
  return `Weather ${prov}: risk ${w.riskIndex}/100 (${weatherRiskBand(w.riskIndex).label} band), wind ${w.windKts} kt gusting ${w.gustKts} kt, wave ${w.waveHeightM} m, visibility ${w.visibilityKm} km, precip ${w.precipMm} mm/h.${lightning}`;
}

// D-75: lead-time weather picture so the assistant can advise BEFORE a
// suspension, not just explain one. Forecast rides outside SimState (it is
// wall-clock external data), so it arrives as an argument.
function forecastLine(state: SimState, forecast?: WeatherForecastPoint[]): string {
  if (!forecast || forecast.length === 0) return "Gust forecast [live_external]: no forecast data.";
  const breach = firstGustBreach(forecast, Date.now(), {
    stsKts: DOCTRINE.crane.stsSuspendGustKts,
    rtgKts: DOCTRINE.crane.rtgSuspendGustKts,
  });
  if (!breach) {
    const max = Math.max(...forecast.map((p) => p.gustKts));
    return `Gust forecast [live_external]: no crane-limit breach in the next ${forecast.length} h (max ~${max} kt).`;
  }
  const scope = breach.scope === "ALL" ? "ALL cranes (STS and RTG)" : "STS cranes";
  const suffix = state.wxOps.stsSuspended || state.wxOps.rtgSuspended ? "" : " Advise pre-emptive action for working and approaching vessels where useful.";
  return `Gust forecast [live_external]: gusts reach ~${breach.gustKts} kt in ~${breach.inHours} h — at/above the ${breach.limitKts} kt limit, ${scope} would suspend (OPS-CRANE §1).${suffix}`;
}

function kpiLine(state: SimState): string {
  const k = computeKpis(state);
  const past = state.kpiHistory.length > 12 ? state.kpiHistory[state.kpiHistory.length - 1 - 12] : undefined;
  const d = (cur: number, prev?: number) => (prev === undefined ? "" : ` (${cur - prev >= 0 ? "+" : ""}${Math.round(cur - prev)} vs 1h ago)`);
  return [
    `KPIs [calculated]:`,
    `  Resilience ${k.resilienceScore}${d(k.resilienceScore, past?.resilienceScore)}`,
    `  Berth occupancy ${k.berthOccupancyPct}%${d(k.berthOccupancyPct, past?.berthOccupancyPct)}`,
    `  Vessels waiting ${k.vesselsWaiting} (avg ${k.averageBerthWaitHours} h)`,
    `  Yard utilisation ${k.yardUtilisationPct}%${d(k.yardUtilisationPct, past?.yardUtilisationPct)}`,
    `  Crane availability ${k.craneAvailabilityPct}%`,
    `  TEU at risk ${k.teuAtRisk}`,
  ].join("\n");
}

// REAL-3 (D-81): the real terminal-operator KPIs, so the assistant can speak the
// same language as the duty manager (and explain e.g. why the crane rate fell).
function terminalLine(state: SimState): string {
  const k = computeKpis(state);
  return [
    `Terminal performance [calculated] (OPS-KPI §1):`,
    `  Berth-on-arrival ${k.berthOnArrivalPct}% · turnaround ${k.turnaroundHours} h`,
    `  Gross crane moves/h ${k.craneMovesPerHour} (compressed clock — see calibration) · rehandle ratio ${k.rehandleRatio}%`,
  ].join("\n");
}

function berthLine(state: SimState): string {
  const rows = state.berths.map((b) => {
    const v = b.vesselId ? state.vessels.find((x) => x.id === b.vesselId) : undefined;
    const work = v ? ` ${Math.round(v.workProgress * 100)}%` : "";
    return `${b.id}:${b.status}${v ? ` ${v.name}${work}` : ""}`;
  });
  return `Berths [simulated]: ${rows.join(" | ")}`;
}

function anchorageLine(state: SimState): string {
  const q = anchorageQueue(state).slice(0, 6);
  if (q.length === 0) return "Anchorage queue [simulated]: empty.";
  const rows = q.map(
    (v) =>
      `${v.id} "${v.name}" (${v.class}, ${vesselWaitHours(state, v).toFixed(1)}h, prio ${vesselPriorityRank(v)}, projected wait ${projectedBerthWaitHours(state, v)}h)`,
  );
  return `Anchorage queue [simulated, projected waits calculated] — use the id (not the name) in tool calls: ${rows.join(" | ")}`;
}

// D-70: per anchored vessel, its suitable berths ranked by earliest expected
// availability — pre-answers "where can I move vessel X?" from one derivation.
// D-74: each option carries its action validity — reassignBerth is only valid
// against a berth that is free NOW; a berth that frees later is hold-and-wait.
function berthOptionsLine(state: SimState): string {
  const q = anchorageQueue(state).slice(0, 6);
  if (q.length === 0) return "Berth options [calculated]: no vessels waiting.";
  const rows = q.map((v) => {
    const opts = berthOptions(state, v).map((o) => {
      const free = state.berths.find((b) => b.id === o.berthId)?.status === "available";
      return free
        ? `${o.berthId} free now [valid reassign target]`
        : `${o.berthId} frees ~${o.freesInHours} h [NOT yet a valid target — hold until free]`;
    });
    return `${v.id}: ${opts.length > 0 ? opts.join(" · ") : "no suitable berth"}`;
  });
  return `Berth options [calculated] (reassignBerth is only valid to a berth free NOW; for one that frees later, propose holdVessel until it frees):\n  ${rows.join("\n  ")}`;
}

// REAL-1 (D-79): inbound vessels ordered by their scheduled arrival, each tagged
// with its weekly service — so the assistant can explain a bunch of arrivals as
// schedule clustering, not noise. Arrivals follow fixed weekly service loops.
function scheduleLine(state: SimState): string {
  const inbound = state.vessels
    .filter((v) => v.status === "approaching")
    .sort((a, b) => a.etaTick - b.etaTick)
    .slice(0, 6);
  if (inbound.length === 0) return "Scheduled arrivals [simulated]: none inbound.";
  const rows = inbound.map((v) => {
    const svc = serviceById(v.serviceId);
    return `${v.id} "${v.name}" (${svc ? svc.name : v.serviceId}, ${v.class}) ETA tick ${v.etaTick}`;
  });
  return `Scheduled arrivals [simulated] — weekly service loops; bunched ETAs mean clustered service calls (OPS-SVC §1): ${rows.join(" | ")}`;
}

// REAL-2 (D-80): the transshipment connections picture — boxes waiting in the
// yard for an onward service, which are at risk of missing their window, and any
// already-missed (re-booked) connections. Tuas is a transshipment hub, so this
// is a first-class part of the operating picture.
function connectionsLine(state: SimState): string {
  const waiting = transshipmentWaiting(state);
  const atRisk = atRiskByService(state);
  const missed = connectionsMissed(state);
  if (waiting.length === 0) return "Transshipment connections [calculated]: no boxes waiting for an onward service.";
  const waitTeu = waiting.reduce((s, l) => s + l.quantityTEU, 0);
  const parts = [`${waiting.length} lots / ${waitTeu} TEU waiting in the yard for their onward service (never the truck gate)`];
  if (atRisk.length > 0) {
    const rows = atRisk.slice(0, 3).map((g) => `${g.serviceName} ${g.teu} TEU (deadline tick ${g.earliestDeadline})`);
    parts.push(`AT RISK: ${rows.join(", ")}`);
  }
  if (missed.length > 0) {
    const missedTeu = missed.reduce((s, l) => s + l.quantityTEU, 0);
    parts.push(`MISSED and re-booked to next call: ${missed.length} lots / ${missedTeu} TEU`);
  }
  return `Transshipment connections [calculated] (OPS-TRANS §1): ${parts.join(" | ")}.`;
}

// INT-7: what the weather has suspended right now (D-54 wxOps) — so the
// assistant can explain a stopped crane or frozen manoeuvre with doctrine.
function wxOpsLine(state: SimState): string {
  const wx = state.wxOps;
  const target = DOCTRINE.weather.recoveryClearTicks;
  const parts: string[] = [];
  if (wx.stsSuspended) parts.push(`STS cranes suspended (${wx.stsClearTicks}/${target} clear ticks toward resume)`);
  if (wx.rtgSuspended) parts.push(`RTG cranes suspended — yard-to-gate outflow stopped (${wx.rtgClearTicks}/${target} clear ticks)`);
  if (wx.movesSuspended) parts.push(`vessel berthing/unberthing suspended (${wx.moveClearTicks}/${target} clear ticks)`);
  if (wx.staleHold) parts.push("stale weather feed — suspensions held with degraded confidence");
  return parts.length > 0
    ? `Weather-ops suspensions [simulated] (OPS-CRANE §1, OPS-WX §1): ${parts.join(" | ")}.`
    : "Weather-ops suspensions [simulated]: none — all operations weather-clear.";
}

// INT-7: vessels under an approved hold (D-58 heldUntilTick) — earliest release,
// still subject to any active weather restriction.
function heldVesselLine(state: SimState): string {
  const held = state.vessels.filter((v) => v.heldUntilTick !== undefined && state.clock.tick < v.heldUntilTick);
  if (held.length === 0) return "Held vessels [simulated]: none.";
  const rows = held.map((v) => `${v.id} "${v.name}" (${v.status}) held until tick ${v.heldUntilTick}`);
  return `Held vessels [simulated] — earliest release, weather restrictions still apply: ${rows.join(" | ")}`;
}

// REAL-5 (D-83): lightning, haze and tide — the Singapore marine-environment
// feeds, each with their own freshness/provenance so the assistant can
// explain "why is berthing suspended on a calm day" (haze) or "why is the
// neopanamax still waiting with a free berth" (tide) correctly.
function marineEnvLine(state: SimState): string {
  const l = state.lightning;
  const h = state.haze;
  const t = state.tide;
  const lightningProv = l.freshness === "simulated" ? `[simulated — ${l.source === "nea" ? "NEA" : "precip proxy"}]` : `[live_external — ${l.freshness}]`;
  const hazeProv = h.freshness === "simulated" ? "[simulated]" : `[live_external — ${h.freshness}]`;
  const tideNote = t.windowOpen
    ? "window OPEN — neopanamax may berth"
    : `window CLOSED — reopens in ~${ticksToHours(ticksUntilTideWindow(state)).toFixed(1)} h`;
  return [
    `Marine environment [calculated] (OPS-WX §2, OPS-TIDE §1):`,
    `  Lightning ${lightningProv}: ${l.active ? "RISK — cranes suspend" : "clear"}`,
    `  Haze ${hazeProv}: PSI ${h.psi}, visibility contribution ${h.visibilityKm} km`,
    `  Tide: height ${t.heightM} m (threshold ${DOCTRINE.tide.minBerthingHeightM} m) — ${tideNote}`,
  ].join("\n");
}

// REAL-4 (D-82): the pilot/tug pool picture — a wait cause distinct from
// weather (wxOpsLine) or an approved hold (heldVesselLine), so the assistant
// can explain "berth free but no pilot" correctly.
function pilotageLine(state: SimState): string {
  const p = state.pilotage;
  const pool = `pilots ${p.pilotsAvailable}/${DOCTRINE.pilotage.pilotPoolSize} free, tugs ${p.tugsAvailable}/${DOCTRINE.pilotage.tugPoolSize} free`;
  const waiting = state.vessels.filter((v) => v.pilotageWaiting);
  if (waiting.length === 0) return `Pilotage & towage [simulated] (OPS-PILOT §1): ${pool}; no vessel currently waiting.`;
  const rows = waiting.map((v) => `${v.id} "${v.name}" (${v.status}) waiting for pilot/tug`);
  return `Pilotage & towage [simulated] (OPS-PILOT §1): ${pool}; waiting — ${rows.join(" | ")}.`;
}

function activeDisruptions(state: SimState) {
  return state.disruptions.filter(
    (d) => state.clock.tick >= d.startTick && state.clock.tick < d.startTick + d.durationTicks,
  );
}

/** Human name for a disruption's location, or null when it is a local one. */
function disruptionPlace(d: SimState["disruptions"][number]): string | null {
  for (const id of d.targetIds) {
    const node = routeNodeById(id);
    if (node) return node.name;
  }
  return null;
}

function disruptionLine(state: SimState): string {
  const active = activeDisruptions(state);
  if (active.length === 0) return "Active disruptions [simulated]: none.";
  const rows = active.map((d) => {
    // WHERE a disruption is was missing entirely: a storm on the Strait of
    // Hormuz and one over Singapore both read as "storm sev 3", so the assistant
    // could not tell a remote chokepoint from weather on the doorstep.
    const place = disruptionPlace(d);
    const where = place ? ` at ${place}` : d.type === "storm" ? " over the Singapore approaches (local)" : "";
    return `${d.type} sev ${d.severity}${where} (${d.startTick + d.durationTicks - state.clock.tick} ticks left)`;
  });
  return `Active disruptions [simulated]: ${rows.join(" | ")}`;
}

/**
 * How an active disruption reaches Tuas — the question a duty manager actually
 * asks about a storm on the far side of the Indian Ocean. Without this the
 * assistant could report a disruption at the Strait of Hormuz and report Tuas's
 * KPIs, but had nothing connecting the two, so any answer about the consequence
 * here was necessarily invented.
 *
 * The honest structure of the answer is a two-population one, and it is stated
 * explicitly because it is what stops a plausible-sounding fabrication: Tuas
 * arrivals come from the tracked vessels on the route graph, which a corridor
 * disruption CAN delay, and from the baseline fleet booked on weekly service
 * slots (D-79), which is not on the graph and which a remote storm therefore
 * does not touch at all. So "a storm at Hormuz means less traffic at Tuas" is
 * usually FALSE in this model, and the line says so rather than leaving the
 * assistant to guess the intuitive answer.
 *
 * Every figure is derived from the same selectors the map uses.
 */
function tuasExposureLine(state: SimState): string {
  const active = activeDisruptions(state);
  if (active.length === 0) return "Disruption → Tuas [calculated]: no active disruption.";

  const exposed = exposedVessels(state);
  const exposedTuasBound = exposed.filter((v) => v.destinationPortId === TUAS_PORT_ID);
  const queue = tuasQueueVessels(state);
  const where = active.map((d) => disruptionPlace(d) ?? "the Singapore approaches").join(", ");
  const picture =
    `Tuas arrival picture now: ${queue.waiting.length} waiting at the anchorage, ` +
    `${queue.approaching.length} approaching.`;

  // D-110: services whose rotation runs through the disruption book their next
  // Tuas call late, so a remote storm DOES reach the port — through the
  // timetable rather than through any individual tracked vessel.
  const delays = serviceDelays(state);
  const delayRows = delays
    .map(
      (d) =>
        `${d.serviceName} (${d.serviceId}) slips ${d.delayTicks} tick(s), ` +
        `${Math.round(d.fraction * 100)}% slower round trip` +
        (d.worstNodeName ? `, worst at ${d.worstNodeName} risk ${Math.round(d.worstRisk)}` : "") +
        (d.blockedLegs > 0 ? `, ${d.blockedLegs} leg(s) blocked` : ""),
    )
    .join(" | ");

  if (exposedTuasBound.length === 0) {
    const serviceEffect = delays.length
      ? `Services routed through it book their next Tuas call LATE: ${delayRows}. ` +
        `So Tuas sees fewer arrivals from those services in the near term, then they return to cadence. ` +
        `Services not routed through it are unaffected and keep their normal slots.`
      : `No service rotation is slowed enough to slip its next call either, so Tuas traffic is unchanged. ` +
        `Do not infer a rise or fall in it from this disruption.`;
    return (
      `Disruption → Tuas [calculated]: ${exposed.length} tracked vessel(s) are exposed at ${where}, ` +
      `but NONE of them is Tuas-bound, so no vessel currently at sea has its Tuas arrival delayed. ` +
      `${tuasBoundAtSea(state).length} tracked vessel(s) are Tuas-bound at sea. ` +
      `${serviceEffect} ${picture}`
    );
  }

  const rows = exposedTuasBound.map((v) => {
    const impact = tuasImpact(state, v);
    if (!impact) return `${v.id} ${v.name}`;
    const shift = arrivalShiftHours(impact);
    const shifted = shift === null ? "no committed change yet" : `${shift >= 0 ? "+" : ""}${shift.toFixed(1)} h vs original plan`;
    return (
      `${v.id} ${v.name} — ${shifted}, projected anchorage wait ${impact.anchorageWaitHours.toFixed(1)} h, ` +
      `${impact.queueAhead} ahead in the queue`
    );
  });

  return (
    `Disruption → Tuas [calculated]: ${exposed.length} tracked vessel(s) exposed at ${where}, of which ` +
    `${exposedTuasBound.length} ${exposedTuasBound.length === 1 ? "is" : "are"} Tuas-bound: ${rows.join(" | ")}. ` +
    `${picture} Direction of the effect: these arrivals slip later, so berth demand eases in the near term ` +
    `and those vessels rejoin the queue afterwards.` +
    (delays.length
      ? ` The baseline fleet is affected too, through the timetable: ${delayRows}.`
      : ` The baseline fleet keeps its normal slots — no service rotation is slowed enough to slip a call.`)
  );
}

function yardLine(state: SimState): string {
  const rows = state.yardBlocks.map((b) => `${b.id} ${yardBlockUtilisationPct(state, b.id)}%`);
  return `Yard blocks [calculated]: ${rows.join(" | ")}`;
}

// --- GR-9: maritime runtime context ----------------------------------------
//
// Fast-changing voyage state is INJECTED, not retrieved (GR-D13). Doctrine
// prose that quoted a position or an ETA would be stale within a tick; these
// lines carry the current figures straight from the deterministic services, so
// the assistant explains numbers it was given rather than numbers it recalled.
//
// Compact by design: ids, counts and computed facts. Never polygon arrays or
// full route geometry — a geometry dump would crowd out the operational state
// and tempt the model to reason about coordinates it should not touch.

function maritimeLine(state: SimState): string {
  const tracked = trackedVessels(state);
  if (tracked.length === 0) return "Maritime network [simulated]: no tracked vessels.";
  const geographic = geographicVessels(state);
  const inFrame = tuasFrameVessels(state);
  const tuasBound = geographic.filter((v) => v.destinationPortId === TUAS_PORT_ID);

  const heading = tuasBound
    .map((v) => {
      const plan = activePlanFor(state, v.id);
      const eta = plan ? ` ETA ${formatSimTime(plan.etaTick * TICK_SIM_MINUTES)} [calculated]` : "";
      return `${v.id} ${v.name} (${Math.round(v.track!.speedKnots)} kn, course ${Math.round(v.track!.courseDeg)}°)${eta}`;
    })
    .join(" | ");

  return (
    `Maritime network [simulated positions, calculated routes]: ${tracked.length} tracked vessels ` +
    `(${geographic.length} sailing, ${inFrame.length} inside the Tuas frame) plus the ${tuasBaselineVessels(state).length}-vessel ` +
    `Tuas baseline. Inbound to Tuas: ${heading || "none"}.`
  );
}

function rerouteLine(state: SimState): string {
  const decisions = state.maritime.rerouteDecisions.filter((d) => d.approvalStatus === "pending");
  if (decisions.length === 0) return "Reroute advisories [calculated]: none.";

  const rows = decisions.slice(0, 4).map((d) => {
    const v = state.vessels.find((x) => x.id === d.vesselId);
    const plan = activePlanFor(state, d.vesselId);
    // Candidate figures come from the routing service — the assistant must
    // never derive or estimate these itself. A stale/incompatible saved route
    // can make the routing service throw; that must degrade this one line,
    // not the whole chat turn.
    let best: ReturnType<typeof routeCandidates>[number] | undefined;
    try {
      best = v ? routeCandidates(state, d.vesselId)[0] : undefined;
    } catch {
      best = undefined;
    }
    // A safety advisory routes around a BLOCKED segment, so its alternative is
    // normally slower — "saves -1690 min" is not something the assistant should
    // be handed and asked to quote. State the direction of the time effect.
    const delta = Math.round(best?.delayAvoidedMinutes ?? 0);
    const time = delta >= 0 ? `saves ${delta} min` : `costs ${Math.abs(delta)} min extra`;
    const option = best
      ? ` Best alternative: ${best.policy} via ${best.nodeIds.length} nodes, ` +
        `${time}, ${Math.round(best.additionalDistanceNm) >= 0 ? "+" : ""}` +
        `${Math.round(best.additionalDistanceNm)} nm, total cost ${Math.round(best.totalCost)} min.`
      : " No valid alternative currently.";
    return (
      `${d.vesselId} ${v?.name ?? ""} — reason ${d.reason}, ` +
      `${d.highRiskEdgeIds.length} affected segment(s), current route v${plan?.routeVersion ?? "?"}.${option}`
    );
  });

  return `Reroute advisories [calculated]:\n  ${rows.join("\n  ")}`;
}

function atRiskVesselLine(state: SimState): string {
  const rows = atRiskVessels(state).slice(0, 5).map(({ vessel, classification }) => {
    const berths = vessel.status === "anchored" ? suitableBerths(state, vessel).map((b) => b.id) : [];
    const berthNote = berths.length ? ` — available suitable berths: ${berths.join(", ")}` : "";
    return `${vessel.id} ${vessel.name} [${classification.risk}]: ${classification.reasons.join("; ")}${berthNote}`;
  });
  return rows.length ? `At-risk vessels [calculated]:\n  ${rows.join("\n  ")}` : "At-risk vessels [calculated]: none.";
}

function atRiskCargoLine(state: SimState): string {
  const rows = state.customers
    .filter((c) => c.defaultPriority === "high" || c.temperatureSensitive)
    .slice(0, 5)
    .map((c) => `${c.id} ${c.name} (${c.sector}, ${c.daysOfCoverRemaining}d cover, ${c.safetyStockDays}d safety stock)`);
  return `Priority customers [simulated]:\n  ${rows.join("\n  ")}`;
}

// D-56 (5): the structured safety-stock picture, one line per affected
// high-priority customer, every field calculated by the shared derivation.
function safetyStockLine(state: SimState): string {
  const rows = safetyStockOutlook(state).map(
    (o) =>
      `${o.customer.id} ${o.customer.name}: affected ${o.affectedTEU} TEU, cover ${o.customer.daysOfCoverRemaining} d, expected delay ${o.expectedDelayDays} d (worst shipment), computed shortfall ${o.shortfallDays} d, advisory ${o.pendingRec ? "already pending" : "not yet raised"}`,
  );
  return rows.length
    ? `Safety-stock outlook [calculated] (shortfall days are system-computed — never author your own):\n  ${rows.join("\n  ")}`
    : "Safety-stock outlook [calculated]: no high-priority customers affected by delays.";
}

function pendingRecsLine(state: SimState): string {
  const pending = state.recommendations.filter((r) => r.status === "pending");
  if (pending.length === 0) return "Pending recommendations: none.";
  const rows = pending.map((r) => `[${r.source}] ${r.title} (${r.validationStatus})`);
  return `Pending recommendations (do NOT duplicate these): ${rows.join(" | ")}`;
}

/**
 * Assemble the per-request system prompt (plan §6): persona, retrieved doctrine + always-on
 * index, constraints, output style (D-65), action logic, the conflict/out-of-distribution
 * policy (D-111), a tick-stamped live-state snapshot with provenance labels, and the
 * pending-recommendation list so the agent never duplicates the queue. The static prompt
 * sections live in src/prompts (D-64).
 */
export function buildChatContext(
  state: SimState,
  userMessage: string,
  forecast?: WeatherForecastPoint[],
  /**
   * GR-9 (GR-D13): which retrieval arm to assemble with. Defaults to the shipped
   * TF-IDF behaviour; `none` withholds retrieved policy while keeping the whole
   * structured runtime context, which is the with/without-RAG comparison the
   * evaluation harness measures. Model-A/model-B comparison reuses the SAME
   * assembled context and varies only the model id at the request layer.
   */
  retrievalMode: RetrievalMode = "tfidf",
): { system: string; retrieved: RetrievedSection[] } {
  const retrievedSections = retrieveDoctrineScored(state, userMessage, retrievalMode);
  const retrieved = retrievedSections
    .map((r) => `[${r.section.sectionId}] ${r.section.body}`)
    .join("\n");

  const system = [
    `# Persona\n${PERSONA}`,
    `# Institutional knowledge (retrieved)\n${retrieved || "(no sections matched — rely on the index below and say so if a rule isn't provided)"}\nDoctrine index: ${doctrineIndex()}`,
    `# Constraints\n${CONSTRAINTS}`,
    `# Output style\n${OUTPUT_STYLE}`,
    `# Action logic\n${ACTION_LOGIC}`,
    `# Data conflicts and out-of-distribution\n${UNCERTAINTY_POLICY}`,
    `# Live state — tick ${state.clock.tick}, ${formatSimTime(state.clock.simMinutes)}`,
    calibrationModeLine(state),
    weatherLine(state),
    forecastLine(state, forecast),
    kpiLine(state),
    terminalLine(state),
    berthLine(state),
    anchorageLine(state),
    scheduleLine(state),
    berthOptionsLine(state),
    disruptionLine(state),
    tuasExposureLine(state),
    wxOpsLine(state),
    heldVesselLine(state),
    pilotageLine(state),
    marineEnvLine(state),
    maritimeLine(state),
    rerouteLine(state),
    yardLine(state),
    connectionsLine(state),
    atRiskVesselLine(state),
    atRiskCargoLine(state),
    safetyStockLine(state),
    pendingRecsLine(state),
    `Escalation bands [calculated]: >= ${DOCTRINE.escalation.normalAtOrAbove} normal, ${DOCTRINE.escalation.heightenedAtOrAbove}-${DOCTRINE.escalation.normalAtOrAbove - 1} heightened, < ${DOCTRINE.escalation.heightenedAtOrAbove} inform management.`,
  ].join("\n\n");

  return { system, retrieved: retrievedSections };
}

export function buildSystemPrompt(state: SimState, userMessage: string): string {
  return buildChatContext(state, userMessage).system;
}
