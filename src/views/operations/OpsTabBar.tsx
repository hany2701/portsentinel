import { Anchor, CalendarClock, Container, ShieldCheck, TriangleAlert, type LucideIcon } from "lucide-react";
import { safetyStockOutlook, teuAtRisk, vesselsWaiting } from "../../sim";
import { useSimStore } from "../../store/simStore";
import { useOpsStore, type OpsTab } from "../../store/opsStore";

const TABS: { id: OpsTab; label: string; icon: LucideIcon }[] = [
  { id: "berths", label: "Berth Planning", icon: CalendarClock },
  { id: "yard", label: "Yard Control", icon: Container },
  { id: "anchorage", label: "Anchorage Queue", icon: Anchor },
  { id: "cargo", label: "Cargo at Risk", icon: TriangleAlert },
  { id: "safety", label: "Safety Stock", icon: ShieldCheck },
];

// Sub-tab navigation for the Operations shell. Count badges surface live load:
// vessels waiting (anchorage) and TEU at risk (cargo) — both existing derivations.
export function OpsTabBar() {
  const sim = useSimStore((s) => s.sim);
  const tab = useOpsStore((s) => s.tab);
  const setTab = useOpsStore((s) => s.setTab);
  const badges: Partial<Record<OpsTab, number>> = {
    anchorage: vesselsWaiting(sim),
    cargo: teuAtRisk(sim),
    safety: safetyStockOutlook(sim).length,
  };

  return (
    <nav className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900" aria-label="Operations workspaces">
      {TABS.map(({ id, label, icon: Icon }) => {
        const isActive = id === tab;
        const badge = badges[id];
        return (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-current={isActive ? "page" : undefined}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium ${
              isActive
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {label}
            {badge !== undefined && badge > 0 && (
              <span
                className={`rounded-full px-1.5 text-xs font-mono ${
                  isActive
                    ? "bg-white/20 dark:bg-slate-900/20"
                    : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                }`}
              >
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
