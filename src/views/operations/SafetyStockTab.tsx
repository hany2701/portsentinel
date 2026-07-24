import { safetyStockOutlook } from "../../sim";
import { useSimStore } from "../../store/simStore";
import { KpiCard } from "../../components/KpiCard";
import { CustomerInventoryTable } from "../../components/ops/CustomerInventoryTable";
import { SafetyStockPanel } from "../../components/ops/SafetyStockPanel";

// Safety Stock: every customer's inventory position plus the computed at-risk
// outlook. Inventory view — always shows all customers (no healthy short-circuit);
// the outlook panel carries its own empty state.
export function SafetyStockTab() {
  const sim = useSimStore((s) => s.sim);
  const outlook = safetyStockOutlook(sim);
  const lowest = [...sim.customers].sort((a, b) => a.daysOfCoverRemaining - b.daysOfCoverRemaining)[0];
  const pending = outlook.filter((o) => o.pendingRec).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard
          label="Cover at Risk"
          value={String(outlook.length)}
          detail={`of ${sim.customers.length} customers`}
          source="computed"
          accent={outlook.length > 0 ? "warning" : undefined}
        />
        <KpiCard
          label="Lowest Cover"
          value={`${lowest.daysOfCoverRemaining.toFixed(1)} d`}
          detail={lowest.name}
          source="simulated"
          accent={outlook.some((o) => o.customer.id === lowest.id) ? "danger" : undefined}
        />
        <KpiCard label="Advisories Pending" value={String(pending)} source="computed" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <CustomerInventoryTable />
        <SafetyStockPanel />
      </div>
    </div>
  );
}
