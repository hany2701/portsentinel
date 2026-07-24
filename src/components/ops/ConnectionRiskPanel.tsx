import { atRiskByService, ticksToHours } from "../../sim";
import { useSimStore } from "../../store/simStore";
import { Panel, PanelState } from "../Panel";
import { SourceTag } from "../SourceTag";

// Transshipment connections at risk grouped by onward service, soonest cut-off
// first (atRiskByService), with a live deadline countdown from real tick values.
export function ConnectionRiskPanel() {
  const sim = useSimStore((s) => s.sim);
  const rows = atRiskByService(sim);

  return (
    <Panel title="Connection Risk by Service" actions={<SourceTag variant="computed" />}>
      {rows.length === 0 ? (
        <PanelState text="No transshipment connections at risk." />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const ticksLeft = r.earliestDeadline - sim.clock.tick;
            const hoursLeft = ticksToHours(ticksLeft);
            return (
              <li key={r.serviceId} className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2 text-xs last:border-0 dark:border-slate-800/50">
                <div className="min-w-0">
                  <p className="font-medium text-slate-800 dark:text-slate-100">{r.serviceName}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {r.count} connection{r.count === 1 ? "" : "s"} · {r.teu.toLocaleString()} TEU
                  </p>
                </div>
                <span className={`shrink-0 font-mono text-xs ${hoursLeft <= 0 ? "text-[#d03b3b]" : hoursLeft < 2 ? "text-[#eda100]" : "text-slate-500 dark:text-slate-400"}`}>
                  {hoursLeft <= 0 ? "overdue" : `${hoursLeft.toFixed(1)} h`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
