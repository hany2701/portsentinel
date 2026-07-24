import { useState } from "react";
import { Sparkles } from "lucide-react";
import { resilienceScore, resilienceBreakdown, DOCTRINE } from "../sim";
import type { SimState } from "../sim";
import { buildHandoverReport } from "../utils/reports";
import { useSimStore } from "../store/simStore";
import { Panel } from "./Panel";
import { SourceTag } from "./SourceTag";
import { Gauge } from "./Gauge";
import { Sparkline } from "./Sparkline";

// D-77: shift memory — the ring buffer holds 24 sim-hours (288 ticks).
const TREND_RANGES = [
  { label: "2 h", ticks: 24 },
  { label: "8 h", ticks: 96 },
  { label: "24 h", ticks: 288 },
];

function downloadHandover(sim: SimState): void {
  const blob = new Blob([buildHandoverReport(sim)], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `handover-t${sim.clock.tick}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function escalation(score: number): { label: string; className: string } {
  if (score >= DOCTRINE.escalation.normalAtOrAbove) return { label: "Normal operations", className: "text-[#1baf7a] dark:text-[#199e70]" };
  if (score >= DOCTRINE.escalation.heightenedAtOrAbove) return { label: "Heightened monitoring", className: "text-[#eda100] dark:text-[#c98500]" };
  return { label: "Inform terminal management", className: "text-[#d03b3b]" };
}

// Resilience is high-is-good: green at/above normal, amber at heightened, red below.
function resilienceStroke(score: number): string {
  if (score >= DOCTRINE.escalation.normalAtOrAbove) return "stroke-[#1baf7a] dark:stroke-[#199e70]";
  if (score >= DOCTRINE.escalation.heightenedAtOrAbove) return "stroke-[#eda100] dark:stroke-[#c98500]";
  return "stroke-[#d03b3b]";
}

// D-112: the resilience score, promoted to a full-width hero band above the KPI
// row — the gauge, escalation band, breakdown and interpretation, so the score
// is unmistakably the headline of the view. The historical trend and gate
// summary stay in CockpitDetail (left column) so the hero stays compact.
export function ResilienceHero() {
  const sim = useSimStore((s) => s.sim);
  const interpretation = useSimStore((s) => s.interpretation);
  const interpretScore = useSimStore((s) => s.interpretScore);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const score = resilienceScore(sim);
  const esc = escalation(score);
  const interpreting = interpretation.status === "streaming";
  const breakdown = resilienceBreakdown(sim);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
        <div className="w-44 shrink-0">
          <Gauge value={score} label="Resilience score" colorClass={resilienceStroke(score)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500 dark:text-slate-400">Resilience score</p>
            <SourceTag variant="computed" />
          </div>
          <p className={`mt-1 text-2xl font-semibold ${esc.className}`}>{esc.label}</p>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => interpretScore()}
              disabled={interpreting}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              {interpreting ? "Interpreting…" : "Interpret score"}
            </button>
            {/* D-75: the score's arithmetic, always available without the LLM. */}
            <button
              type="button"
              aria-expanded={showBreakdown}
              onClick={() => setShowBreakdown((o) => !o)}
              className="text-[11px] font-medium text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
            >
              {showBreakdown ? "▾" : "▸"} Score breakdown
            </button>
          </div>

          {(interpretation.text || interpreting) && (
            <div className="mt-2 rounded-md bg-violet-500/5 p-2">
              <p className="text-sm text-slate-700 dark:text-slate-200">
                {interpretation.text}
                {interpreting && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-current align-middle" />}
              </p>
              {interpretation.status !== "error" && (
                <div className="mt-1.5">
                  <SourceTag variant="ai" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showBreakdown && (
        <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 dark:border-slate-800">
          {breakdown.map((f) => (
            <div key={f.key} className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="w-28 shrink-0">{f.label}</span>
              <span className="w-9 shrink-0 text-right font-mono">{f.weightPct}%</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                <span className="block h-full rounded bg-[#d03b3b]/70" style={{ width: `${Math.round(f.stress * 100)}%` }} />
              </span>
              <span className="w-12 shrink-0 text-right font-mono">−{f.contribution.toFixed(1)}</span>
            </div>
          ))}
          <p className="pt-0.5 text-right text-[10px] text-slate-400 dark:text-slate-500">
            100 − {breakdown.reduce((s, f) => s + f.contribution, 0).toFixed(1)} penalty ≈ {score} [OPS-SCORE §1]
          </p>
        </div>
      )}
    </section>
  );
}

// D-112: the supporting detail that used to sit under the gauge in the Cockpit —
// the resilience trend over time and the gate summary. The score itself now
// leads the view in ResilienceHero, so this panel carries only what isn't the
// headline and isn't already in the KPI row.
export function CockpitDetail() {
  const sim = useSimStore((s) => s.sim);
  const [range, setRange] = useState(24);
  const history = sim.kpiHistory.map((k) => k.resilienceScore);

  return (
    <Panel title="Trend & gate" actions={<SourceTag variant="computed" />}>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs text-slate-500 dark:text-slate-400">Resilience trend</p>
          <div className="flex items-center gap-1">
            {TREND_RANGES.map((r) => (
              <button
                key={r.label}
                type="button"
                onClick={() => setRange(r.ticks)}
                className={`rounded border px-1.5 py-0.5 text-[10px] ${range === r.ticks ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900" : "border-slate-300 text-slate-500 dark:border-slate-700 dark:text-slate-400"}`}
              >
                {r.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => downloadHandover(sim)}
              title="Download a shift-handover report (KPIs, actions, open decisions, alerts)"
              className="ml-1 rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              Handover ⤓
            </button>
          </div>
        </div>
        <Sparkline values={history.slice(-range)} />
      </div>
      {/* Gate summary — the one operational readout that appears nowhere else on
          this screen (the KPI row carries the rest). */}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <div><dt className="text-[10px] text-slate-500 dark:text-slate-400">Gate Queue</dt><dd className="font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100">{sim.gate.queuedTrucks} trk · {sim.gate.averageWaitMinutes} min</dd></div>
        <div><dt className="text-[10px] text-slate-500 dark:text-slate-400">Gate Status</dt><dd className="font-mono text-sm capitalize text-slate-900 dark:text-slate-100">{sim.gate.status}</dd></div>
      </dl>
    </Panel>
  );
}
