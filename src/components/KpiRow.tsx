import { computeKpis, maxAnchorageWait, DOCTRINE } from "../sim";
import type { KpiSnapshot } from "../sim";
import { useSimStore } from "../store/simStore";
import { KpiCard, type KpiAccent, type KpiTrend } from "./KpiCard";
import type { SourceVariant } from "./SourceTag";

const TREND_LOOKBACK = 12; // ~1 sim-hour

/**
 * Wait hours for the card's detail line.
 *
 * A tenth of an hour is meaningful at 2.2 h and noise at 22.5 h — and the card
 * has 57px for this line once the provenance tag has taken its share, which
 * "max 22.5 h" (63px) overruns and "max 22 h" (52px) does not. Dropping the
 * decimal at double digits keeps every value on one line without shaving the
 * padding to nothing. The exact figures stay in the hover title.
 */
const waitHours = (h: number) => (h >= 10 ? Math.round(h) : h);

type Metric = keyof Omit<KpiSnapshot, "tick">;

// The resilience score is intentionally NOT a card here: the Cockpit gauge is its
// single, dominant home (score + escalation band + trend + breakdown), so the row
// carries the supporting operational metrics only. `warnAboveZero` marks the risk
// cards that should turn amber when — and only when — they are non-zero, so colour
// on this row means "needs attention" rather than decoration.
const CARDS: {
  metric: Metric;
  label: string;
  source: SourceVariant;
  format: (n: number) => string;
  higherIsBetter: boolean;
  warnAboveZero?: boolean;
}[] = [
  { metric: "berthOccupancyPct", label: "Berth Occupancy", source: "simulated", format: (n) => `${n}%`, higherIsBetter: false },
  { metric: "vesselsWaiting", label: "Vessels Waiting", source: "simulated", format: (n) => String(n), higherIsBetter: false },
  { metric: "yardUtilisationPct", label: "Yard Utilisation", source: "simulated", format: (n) => `${n}%`, higherIsBetter: false },
  { metric: "craneAvailabilityPct", label: "Crane Availability", source: "simulated", format: (n) => `${n}%`, higherIsBetter: true },
  { metric: "weatherRiskIndex", label: "Weather Risk", source: "simulated", format: (n) => String(n), higherIsBetter: false },
  { metric: "teuAtRisk", label: "TEU at Risk", source: "computed", format: (n) => n.toLocaleString(), higherIsBetter: false, warnAboveZero: true },
  { metric: "connectionsAtRisk", label: "Connections at Risk", source: "computed", format: (n) => String(n), higherIsBetter: false, warnAboveZero: true },
];

export function KpiRow() {
  const sim = useSimStore((s) => s.sim);
  const current = computeKpis(sim);
  const history = sim.kpiHistory;
  const past = history.length > TREND_LOOKBACK ? history[history.length - 1 - TREND_LOOKBACK] : undefined;
  // D-75: the average hides the worst waiter — surface it and flag a doctrine breach.
  const worst = maxAnchorageWait(sim);
  const worstOver = !!worst && worst.hours > DOCTRINE.berth.targetMaxAnchorageWaitHours;
  // Two short lines rather than one long one. As a single string it wrapped
  // unpredictably — two lines at 175px, four at 95px — which pushed this card's
  // provenance tag out of line with the other six and drove the whole row's
  // height.
  //
  // The worst waiter's NAME is deliberately not one of the lines. A 154px card
  // cannot hold it beside the figure without truncating to "Emerald…", and on a
  // line of its own a bare proper noun reads as noise rather than as the
  // vessel D-75 wanted surfaced. It stays in the hover title, where the figure
  // it belongs to is right next to it.
  const waitingDetail = [
    `avg ${waitHours(current.averageBerthWaitHours)} h`,
    ...(worst ? [`max ${waitHours(worst.hours)} h`] : []),
  ];
  const waitingTitle = worst
    ? `avg ${current.averageBerthWaitHours} h · longest wait ${worst.hours} h (${worst.vessel.name})`
    : `avg ${current.averageBerthWaitHours} h`;

  return (
    <div className="kpi-strip">
      <div className="kpi-grid">
        {CARDS.map((c) => {
          const value = current[c.metric];
          let trend: KpiTrend | undefined;
          if (past) {
            const delta = Math.round(value - past[c.metric]);
            trend = { delta, improving: c.higherIsBetter ? delta > 0 : delta < 0 };
          }
          // Weather risk derives from the external feed — reflect its live/stale/simulated
          // freshness honestly (D-26) rather than a static tag. It is also the one card
          // that keeps its coloured provenance dot: the live/stale state is the genuinely
          // varying, real-world signal worth surfacing.
          const isWeather = c.metric === "weatherRiskIndex";
          const source = isWeather ? sim.weather.freshness : c.source;
          const accent: KpiAccent | undefined = c.warnAboveZero && value > 0 ? "warning" : undefined;
          return (
            <KpiCard
              key={c.metric}
              label={c.label}
              value={c.format(value)}
              source={source}
              mutedSource={!isWeather}
              trend={trend}
              // An array on EVERY card (empty where there is nothing to say), so
              // each reserves the same two-line block and the provenance tags
              // across the row sit at one height.
              detail={c.metric === "vesselsWaiting" ? waitingDetail : []}
              detailTitle={c.metric === "vesselsWaiting" ? waitingTitle : undefined}
              detailAccent={c.metric === "vesselsWaiting" && worstOver}
              accent={accent}
            />
          );
        })}
      </div>
    </div>
  );
}
