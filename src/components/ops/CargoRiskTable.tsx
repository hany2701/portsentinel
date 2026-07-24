import { useState } from "react";
import {
  connectionsAtRisk,
  connectionsAtRiskTEU,
  connectionsMissed,
  DOCTRINE,
  isHighPriority,
  serviceById,
  teuAtRisk,
  ticksToHours,
  vesselWaitHours,
} from "../../sim";
import type { EntityRef, SimState } from "../../sim";
import { useSimStore } from "../../store/simStore";
import { Panel, PanelState } from "../Panel";
import { SourceTag } from "../SourceTag";
import { isSelected, rowSelectionClass } from "./selectable";
import { useScrollSelectedIntoView } from "./useScrollSelectedIntoView";

type RiskKind = "delay" | "dwell" | "connection" | "missed";
type RiskRow = {
  id: string;
  severity: "high" | "medium";
  kind: RiskKind;
  ref: EntityRef;
  label: string;
  customer: string;
  teu: number;
  cause: string;
  deadline?: number;
};

const KIND_LABEL: Record<RiskKind, string> = {
  delay: "Vessel delay",
  dwell: "Dwell breach",
  connection: "Connection",
  missed: "Missed conn.",
};

// Unified, reason-tagged cargo-risk records built from existing derivations only
// (no invented cargo IDs). Delay + dwell rows reconcile with the teuAtRisk KPI;
// connection rows reconcile with connectionsAtRiskTEU — the two totals use
// different doctrine predicates, stated rather than merged.
function buildRows(sim: SimState): RiskRow[] {
  const cust = (id?: string) => sim.customers.find((c) => c.id === id)?.name ?? "—";
  const svc = (id?: string) => (id ? serviceById(id)?.name ?? id : "—");
  const out: RiskRow[] = [];
  for (const v of sim.vessels) {
    const waited = vesselWaitHours(sim, v);
    const delayed = v.status === "diverted" || (v.status === "anchored" && waited > DOCTRINE.cargo.highPriorityDelayHours);
    if (!delayed) continue;
    for (const m of v.manifest) {
      if (!isHighPriority(sim, m.customerId)) continue;
      out.push({
        id: `${v.id}-${m.id}`,
        severity: "high",
        kind: "delay",
        ref: { entityType: "vessel", entityId: v.id },
        label: v.name,
        customer: cust(m.customerId),
        teu: m.quantityTEU,
        cause: v.status === "diverted" ? `${v.name} diverted` : `${v.name} waited ${waited.toFixed(1)} h`,
      });
    }
  }
  for (const lot of sim.cargoLots) {
    if (lot.status !== "yard" || lot.dwellStartTick === undefined) continue;
    const dwellDays = ticksToHours(sim.clock.tick - lot.dwellStartTick) / 24;
    if (isHighPriority(sim, lot.customerId) && dwellDays > DOCTRINE.cargo.dwellFlagDays) {
      out.push({
        id: `dwell-${lot.id}`, severity: "medium", kind: "dwell",
        ref: { entityType: "cargoLot", entityId: lot.id }, label: lot.id,
        customer: cust(lot.customerId), teu: lot.quantityTEU, cause: `dwell ${dwellDays.toFixed(1)} d`,
      });
    }
  }
  for (const lot of connectionsAtRisk(sim)) {
    out.push({
      id: `conn-${lot.id}`, severity: "high", kind: "connection",
      ref: { entityType: "cargoLot", entityId: lot.id }, label: lot.id, customer: cust(lot.customerId),
      teu: lot.quantityTEU, cause: `onward ${svc(lot.connectingServiceId)}`, deadline: lot.connectDeadlineTick,
    });
  }
  for (const lot of connectionsMissed(sim)) {
    out.push({
      id: `missed-${lot.id}`, severity: "high", kind: "missed",
      ref: { entityType: "cargoLot", entityId: lot.id }, label: lot.id, customer: cust(lot.customerId),
      teu: lot.quantityTEU, cause: `missed ×${lot.connectMissedCount} → ${svc(lot.connectingServiceId)}`, deadline: lot.connectDeadlineTick,
    });
  }
  return out.sort((a, b) => (a.severity === b.severity ? b.teu - a.teu : a.severity === "high" ? -1 : 1));
}

const FILTERS: (RiskKind | "all")[] = ["all", "delay", "dwell", "connection", "missed"];

export function CargoRiskTable() {
  const sim = useSimStore((s) => s.sim);
  const selection = useSimStore((s) => s.selection);
  const select = useSimStore((s) => s.select);
  const [filter, setFilter] = useState<RiskKind | "all">("all");
  const scrollRef = useScrollSelectedIntoView<HTMLDivElement>(selection?.entityId ?? null);
  const all = buildRows(sim);
  const rows = filter === "all" ? all : all.filter((r) => r.kind === filter);

  if (all.length === 0) {
    return (
      <Panel title="Active Cargo Risks" actions={<SourceTag variant="computed" />}>
        <PanelState text="No cargo is currently classified as at risk." />
      </Panel>
    );
  }

  return (
    <Panel
      title="Active Cargo Risks"
      actions={
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as RiskKind | "all")}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs capitalize text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            {FILTERS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <SourceTag variant="computed" />
        </div>
      }
    >
      <p className="mb-2 text-[11px] text-slate-400">
        Delay + dwell: {teuAtRisk(sim).toLocaleString()} TEU · Connections:{" "}
        {connectionsAtRiskTEU(sim).toLocaleString()} TEU (measured separately).
      </p>
      <div ref={scrollRef} className="max-h-80 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white dark:bg-slate-900">
            <tr className="border-b border-slate-200 text-left text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
              <th className="py-2 font-normal">Sev</th>
              <th className="py-2 font-normal">Type</th>
              <th className="py-2 font-normal">Ref</th>
              <th className="py-2 font-normal">Customer</th>
              <th className="py-2 font-normal">TEU</th>
              <th className="py-2 font-normal">Cause</th>
              <th className="py-2 font-normal">Deadline</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                onClick={() => select(r.ref)}
                data-ops-selected={isSelected(selection, r.ref) || undefined}
                className={`border-b border-slate-100 text-slate-600 dark:border-slate-800/50 dark:text-slate-300 ${rowSelectionClass(isSelected(selection, r.ref))}`}
              >
                <td className="py-2">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: r.severity === "high" ? "#d03b3b" : "#eda100" }} aria-label={r.severity} />
                </td>
                <td className="py-2 text-xs">{KIND_LABEL[r.kind]}</td>
                <td className="py-2 font-mono text-xs text-slate-800 dark:text-slate-100">{r.label}</td>
                <td className="py-2 text-xs">{r.customer}</td>
                <td className="py-2 font-mono text-xs">{r.teu.toLocaleString()}</td>
                <td className="py-2 text-xs">{r.cause}</td>
                <td className="py-2 font-mono text-xs">{r.deadline !== undefined ? `t${r.deadline}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
