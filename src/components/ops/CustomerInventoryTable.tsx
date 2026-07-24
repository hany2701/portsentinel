import { safetyStockOutlook } from "../../sim";
import type { SafetyStockOutlook } from "../../sim";
import { useSimStore } from "../../store/simStore";
import { Panel } from "../Panel";
import { SourceTag } from "../SourceTag";

// All customers' inventory position (seeded fields — hence `simulated`), joined
// with the computed safety-stock outlook. At-risk = membership in the outlook,
// the same doctrine predicate the Advise action uses — no separate derivation.
export function CustomerInventoryTable() {
  const sim = useSimStore((s) => s.sim);
  const atRisk = new Map<string, SafetyStockOutlook>(
    safetyStockOutlook(sim).map((o) => [o.customer.id, o]),
  );
  const rows = [...sim.customers].sort((a, b) => {
    const riskDiff = Number(atRisk.has(b.id)) - Number(atRisk.has(a.id));
    return riskDiff !== 0 ? riskDiff : a.daysOfCoverRemaining - b.daysOfCoverRemaining;
  });

  return (
    <Panel title="Customer Inventory" actions={<SourceTag variant="simulated" />}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
            <th className="py-2 font-normal">Customer</th>
            <th className="py-2 font-normal">Sector</th>
            <th className="py-2 font-normal">Flags</th>
            <th className="py-2 font-normal">Daily use</th>
            <th className="py-2 font-normal">Cover</th>
            <th className="py-2 font-normal">Safety stock</th>
            <th className="py-2 font-normal">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const risk = atRisk.get(c.id);
            return (
              <tr key={c.id} className="border-b border-slate-100 text-slate-600 last:border-0 dark:border-slate-800/50 dark:text-slate-300">
                <td className="py-2 text-xs font-medium text-slate-800 dark:text-slate-100">{c.name}</td>
                <td className="py-2 text-xs capitalize">{c.sector}</td>
                <td className="py-2 text-xs">
                  {c.defaultPriority === "high" && (
                    <span className="mr-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">high</span>
                  )}
                  {c.temperatureSensitive && (
                    <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-300">temp</span>
                  )}
                  {c.defaultPriority !== "high" && !c.temperatureSensitive && "—"}
                </td>
                <td className="py-2 font-mono text-xs">{c.dailyConsumptionTEU} TEU/d</td>
                <td className={`py-2 font-mono text-xs ${risk ? "font-medium text-[#d03b3b]" : ""}`}>{c.daysOfCoverRemaining.toFixed(1)} d</td>
                <td className="py-2 font-mono text-xs">{c.safetyStockDays} d</td>
                <td className="py-2 text-xs">
                  {risk ? (
                    <span className="font-medium text-[#d03b3b]">shortfall {risk.shortfallDays} d</span>
                  ) : (
                    <span className="text-[#1baf7a]">OK</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}
