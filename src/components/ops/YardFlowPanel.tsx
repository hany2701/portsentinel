import { DOCTRINE, ticksToHours, yardFlowForecast } from "../../sim";
import { useSimStore } from "../../store/simStore";
import { useOpsStore } from "../../store/opsStore";
import { Panel, PanelState } from "../Panel";
import { SourceTag } from "../SourceTag";

const BUCKET_TICKS = 24; // 2 sim-hours per bucket

function utilColor(pct: number): string {
  if (pct < DOCTRINE.yard.normalBelowPct) return "#1baf7a";
  if (pct <= DOCTRINE.yard.elevatedBelowPct) return "#eda100";
  return "#d03b3b";
}

// Projected yard inflow vs outflow over the horizon (yardFlowForecast). Inflow =
// scheduled discharge; outflow = gate lifts + onward-service lifts. The line
// under each bucket is projected utilisation against the doctrine bands. No
// confidence figure — the sim has no forecast-confidence method.
export function YardFlowPanel() {
  const sim = useSimStore((s) => s.sim);
  const horizon = useOpsStore((s) => s.horizonTicks);
  const buckets = yardFlowForecast(sim, horizon, BUCKET_TICKS);
  const max = Math.max(1, ...buckets.map((b) => Math.max(b.inflowTEU, b.outflowTEU)));
  const anyFlow = buckets.some((b) => b.inflowTEU > 0 || b.outflowTEU > 0);

  return (
    <Panel title="Capacity Forecast" actions={<SourceTag variant="computed" />}>
      {!anyFlow ? (
        <PanelState text="No projected inflow or outflow within the horizon." />
      ) : (
        <>
          <div className="flex items-end gap-1">
            {buckets.map((b, i) => {
              const startH = Math.round(ticksToHours(b.startTick - sim.clock.tick));
              return (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex h-24 w-full items-end justify-center gap-0.5" title={`+${startH}h: in ${b.inflowTEU} / out ${b.outflowTEU} TEU · util ${b.projectedUtilPct}%`}>
                    <div className="w-2 rounded-t bg-[#2a78d6]" style={{ height: `${(b.inflowTEU / max) * 100}%` }} />
                    <div className="w-2 rounded-t bg-[#1baf7a] dark:bg-[#199e70]" style={{ height: `${(b.outflowTEU / max) * 100}%` }} />
                  </div>
                  <span className="font-mono text-[10px]" style={{ color: utilColor(b.projectedUtilPct) }}>
                    {b.projectedUtilPct}%
                  </span>
                  <span className="text-[10px] text-slate-400">+{startH}h</span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-4 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-[#2a78d6]" aria-hidden="true" /> Inflow (discharge)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-[#1baf7a] dark:bg-[#199e70]" aria-hidden="true" /> Outflow (gate + onward)
            </span>
            <span>% = projected utilisation</span>
          </div>
        </>
      )}
    </Panel>
  );
}
