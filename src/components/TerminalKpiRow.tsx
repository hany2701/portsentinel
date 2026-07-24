import { useState } from "react";
import { computeKpis } from "../sim";
import type { KpiSnapshot } from "../sim";
import { useSimStore } from "../store/simStore";
import { KpiCard, type KpiTrend } from "./KpiCard";
import type { SourceVariant } from "./SourceTag";

// REAL-3 (D-81): the real terminal-operator KPIs, grouped in their own strip so
// the dashboard speaks PSA's language alongside the operational cards.
const TREND_LOOKBACK = 12; // ~1 sim-hour

type Metric = keyof Omit<KpiSnapshot, "tick">;

const CARDS: {
  metric: Metric;
  label: string;
  source: SourceVariant;
  format: (n: number) => string;
  higherIsBetter: boolean;
}[] = [
  { metric: "berthOnArrivalPct", label: "Berth-on-Arrival", source: "computed", format: (n) => `${n}%`, higherIsBetter: true },
  { metric: "turnaroundHours", label: "Vessel Turnaround", source: "computed", format: (n) => `${n} h`, higherIsBetter: false },
  { metric: "craneMovesPerHour", label: "Crane Moves/hr", source: "computed", format: (n) => n.toLocaleString(), higherIsBetter: true },
  { metric: "rehandleRatio", label: "Rehandle Ratio", source: "computed", format: (n) => `${n}%`, higherIsBetter: false },
];

export function TerminalKpiRow() {
  const sim = useSimStore((s) => s.sim);
  const [open, setOpen] = useState(false);
  const current = computeKpis(sim);
  const history = sim.kpiHistory;
  const past = history.length > TREND_LOOKBACK ? history[history.length - 1 - TREND_LOOKBACK] : undefined;

  return (
    <div>
      {/* Collapsed by default (like the Cockpit's score breakdown) — the four
          operator metrics are a drill-down, not headline state, so they stay one
          click away rather than competing with the KPI row at rest. */}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      >
        {open ? "▾" : "▸"} Terminal Performance
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4">
          {CARDS.map((c) => {
            const value = current[c.metric];
            let trend: KpiTrend | undefined;
            if (past) {
              const delta = Math.round(value - past[c.metric]);
              trend = { delta, improving: c.higherIsBetter ? delta > 0 : delta < 0 };
            }
            return <KpiCard key={c.metric} label={c.label} value={c.format(value)} source={c.source} trend={trend} />;
          })}
        </div>
      )}
    </div>
  );
}
