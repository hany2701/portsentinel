import { computeKpis, formatSimTime, safetyStockOutlook } from "../sim";
import type { Recommendation, SimState } from "../sim";

// D-77: plain-text artifacts generated from live state — a shift-handover
// summary for the next duty manager, and a customer advisory notice for an
// approved safety-stock recommendation. Pure text builders, no side effects.

const line = (label: string, value: string | number) => `${label}: ${value}`;

export function buildHandoverReport(state: SimState): string {
  const k = computeKpis(state);
  const scores = state.kpiHistory.map((h) => h.resilienceScore);
  const windowNote = scores.length > 0 ? `last ${scores.length} ticks (~${Math.round((scores.length * 5) / 60)} sim-h)` : "no history yet";
  const resolved = state.recommendations.filter((r) => r.status !== "pending");
  const pending = state.recommendations.filter((r) => r.status === "pending");
  const unacked = state.alerts.filter((a) => !a.acknowledged);
  const active = state.disruptions.filter((d) => state.clock.tick >= d.startTick && state.clock.tick < d.startTick + d.durationTicks);
  const susp: string[] = [];
  if (state.wxOps.stsSuspended) susp.push("STS cranes suspended");
  if (state.wxOps.rtgSuspended) susp.push("RTG cranes suspended");
  if (state.wxOps.movesSuspended) susp.push("vessel moves suspended");

  return [
    "PORTSENTINEL — SHIFT HANDOVER (simulated data, fictional identifiers)",
    line("Sim time", `${formatSimTime(state.clock.simMinutes)} (tick ${state.clock.tick}, seed ${state.clock.seed})`),
    "",
    "CURRENT PICTURE [calculated]",
    line("Resilience", `${k.resilienceScore} (${windowNote}: min ${scores.length ? Math.min(...scores) : "-"}, max ${scores.length ? Math.max(...scores) : "-"})`),
    line("Berth occupancy", `${k.berthOccupancyPct}%`),
    line("Vessels waiting", `${k.vesselsWaiting} (avg ${k.averageBerthWaitHours} h)`),
    line("Yard utilisation", `${k.yardUtilisationPct}%`),
    line("Crane availability", `${k.craneAvailabilityPct}%`),
    line("Weather risk", `${k.weatherRiskIndex}/100 (${state.weather.freshness})`),
    line("TEU at risk", k.teuAtRisk),
    "",
    `WEATHER-OPS SUSPENSIONS: ${susp.length ? susp.join("; ") : "none"}`,
    `ACTIVE DISRUPTIONS: ${active.length ? active.map((d) => `${d.type} sev ${d.severity} (${d.startTick + d.durationTicks - state.clock.tick} ticks left)`).join("; ") : "none"}`,
    "",
    `ACTIONS THIS SESSION (${resolved.length})`,
    ...(resolved.length
      ? resolved.map((r) => `  t${r.resolvedTick ?? r.createdTick} · ${r.title} · ${r.source} · ${r.status}`)
      : ["  none"]),
    "",
    `OPEN DECISIONS (${pending.length})`,
    ...(pending.length ? pending.map((r) => `  ${r.title} [${r.source}, ${r.validationStatus}]`) : ["  none"]),
    "",
    `UNACKNOWLEDGED ALERTS (${unacked.length}, newest first)`,
    ...(unacked.length
      ? unacked.slice(-10).reverse().map((a) => `  t${a.tick} · [${a.severity}] ${a.message}${a.count > 1 ? ` (×${a.count})` : ""}`)
      : ["  none"]),
  ].join("\n");
}

export function buildCustomerNotice(state: SimState, rec: Recommendation): string | null {
  if (rec.proposedEffect.kind !== "safetyStockAdvisory") return null;
  const { customerId, days, note } = rec.proposedEffect;
  const customer = state.customers.find((c) => c.id === customerId);
  if (!customer) return null;
  const outlook = safetyStockOutlook(state).find((o) => o.customer.id === customerId);

  return [
    "TUAS TERMINAL T1 (SIMULATED) — OPERATIONS ADVISORY",
    `To: ${customer.name} (${customer.id}) — ${customer.sector}`,
    `Issued: ${formatSimTime(state.clock.simMinutes)} (simulation tick ${state.clock.tick})`,
    "Subject: Safety-stock adjustment advisory",
    "",
    outlook
      ? `Vessel delays are currently affecting ${outlook.affectedTEU.toLocaleString()} TEU of your cargo. Expected delay: ${outlook.expectedDelayDays} day(s) (worst shipment) against ${customer.daysOfCoverRemaining} day(s) of cover remaining.`
      : "Vessel delays are currently affecting your inbound cargo.",
    "",
    `Recommendation: raise safety stock by ${days} day(s) (OPS-CARGO §4 — shortfall is system-calculated, rounded up).`,
    note ? `Note: ${note}` : "",
    "",
    "Approved by the duty manager via PortSentinel. Simulated advisory for",
    "demonstration — all identifiers fictional; quantities [calculated].",
  ]
    .filter((l) => l !== "")
    .join("\n");
}
