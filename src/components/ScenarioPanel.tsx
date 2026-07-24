import { useState } from "react";
import { CloudLightning, Ship, Wrench, Ban } from "lucide-react";
import { ticksToHours } from "../sim";
import type { DisruptionType } from "../sim";
import { useSimStore } from "../store/simStore";
import { ROUTE_NODES } from "../maritime/network";
import { Panel } from "./Panel";

/** The straits a storm can be placed on (D-91) — the same nodes the map marks. */
const CHOKEPOINTS = ROUTE_NODES.filter((n) => n.kind === "strait");

const SCENARIOS: { type: DisruptionType; label: string; icon: typeof Ship }[] = [
  { type: "storm", label: "Storm", icon: CloudLightning },
  { type: "arrivalSurge", label: "Arrival surge", icon: Ship },
  { type: "craneFailure", label: "Crane failure", icon: Wrench },
  { type: "berthClosure", label: "Berth closure", icon: Ban },
];

const LABELS: Record<DisruptionType, string> = {
  storm: "Storm",
  arrivalSurge: "Arrival surge",
  craneFailure: "Crane failure",
  berthClosure: "Berth closure",
};

/**
 * The scenario controls themselves — severity, the four injections, and the
 * active-disruption list.
 *
 * Extracted from ScenarioPanel so the same markup and the same handlers can be
 * rendered inside the ScenarioControl popover. There is exactly one copy of this
 * logic; the panel and the popover are two placements of it.
 */
export function ScenarioControls() {
  const [severity, setSeverity] = useState<1 | 2 | 3>(2);
  // "" = the historical local storm over Singapore/Malacca (D-91).
  const [stormNodeId, setStormNodeId] = useState("");
  const sim = useSimStore((s) => s.sim);
  const inject = useSimStore((s) => s.injectDisruption);

  const active = sim.disruptions.filter((d) => sim.clock.tick < d.startTick + d.durationTicks);

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs text-slate-500 dark:text-slate-400">Severity</span>
        {([1, 2, 3] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSeverity(s)}
            className={`rounded-md border px-2 py-1 text-xs ${severity === s ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900" : "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300"}`}
          >
            {s}
          </button>
        ))}
      </div>
      {/* D-91: where the storm sits. Local keeps the historical behaviour (the
          Tuas weather overlay); a chokepoint puts the weather out on that
          corridor instead, which is what makes a reroute worth proposing. */}
      <div className="mb-3 flex items-center gap-2">
        <label htmlFor="storm-location" className="text-xs text-slate-500 dark:text-slate-400">
          Storm location
        </label>
        <select
          id="storm-location"
          value={stormNodeId}
          onChange={(e) => setStormNodeId(e.target.value)}
          className="flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          <option value="">Singapore / Malacca (local)</option>
          {CHOKEPOINTS.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {SCENARIOS.map((sc) => {
          const Icon = sc.icon;
          const label =
            sc.type === "storm" && stormNodeId
              ? `Storm: ${CHOKEPOINTS.find((n) => n.id === stormNodeId)?.name ?? stormNodeId}`
              : sc.label;
          return (
            <button
              key={sc.type}
              title={label}
              onClick={() =>
                inject(sc.type, severity, undefined, sc.type === "storm" ? stormNodeId || undefined : undefined)
              }
              className="flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-4">
        <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">Active disruptions</p>
        {active.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">None.</p>
        ) : (
          <ul className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
            {active.map((d) => {
              const remaining = ticksToHours(d.startTick + d.durationTicks - sim.clock.tick);
              return (
                <li key={d.id} className="flex justify-between">
                  <span>{LABELS[d.type]} (sev {d.severity})</span>
                  <span className="font-mono">{remaining.toFixed(1)} h left</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

/**
 * The original card placement, kept so any view that wants the controls inline
 * still has them. The Resilience Monitor now opens them from the
 * ScenarioControl popover instead.
 */
export function ScenarioPanel() {
  return (
    <Panel title="Scenario Controls">
      <ScenarioControls />
    </Panel>
  );
}
