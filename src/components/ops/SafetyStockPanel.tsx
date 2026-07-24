import { safetyStockOutlook } from "../../sim";
import { useSimStore } from "../../store/simStore";
import { Panel, PanelState } from "../Panel";
import { SourceTag } from "../SourceTag";

// High-priority customers whose cover is threatened by delayed shipments
// (safetyStockOutlook). The advisory action queues the existing
// safetyStockAdvisory effect (advisory, not a state mutation) with the shared
// calculated shortfall — never a UI-authored number.
export function SafetyStockPanel() {
  const sim = useSimStore((s) => s.sim);
  const propose = useSimStore((s) => s.proposeUserAction);
  const rows = safetyStockOutlook(sim);

  return (
    <Panel title="Safety-Stock Outlook" actions={<SourceTag variant="computed" />}>
      {rows.length === 0 ? (
        <PanelState text="No high-priority customer cover at risk." />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.customer.id} className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2 text-xs last:border-0 dark:border-slate-800/50">
              <div className="min-w-0">
                <p className="font-medium text-slate-800 dark:text-slate-100">{r.customer.name}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {r.affectedTEU.toLocaleString()} TEU · delay {r.expectedDelayDays.toFixed(1)} d · shortfall{" "}
                  <span className="font-medium text-[#d03b3b]">{r.shortfallDays} d</span>
                </p>
              </div>
              {r.pendingRec ? (
                <span className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                  advisory pending
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    propose(
                      { kind: "safetyStockAdvisory", customerId: r.customer.id, days: r.shortfallDays },
                      `Safety-stock advisory for ${r.customer.name} (${r.shortfallDays} d)`,
                    )
                  }
                  className="shrink-0 rounded bg-slate-900 px-1.5 py-0.5 text-[11px] font-medium text-white dark:bg-slate-100 dark:text-slate-900"
                >
                  Advise
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
