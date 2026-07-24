import { rehandleRatio, yardCategoryPressure, yardUtilisationPct } from "../../sim";
import { useSimStore } from "../../store/simStore";
import { KpiCard } from "../../components/KpiCard";
import { YardAllocationPanel } from "../../components/ops/YardAllocationPanel";
import { YardFlowPanel } from "../../components/ops/YardFlowPanel";
import { AgvPanel } from "../../components/ops/AgvPanel";
import { DwellPanel } from "../../components/ops/DwellPanel";

const GATE_ACCENT = { normal: "success", busy: "warning", congested: "danger", closed: "danger" } as const;

// Yard Control: can the yard accommodate expected flows, and where should cargo
// go. Capacity + flow + allocation + AGV + dwell, progressive disclosure.
export function YardControlTab() {
  const sim = useSimStore((s) => s.sim);
  const util = Math.round(yardUtilisationPct(sim));
  const pressure = yardCategoryPressure(sim);
  const reefer = pressure.find((p) => p.category === "reefer")!;
  const rehandle = rehandleRatio(sim);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Yard Utilisation"
          value={`${util}%`}
          source="computed"
          accent={util > 85 ? "danger" : util >= 70 ? "warning" : "success"}
        />
        <KpiCard label="Reefer Pressure" value={`${reefer.pct}%`} detail={`${reefer.occupiedTEU}/${reefer.capacityTEU} TEU`} source="computed" />
        <KpiCard label="Gate Status" value={sim.gate.status} detail={`${sim.gate.queuedTrucks} trucks queued`} source="simulated" accent={GATE_ACCENT[sim.gate.status]} />
        <KpiCard label="Rehandle Ratio" value={`${rehandle}%`} detail="recent yard moves" source="computed" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <YardAllocationPanel />
        <YardFlowPanel />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <AgvPanel />
        <DwellPanel />
      </div>
    </div>
  );
}
