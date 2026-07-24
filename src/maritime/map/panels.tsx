import { useMemo } from "react";
import { Ship } from "lucide-react";
import { SourceTag } from "../../components/SourceTag";
import { RecommendationCard } from "../../components/RecommendationCard";
import { useSimStore } from "../../store/simStore";
import {
  activeRouteSummary,
  rerouteStage,
  routeCandidates,
  waitOption,
  type RerouteStage,
  type RouteCandidate,
} from "../routeEngine";
import { formatSimTime, ticksToHours } from "../../sim";
import { portHubById } from "../ports";
import { routeNodeById } from "../network";
import { activePlanFor, originalPlanFor, type MaritimeKpis } from "../selectors";
import { MARITIME_DOCTRINE } from "../maritimeDoctrine";
import { arrivalShiftHours, revisedArrivalSimMinutes, tuasImpact } from "../tuasImpact";
import { ROUTE_STYLE } from "./layers";
import type { SimState, Vessel } from "../../sim";

// GR-4/GR-7: the map's side panels. Provenance is per FIELD, not per panel: a
// vessel card legitimately mixes simulated position with calculated ETA, and
// each row says which it is.

// UIX-2: close the map→chat loop. The twin's inspector could already ask the
// assistant about a selected entity; the map could not, forcing a detour
// through the twin.
function AskAboutVesselButton({ vessel }: { vessel: Vessel }) {
  const askAbout = useSimStore((s) => s.askAbout);
  return (
    <button
      type="button"
      onClick={() =>
        askAbout(
          `Assess ${vessel.name} (${vessel.id}): its current voyage risk, its impact on Tuas, and any action doctrine warrants.`,
        )
      }
      className="mt-1.5 rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      Ask PortSentinel about this vessel
    </button>
  );
}

export function KpiStrip({ kpis, scopeLabel }: { kpis: MaritimeKpis; scopeLabel: string }) {
  const items = [
    { label: `${scopeLabel} vessels`, value: kpis.activeVessels, tag: "simulated" as const },
    { label: "At risk", value: kpis.vesselsAtRisk, tag: "computed" as const },
    { label: "Reroutes pending", value: kpis.reroutesPending, tag: "computed" as const },
    {
      label: "Avg delay avoided",
      value: kpis.averageDelayAvoidedMinutes > 0 ? `${kpis.averageDelayAvoidedMinutes} min` : "—",
      tag: "computed" as const,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((item) => (
        <div key={item.label} className="rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{item.value}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">{item.label}</div>
          <SourceTag variant={item.tag} />
        </div>
      ))}
    </div>
  );
}

function Row({ label, value, tag }: { label: string; value: string; tag?: "simulated" | "computed" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
      <span className="flex items-center gap-2 text-right text-sm text-slate-900 dark:text-slate-100">
        {value}
        {tag && <SourceTag variant={tag} />}
      </span>
    </div>
  );
}

const nodeName = (id: string | undefined) => (id ? (routeNodeById(id)?.name ?? id) : "—");

export function SelectedVesselPanel({
  sim,
  vessel,
  hoveredCandidate = null,
  onHoverCandidate = () => {},
}: {
  sim: SimState;
  vessel: Vessel | null;
  /** MDS-2: which comparison column the pointer is on, shared with the map. */
  hoveredCandidate?: number | null;
  onHoverCandidate?: (index: number | null) => void;
}) {
  if (!vessel) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <Ship className="h-5 w-5 text-slate-400" aria-hidden="true" />
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Select a vessel on the map to trace its route, risk and arrival.
        </p>
      </div>
    );
  }

  const plan = activePlanFor(sim, vessel.id);
  const original = originalPlanFor(sim, vessel.id);
  const rerouted = plan && original && plan.id !== original.id;
  const track = vessel.track;

  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      <div className="pb-2">
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{vessel.name}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          {vessel.id} · {vessel.class} · {vessel.serviceId}
        </div>
        <AskAboutVesselButton vessel={vessel} />
      </div>

      <div className="py-2">
        <Row label="Status" value={vessel.status} tag="simulated" />
        {track && (
          <>
            <Row
              label="Position"
              value={`${track.latitude.toFixed(2)}°, ${track.longitude.toFixed(2)}°`}
              tag="simulated"
            />
            <Row label="Speed / course" value={`${Math.round(track.speedKnots)} kn · ${Math.round(track.courseDeg)}°`} tag="simulated" />
          </>
        )}
        {/* MDS-2a/MDS-3: a hold at sea is now real, so it has to be visible on
            the vessel that is holding. This used to render only for vessels
            inside the Tuas frame, which is where holds used to be possible. */}
        {vessel.heldUntilTick !== undefined && sim.clock.tick < vessel.heldUntilTick && (
          <Row label="Held until" value={formatSimTime(vessel.heldUntilTick * 5)} tag="simulated" />
        )}
      </div>

      {plan && (
        <div className="py-2">
          <Row label="From" value={nodeName(plan.originNodeId)} />
          <Row label="To" value={nodeName(plan.destinationNodeId)} />
          <Row label="Distance" value={`${Math.round(plan.totalDistanceNm)} nm`} tag="computed" />
          <Row label="ETA" value={formatSimTime(plan.etaTick * 5)} tag="computed" />
          <Row label="Route version" value={`v${plan.routeVersion}`} tag="computed" />
          {rerouted && original && (
            <Row
              label="Original ETA"
              value={`${formatSimTime(original.etaTick * 5)} (superseded)`}
              tag="computed"
            />
          )}
        </div>
      )}

      {/* GR-6: route alternatives. The engine ranks them deterministically;
          choosing one only PROPOSES it — the decision queue still validates and
          the duty manager still approves before anything changes. */}
      {vessel.status === "enroute" && (
        <RerouteOptions
          sim={sim}
          vessel={vessel}
          hoveredCandidate={hoveredCandidate}
          onHoverCandidate={onHoverCandidate}
        />
      )}

      {/* MDS-5: the downstream consequence at the terminal. Renders only when
          this vessel actually has one. */}
      <TuasImpactPanel sim={sim} vessel={vessel} />

      {vessel.status !== "enroute" && (
        <div className="py-2">
          {/* GR-7: the vessel has crossed into the Tuas frame. Its position is no
              longer geographic, so this says where it now lives rather than
              showing a stale lat/long. */}
          <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">
            In the Tuas operational frame — position shown in the Digital Twin.
          </p>
          {/* Terminal figures are the simulated conceptual model — never live PSA data.
              Projected wait and hold state are NOT repeated here: the Tuas impact
              panel above covers both for exactly these vessels, and one figure
              shown twice invites the two copies to disagree. */}
          <Row label="Assigned berth" value={vessel.berthId ?? "unassigned"} tag="simulated" />
          {vessel.anchoredSinceTick !== undefined && (
            <Row
              label="Waiting so far"
              value={`${ticksToHours(sim.clock.tick - vessel.anchoredSinceTick).toFixed(1)} h`}
              tag="computed"
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * What this vessel's situation means for Tuas (MDS-5, brief §6.6).
 *
 * The end of the chain: a reroute or a hold shifts an arrival, which changes
 * anchorage demand, which changes the berth window. Every figure is composed
 * from `sim/derive.ts` — the map summarises the terminal, it never runs a second
 * model of it (§7 ownership rule). Crane and yard consequence are genuinely not
 * modelled per vessel and say so.
 */
function TuasImpactPanel({ sim, vessel }: { sim: SimState; vessel: Vessel }) {
  const impact = useMemo(() => tuasImpact(sim, vessel), [sim, vessel]);
  // No Tuas relationship, no impact — inventing one would be a fabrication.
  if (!impact) return null;

  const shift = arrivalShiftHours(impact);
  const arrival = revisedArrivalSimMinutes(impact);

  return (
    <div className="py-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Tuas impact</span>
        <SourceTag variant="computed" />
      </div>

      {arrival !== null && <Row label="Revised arrival" value={formatSimTime(arrival)} tag="computed" />}
      {shift !== null && (
        <Row
          label="Arrival shift"
          value={`${shift > 0 ? "+" : ""}${shift.toFixed(1)} h vs original plan`}
          tag="computed"
        />
      )}
      <Row
        label="Expected anchorage wait"
        value={`${impact.anchorageWaitHours.toFixed(1)} h`}
        tag="computed"
      />
      <Row label="Queue ahead" value={`${impact.queueAhead} vessel(s)`} tag="computed" />
      {impact.berthConflict ? (
        <Row label="Berth" value="No suitable berth — conflict" tag="computed" />
      ) : (
        <Row
          label="Berth options"
          value={impact.berths.map((b) => `${b.berthId} (${b.freesInHours} h)`).join(" · ")}
          tag="computed"
        />
      )}
      {/* §6.3 vocabulary: unsupported values are labelled, never estimated. */}
      <Row label="Crane impact" value="Not modelled" />
      <Row label="Yard impact" value="Not modelled" />
      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
        Berth options reflect the current state — allocation happens on arrival.
      </p>
    </div>
  );
}

/** Sim-minutes → a compact "3.2 d" / "14 h" the table can align. */
function duration(minutes: number): string {
  const hours = minutes / 60;
  return hours >= 48 ? `${(hours / 24).toFixed(1)} d` : `${hours.toFixed(1)} h`;
}

/** Risk band label from the same thresholds the routing engine uses. */
function riskLabel(weatherRisk: number): string {
  const { routing } = MARITIME_DOCTRINE;
  if (weatherRisk >= routing.blockWeatherRiskAtOrAbove) return "Blocked";
  if (weatherRisk >= routing.highRiskWeatherThreshold) return "High";
  if (weatherRisk >= MARITIME_DOCTRINE.weather.cautionRiskAtOrAbove) return "Caution";
  return "Low";
}

/**
 * Original vs alternative, side by side (brief §6.3).
 *
 * Every figure is read straight off `routeCandidates()` / `activeRouteSummary()`
 * — the view does no routing arithmetic of its own, so the table cannot drift
 * from what the engine would actually execute. Fuel impact is NOT modelled and
 * says so rather than being estimated.
 */
function RouteComparison({
  sim,
  vessel,
  candidates,
  hovered,
  onHover,
}: {
  sim: SimState;
  vessel: Vessel;
  candidates: RouteCandidate[];
  hovered: number | null;
  onHover: (index: number | null) => void;
}) {
  const active = useMemo(() => activeRouteSummary(sim, vessel.id), [sim, vessel.id]);
  const wait = useMemo(() => waitOption(sim, vessel.id), [sim, vessel.id]);
  if (!active) return null;

  const cell = "px-1.5 py-1 text-right tabular-nums";
  const activeTotal = active.travelMinutes + active.expectedWaitMinutes;

  const rows: {
    label: string;
    current: string;
    wait: string;
    of: (c: RouteCandidate) => string;
    strong?: boolean;
  }[] = [
    {
      label: "Distance",
      current: `${Math.round(active.distanceNm)} nm`,
      wait: `${Math.round(active.distanceNm)} nm`, // same route, sailed later
      of: (c) => `${Math.round(c.distanceNm)} nm`,
    },
    { label: "Hold first", current: "—", wait: wait ? duration(wait.waitMinutes) : "—", of: () => "—" },
    {
      label: "Sailing time",
      current: duration(active.travelMinutes),
      wait: wait ? duration(wait.travelMinutes) : "—",
      of: (c) => duration(c.travelMinutes),
    },
    {
      label: "Port wait",
      current: duration(active.expectedWaitMinutes),
      wait: wait ? duration(wait.expectedWaitMinutes) : "—",
      of: (c) => duration(c.expectedWaitMinutes),
    },
    {
      label: "Risk",
      current: riskLabel(active.weatherRisk),
      wait: wait ? "Cleared" : "—",
      of: (c) => riskLabel(c.weatherRisk),
    },
    {
      label: "Hazard legs",
      current: String(active.highRiskEdgeIds.length),
      wait: wait ? "0" : "—",
      of: (c) => String(c.highRiskEdgeIds.length),
    },
    { label: "Fuel impact", current: "Not modelled", wait: "Not modelled", of: () => "Not modelled" },
    // The row that actually answers "is the detour worth it".
    {
      label: "Total",
      current: duration(activeTotal),
      wait: wait ? duration(wait.totalMinutes) : "—",
      of: (c) => duration(c.travelMinutes + c.expectedWaitMinutes),
      strong: true,
    },
  ];

  // Anything slower than both sailing now and waiting is not a real option, and
  // saying so is kinder than letting a manager work it out from six rows.
  const bestAlternativeTo = Math.min(activeTotal, wait?.totalMinutes ?? Infinity);
  const isWorse = (c: RouteCandidate) => c.travelMinutes + c.expectedWaitMinutes > bestAlternativeTo;

  return (
    <div className="mb-2 overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="text-slate-500 dark:text-slate-400">
            <th className="px-1.5 py-1 text-left font-medium">Metric</th>
            <th className="px-1.5 py-1 text-right font-medium">Sail now</th>
            {wait && <th className="px-1.5 py-1 text-right font-medium text-emerald-700 dark:text-emerald-400">Wait</th>}
            {candidates.map((c, i) => (
              <th
                key={c.id}
                onMouseEnter={() => onHover(i)}
                onMouseLeave={() => onHover(null)}
                className={`cursor-default px-1.5 py-1 text-right font-medium capitalize ${
                  i === hovered ? "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300" : ""
                }`}
              >
                {c.policy.replace(/_/g, " ")}
                {isWorse(c) && (
                  <span className="ml-1 font-normal text-amber-600 dark:text-amber-400" title="Slower than sailing now or waiting">
                    ⚠
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.label}
              className={`border-t border-slate-100 dark:border-slate-800 ${
                row.strong ? "font-semibold" : ""
              }`}
            >
              <td className="px-1.5 py-1 text-left text-slate-600 dark:text-slate-300">{row.label}</td>
              <td className={`${cell} text-slate-500 dark:text-slate-400`}>{row.current}</td>
              {wait && <td className={`${cell} text-emerald-700 dark:text-emerald-400`}>{row.wait}</td>}
              {candidates.map((c, i) => (
                <td
                  key={c.id}
                  onMouseEnter={() => onHover(i)}
                  onMouseLeave={() => onHover(null)}
                  className={`${cell} ${isWorse(c) ? "text-amber-700 dark:text-amber-500" : "text-slate-700 dark:text-slate-200"} ${
                    i === hovered ? "bg-violet-50 dark:bg-violet-950/40" : ""
                  }`}
                >
                  {row.of(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Where the reroute decision stands (MDS-3, brief §4 Q8).
 *
 * "Detected" is deliberately worded so it cannot be mistaken for a proposal: the
 * tick records that a route deteriorated and stops there (D-85). Somebody still
 * has to ask.
 */
function StageLine({ stage }: { stage: RerouteStage }) {
  if (stage.stage === "clear") return null;

  const text =
    stage.stage === "detected"
      ? "Route deterioration detected — nothing proposed yet."
      : stage.stage === "proposed"
        ? "Proposed and validated — awaiting your approval."
        : stage.stage === "invalid"
          ? `Proposal rejected by validation: ${stage.message}`
          : "Approved and executed.";

  const tone =
    stage.stage === "invalid"
      ? "text-rose-600 dark:text-rose-400"
      : stage.stage === "approved"
        ? "text-emerald-700 dark:text-emerald-400"
        : "text-amber-600 dark:text-amber-400";

  return <p className={`mb-1.5 text-xs ${tone}`}>{text}</p>;
}

/**
 * Deterministic route alternatives for the selected vessel (GR-6).
 *
 * Every figure shown here comes from the routing service, never from prose: the
 * AI explains these numbers, it does not produce them.
 */
function RerouteOptions({
  sim,
  vessel,
  hoveredCandidate,
  onHoverCandidate,
}: {
  sim: SimState;
  vessel: Vessel;
  hoveredCandidate: number | null;
  onHoverCandidate: (index: number | null) => void;
}) {
  const propose = useSimStore((s) => s.proposeUserAction);
  const candidates = useMemo(() => routeCandidates(sim, vessel.id), [sim, vessel.id]);
  const wait = useMemo(() => waitOption(sim, vessel.id), [sim, vessel.id]);
  const stage = useMemo(() => rerouteStage(sim, vessel.id), [sim, vessel.id]);
  const holdPending = sim.recommendations.some(
    (rec) =>
      rec.status === "pending" &&
      rec.proposedEffect.kind === "holdVessel" &&
      rec.proposedEffect.vesselId === vessel.id,
  );
  // The proposal awaiting a decision, if any — one per vessel, enforced below.
  const activeRec =
    stage.stage === "proposed" || stage.stage === "invalid"
      ? sim.recommendations.find((r) => r.id === stage.recommendationId)
      : undefined;
  const decision = sim.maritime.rerouteDecisions.find(
    (d) => d.vesselId === vessel.id && d.approvalStatus === "pending",
  );
  // A deterministic RerouteDecision is evidence, not a queue proposal (D-85).
  // Only an existing Recommendation means the proposal step has happened.
  const proposalPending = sim.recommendations.some(
    (rec) =>
      rec.status === "pending" &&
      rec.proposedEffect.kind === "rerouteVoyage" &&
      rec.proposedEffect.vesselId === vessel.id,
  );

  if (candidates.length === 0) return null;

  return (
    <div className="py-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Route options</span>
        <SourceTag variant="computed" />
      </div>

      {/* MDS-3: where this decision stands, derived from the records that
          already exist — the tick's evidence, the queued proposal, its
          validation verdict. Never a stored state machine. */}
      <StageLine stage={stage} />

      {/* MDS-3: the SAME RecommendationCard the decision queue and the chat
          thread mount (D-86) — preview with a horizon control, Approve and
          Dismiss, all syncing across every surface because they act on one rec
          object. Mounting it here means the manager never has to leave the map
          at the moment of decision. */}
      {activeRec && (
        <div className="mb-2">
          <RecommendationCard rec={activeRec} />
        </div>
      )}

      <RouteComparison
        sim={sim}
        vessel={vessel}
        candidates={candidates.slice(0, 3)}
        hovered={hoveredCandidate}
        onHover={onHoverCandidate}
      />

      {/* D-96: holding is a first-class option, proposed through exactly the
          same validate → preview → approve pipeline as a reroute. */}
      {wait && (
        <button
          type="button"
          disabled={holdPending}
          onClick={() =>
            propose(
              { kind: "holdVessel", vesselId: vessel.id, untilTick: wait.releaseTick },
              `Hold ${vessel.name} until the route clears`,
            )
          }
          className="mb-2 w-full rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-40 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
        >
          {holdPending
            ? "Hold proposal already queued"
            : `Propose hold — ${duration(wait.waitMinutes)}, then sail (${duration(wait.totalMinutes)} total)`}
        </button>
      )}

      {/* Honesty over theatre: the three policy weightings often agree, and when
          they do there is genuinely one alternative — padding the list would
          imply a choice the engine never found. */}
      {candidates.length === 1 && (
        <p className="mb-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          All three routing policies converge on the same alternative — there is one
          option, not three.
        </p>
      )}

      <ul className="space-y-1.5">
        {candidates.slice(0, 3).map((candidate, i) => (
          <li
            key={candidate.id}
            onMouseEnter={() => onHoverCandidate(i)}
            onMouseLeave={() => onHoverCandidate(null)}
            className={`rounded border p-1.5 ${
              i === hoveredCandidate
                ? "border-violet-300 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/40"
                : "border-slate-200 dark:border-slate-700"
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium capitalize text-slate-700 dark:text-slate-200">
                {candidate.policy.replace(/_/g, " ")}
              </span>
              <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                {candidate.delayAvoidedMinutes >= 0 ? "−" : "+"}
                {Math.abs(Math.round(candidate.delayAvoidedMinutes))} min ·{" "}
                {candidate.additionalDistanceNm >= 0 ? "+" : ""}
                {Math.round(candidate.additionalDistanceNm)} nm
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{candidate.reasons[0]}</p>
            <button
              type="button"
              disabled={proposalPending}
              onClick={() =>
                propose(
                  {
                    kind: "rerouteVoyage",
                    vesselId: vessel.id,
                    toNodeIds: candidate.nodeIds,
                    reason: decision?.reason ?? "weather",
                    decisionId: decision?.id,
                  },
                  `Reroute ${vessel.name} (${candidate.policy.replace(/_/g, " ")})`,
                )
              }
              className="mt-1 w-full rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Propose this route
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SelectedPortPanel({ portId }: { portId: string }) {
  const hub = portHubById(portId);
  if (!hub) return null;
  return (
    <div>
      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{hub.name}</div>
      <div className="text-xs text-slate-500 dark:text-slate-400">
        {hub.countryCode} · {hub.region.replace("_", " ")}
      </div>
      <div className="mt-2">
        <Row label="Congestion risk" value={hub.riskLevel} />
        <Row label="Typical wait" value={`${hub.estimatedWaitHours} h`} />
        <div className="pt-1">
          <SourceTag variant="simulated" />
          <span className="ml-2 text-xs text-slate-400">Static reference position</span>
        </div>
      </div>
    </div>
  );
}

/** A short line sample, so dash patterns read as clearly as colours do. */
function LineSwatch({ stroke, width, dash }: { stroke: string; width: number; dash?: string }) {
  return (
    <svg width={18} height={8} aria-hidden="true" className="shrink-0">
      <line x1={0} y1={4} x2={18} y2={4} stroke={stroke} strokeWidth={width} strokeDasharray={dash} />
    </svg>
  );
}

function LegendSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {title}
      </div>
      <ul className="space-y-1">{children}</ul>
    </div>
  );
}

function LegendRow({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <li className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
      {swatch}
      {label}
    </li>
  );
}

const dot = (colour: string, size = 8) => (
  <span
    className="shrink-0 rounded-full"
    style={{ background: colour, width: size, height: size }}
    aria-hidden="true"
  />
);

export function MapLegend() {
  return (
    <div className="space-y-3">
      <LegendSection title="Routes">
        <LegendRow swatch={<LineSwatch {...ROUTE_STYLE.active} />} label="Active route" />
        <LegendRow swatch={<LineSwatch {...ROUTE_STYLE.recommended} />} label="Recommended route" />
        <LegendRow swatch={<LineSwatch {...ROUTE_STYLE.original} />} label="Original (superseded)" />
        <LegendRow swatch={<LineSwatch {...ROUTE_STYLE.highRisk} width={3} />} label="High-risk segment" />
        <LegendRow swatch={<LineSwatch {...ROUTE_STYLE.blocked} />} label="Blocked / unavailable" />
        <LegendRow swatch={<LineSwatch {...ROUTE_STYLE.corridor} />} label="Shipping corridor" />
      </LegendSection>

      <LegendSection title="Vessels">
        <LegendRow swatch={dot("#8fb8e8")} label="Deep-sea" />
        <LegendRow swatch={dot("#67d6a8")} label="Regional" />
        <LegendRow swatch={dot("#f0b429")} label="Held" />
        <LegendRow swatch={dot("#38bdf8")} label="Rerouted" />
      </LegendSection>

      <LegendSection title="Ports">
        <LegendRow swatch={dot("#1baf7a", 10)} label="Primary hub" />
        <LegendRow swatch={dot("#eda100", 8)} label="Regional hub" />
        <LegendRow swatch={dot("#94a3b8", 6)} label="Supporting port" />
      </LegendSection>

      <LegendSection title="Data provenance">
        <LegendRow swatch={<SourceTag variant="simulated" />} label="Vessel positions" />
        <LegendRow swatch={<SourceTag variant="computed" />} label="Distance, ETA, route cost" />
        <LegendRow swatch={<SourceTag variant="simulated" />} label="Ports, coastline, waypoints — static reference" />
      </LegendSection>
    </div>
  );
}
