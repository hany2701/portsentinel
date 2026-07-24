import { DOCTRINE, queueEntryForecast, vesselPriorityRank, type QueueCause } from "../../sim";
import { useSimStore } from "../../store/simStore";
import { Panel, PanelState } from "../Panel";
import { SourceTag } from "../SourceTag";
import { PlanMove } from "../PlanMove";
import { isSelected, rowSelectionClass } from "./selectable";
import { useScrollSelectedIntoView } from "./useScrollSelectedIntoView";

const PRIORITY = ["Hazmat", "Reefer", "Standard"];
const CAUSE_LABEL: Record<QueueCause, string> = {
  "queue-position": "Queue",
  "tide-window": "Tide",
  "weather-suspension": "Weather",
  pilotage: "Pilot/tug",
  hold: "Hold",
};

// Ranked anchorage queue with projected berth-entry time and the causes of the
// wait (queueEntryForecast). Ranking method is stated honestly — priority
// (hazmat > reefer > standard), then wait, then ETA. Selection syncs with the map.
export function QueueTable() {
  const sim = useSimStore((s) => s.sim);
  const selection = useSimStore((s) => s.selection);
  const select = useSimStore((s) => s.select);
  const rows = queueEntryForecast(sim);
  const scrollRef = useScrollSelectedIntoView<HTMLDivElement>(selection?.entityId ?? null);

  return (
    <Panel title={`Anchorage Queue (${rows.length})`} actions={<SourceTag variant="computed" />}>
      {rows.length === 0 ? (
        <PanelState text="No vessels currently waiting at anchorage." />
      ) : (
        <div ref={scrollRef} className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
                <th className="py-2 font-normal">#</th>
                <th className="py-2 font-normal">Vessel</th>
                <th className="py-2 font-normal">Priority</th>
                <th className="py-2 font-normal">Waited</th>
                <th className="py-2 font-normal">Exp. wait</th>
                <th className="py-2 font-normal">Entry</th>
                <th className="py-2 font-normal">Berth</th>
                <th className="py-2 font-normal">Causes</th>
                <th className="py-2 font-normal">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => {
                const ref = { entityType: "vessel" as const, entityId: f.vessel.id };
                const over = f.waitedHours > DOCTRINE.berth.targetMaxAnchorageWaitHours;
                const sel = isSelected(selection, ref);
                return (
                  <tr
                    key={f.vessel.id}
                    onClick={() => select(ref)}
                    data-ops-selected={sel || undefined}
                    className={`border-b border-slate-100 text-slate-600 dark:border-slate-800/50 dark:text-slate-300 ${rowSelectionClass(sel)}`}
                  >
                    <td className="py-2 font-mono text-xs text-slate-400">{f.queuePosition}</td>
                    <td className="py-2 font-medium text-slate-800 dark:text-slate-100">
                      {f.vessel.name} <span className="font-normal capitalize text-slate-400">· {f.vessel.class}</span>
                    </td>
                    <td className="py-2 text-xs">{PRIORITY[vesselPriorityRank(f.vessel)]}</td>
                    <td className={`py-2 font-mono text-xs ${over ? "text-[#d03b3b]" : ""}`}>{f.waitedHours.toFixed(1)} h</td>
                    <td className="py-2 font-mono text-xs">{f.expectedRemainingWaitHours.toFixed(1)} h</td>
                    <td className="py-2 font-mono text-xs">t{f.entryTick}</td>
                    <td className="py-2 font-mono text-xs">{f.expectedBerthId ?? "—"}</td>
                    <td className="py-2">
                      <span className="flex flex-wrap gap-1">
                        {f.causes.length === 0 ? (
                          <span className="text-xs text-slate-400">—</span>
                        ) : (
                          f.causes.map((c) => (
                            <span key={c} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                              {CAUSE_LABEL[c]}
                            </span>
                          ))
                        )}
                      </span>
                    </td>
                    <td className="py-2" onClick={(e) => e.stopPropagation()}>
                      <PlanMove vessel={f.vessel} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
