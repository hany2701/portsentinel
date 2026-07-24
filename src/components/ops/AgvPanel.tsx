import { agvMetrics } from "../../sim";
import { useSimStore } from "../../store/simStore";
import { Panel, PanelState } from "../Panel";
import { SourceTag } from "../SourceTag";

// AGV operations as a DERIVED resource (approved policy: AGVs are not simulated
// entities). Demand comes from the terminal move log, sustainable rate from
// working STS units, transfer legs + route pressure from discharge/yard state.
// Transfer TIME is intentionally not computed: no configured transfer speed
// exists in the sim, so it is shown as an explicit unavailable state.
export function AgvPanel() {
  const sim = useSimStore((s) => s.sim);
  const m = agvMetrics(sim);

  return (
    <Panel title="AGV Operations" actions={<SourceTag variant="computed" />}>
      <p className="mb-2 text-[11px] text-slate-400">
        Derived from crane work — AGVs not individually simulated.
      </p>
      {m.suspended ? (
        <PanelState text="Transfers suspended — RTG/STS weather suspension." />
      ) : m.legs.length === 0 ? (
        <PanelState text="No active transfers — no vessel discharging." />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
            <span className="text-slate-500 dark:text-slate-400">
              Utilisation{" "}
              <span className="font-mono text-slate-800 dark:text-slate-100">
                {m.utilisationPct !== null ? `${m.utilisationPct}%` : "—"}
              </span>
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              Demand{" "}
              <span className="font-mono text-slate-800 dark:text-slate-100">{m.demandMovesPerTick}</span> / sustainable{" "}
              <span className="font-mono text-slate-800 dark:text-slate-100">{m.sustainableMovesPerTick}</span> moves·tick⁻¹
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
            {m.branchPressure.map((bp) => (
              <span
                key={bp.branchIndex}
                className={`rounded px-1.5 py-0.5 ${
                  bp.legCount > 1
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                    : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                }`}
                title="Concurrent transfer legs on this finger branch"
              >
                F{bp.branchIndex + 1}: {bp.legCount}
              </span>
            ))}
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
                  <th className="py-1.5 font-normal">Berth</th>
                  <th className="py-1.5 font-normal">Vessel</th>
                  <th className="py-1.5 font-normal">Type</th>
                  <th className="py-1.5 font-normal">Eligible blocks</th>
                  <th className="py-1.5 font-normal">Route (rel.)</th>
                </tr>
              </thead>
              <tbody>
                {m.legs.map((leg) => (
                  <tr key={leg.vesselId} className="border-b border-slate-100 text-slate-600 dark:border-slate-800/50 dark:text-slate-300">
                    <td className="py-1.5 font-mono text-xs">{leg.berthId}</td>
                    <td className="py-1.5 font-medium text-slate-800 dark:text-slate-100">{leg.vesselName}</td>
                    <td className="py-1.5 capitalize">{leg.cargoType}</td>
                    <td className="py-1.5 font-mono text-xs">{leg.eligibleBlockIds.join(", ") || "—"}</td>
                    <td className="py-1.5 font-mono text-xs">
                      F{leg.branchIndex + 1} · {leg.distanceUnits}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Transfer time unavailable — no AGV speed data.
          </p>
        </>
      )}
    </Panel>
  );
}
