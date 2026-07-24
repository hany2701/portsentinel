import { CheckCircle2 } from "lucide-react";
import {
  connectionsAtRisk,
  connectionsAtRiskTEU,
  connectionsMissed,
  safetyStockOutlook,
  teuAtRisk,
} from "../../sim";
import { useSimStore } from "../../store/simStore";
import { KpiCard } from "../../components/KpiCard";
import { Panel } from "../../components/Panel";
import { CargoRiskTable } from "../../components/ops/CargoRiskTable";
import { CargoJourney } from "../../components/ops/CargoJourney";
import { ConnectionRiskPanel } from "../../components/ops/ConnectionRiskPanel";

// Cargo at Risk: which cargo/connections are exposed, why, and what intervention
// is required. Exception-centric; a compact healthy state when nothing is at risk.
export function CargoRiskTab() {
  const sim = useSimStore((s) => s.sim);
  const teu = teuAtRisk(sim);
  const connAtRisk = connectionsAtRisk(sim).length;
  const connTEU = connectionsAtRiskTEU(sim);
  const missed = connectionsMissed(sim).length;
  const safetyCases = safetyStockOutlook(sim).length;

  if (teu === 0 && connAtRisk === 0 && missed === 0 && safetyCases === 0) {
    return (
      <Panel title="Cargo at Risk">
        <div className="flex items-center gap-2 py-2 text-sm text-slate-600 dark:text-slate-300">
          <CheckCircle2 className="h-5 w-5 text-[#1baf7a]" aria-hidden="true" />
          No cargo is currently classified as at risk.
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="TEU at Risk" value={teu.toLocaleString()} detail="delay + dwell" source="computed" accent={teu > 0 ? "danger" : undefined} />
        <KpiCard label="Connections at Risk" value={String(connAtRisk)} detail={`${connTEU.toLocaleString()} TEU`} source="computed" accent={connAtRisk > 0 ? "warning" : undefined} />
        <KpiCard label="Missed Connections" value={String(missed)} source="computed" accent={missed > 0 ? "danger" : undefined} />
        <KpiCard label="Safety-Stock Cases" value={String(safetyCases)} source="computed" accent={safetyCases > 0 ? "warning" : undefined} />
      </div>
      <CargoRiskTable />
      <div className="grid gap-4 xl:grid-cols-2">
        <CargoJourney />
        <ConnectionRiskPanel />
      </div>
    </div>
  );
}
