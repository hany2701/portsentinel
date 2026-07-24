import { useState } from "react";
import { projectedETD } from "../../sim";
import type { Vessel, VesselStatus } from "../../sim";
import { useSimStore } from "../../store/simStore";
import { useOpsStore } from "../../store/opsStore";
import { Panel, PanelState } from "../Panel";
import { SourceTag } from "../SourceTag";
import { PlanMove } from "../PlanMove";
import { isSelected, rowSelectionClass } from "./selectable";
import { useScrollSelectedIntoView } from "./useScrollSelectedIntoView";

// Berthing-relevant vessels (everything except diverted), ordered by operational
// stage. Adds a projected-ETD column (there is no ETD field in the sim — it is a
// computed projection, "—" when a vessel is not yet alongside). Absorbs the roster
// role of the retired VesselTable; honours the shared search + selection.
const STAGE_ORDER: VesselStatus[] = ["alongside", "berthing", "anchored", "approaching", "departing"];
const STATUSES: (VesselStatus | "all")[] = ["all", "approaching", "anchored", "berthing", "alongside", "departing"];

function matches(v: Vessel, q: string): boolean {
  if (!q) return true;
  const t = q.toLowerCase();
  return v.name.toLowerCase().includes(t) || v.class.toLowerCase().includes(t) || (v.berthId ?? "").toLowerCase().includes(t);
}

export function BerthVesselTable() {
  const sim = useSimStore((s) => s.sim);
  const selection = useSimStore((s) => s.selection);
  const select = useSimStore((s) => s.select);
  const search = useOpsStore((s) => s.search);
  const [filter, setFilter] = useState<VesselStatus | "all">("all");
  const scrollRef = useScrollSelectedIntoView<HTMLDivElement>(selection?.entityId ?? null);

  const rows = sim.vessels
    .filter((v) => v.status !== "diverted")
    .filter((v) => filter === "all" || v.status === filter)
    .filter((v) => matches(v, search))
    .sort((a, b) => STAGE_ORDER.indexOf(a.status) - STAGE_ORDER.indexOf(b.status) || a.etaTick - b.etaTick);

  return (
    <Panel
      title={`Vessels (${rows.length})`}
      actions={
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as VesselStatus | "all")}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs capitalize text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <SourceTag variant="simulated" />
        </div>
      }
    >
      {rows.length === 0 ? (
        <PanelState text="No vessels match this filter." />
      ) : (
        <div ref={scrollRef} className="max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white dark:bg-slate-900">
              <tr className="border-b border-slate-200 text-left text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
                <th className="py-2 font-normal">Vessel</th>
                <th className="py-2 font-normal">Class</th>
                <th className="py-2 font-normal">Status</th>
                <th className="py-2 font-normal">Berth</th>
                <th className="py-2 font-normal">ETA</th>
                <th className="py-2 font-normal">ETD</th>
                <th className="py-2 font-normal">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const ref = { entityType: "vessel" as const, entityId: v.id };
                const etd = projectedETD(sim, v);
                const sel = isSelected(selection, ref);
                return (
                  <tr
                    key={v.id}
                    onClick={() => select(ref)}
                    data-ops-selected={sel || undefined}
                    className={`border-b border-slate-100 text-slate-600 dark:border-slate-800/50 dark:text-slate-300 ${rowSelectionClass(sel)}`}
                  >
                    <td className="py-2 font-medium text-slate-800 dark:text-slate-100">{v.name}</td>
                    <td className="py-2 capitalize">{v.class}</td>
                    <td className="py-2 capitalize">
                      {v.status}
                      {v.pilotageWaiting && <span className="ml-1 lowercase text-amber-600 dark:text-amber-400">· waiting for pilot/tug</span>}
                    </td>
                    <td className="py-2 font-mono text-xs">{v.berthId ?? "—"}</td>
                    <td className="py-2 font-mono text-xs">{v.status === "approaching" ? `t${v.etaTick}` : "—"}</td>
                    <td className="py-2 font-mono text-xs">{etd !== null ? `t${etd}` : "—"}</td>
                    <td className="py-2" onClick={(e) => e.stopPropagation()}>
                      <PlanMove vessel={v} />
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
