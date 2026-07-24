import { avgTurnaroundHours, berthConflicts } from "../../sim";
import { useSimStore } from "../../store/simStore";
import { KpiCard } from "../../components/KpiCard";
import { BerthScheduleBoard } from "../../components/ops/BerthScheduleBoard";
import { BerthConflicts } from "../../components/ops/BerthConflicts";
import { BerthVesselTable } from "../../components/ops/BerthVesselTable";

// Berth Planning: which vessels are arriving, where they berth, and are there
// schedule/resource conflicts. Schedule-centric — the board leads, exceptions
// and the vessel roster support it.
export function BerthPlanningTab() {
  const sim = useSimStore((s) => s.sim);
  const total = sim.berths.length;
  const occupied = sim.berths.filter((b) => b.status === "occupied").length;
  const arriving = sim.vessels.filter((v) => v.status === "approaching" || v.status === "anchored").length;
  const conflicts = berthConflicts(sim).length;
  const turnaround = avgTurnaroundHours(sim);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Occupied" value={`${occupied}/${total}`} source="simulated" />
        <KpiCard label="Arriving" value={String(arriving)} detail="approaching + anchored" source="simulated" />
        <KpiCard
          label="Conflicts"
          value={String(conflicts)}
          source="computed"
          accent={conflicts > 0 ? "danger" : undefined}
        />
        <KpiCard
          label="Avg Turnaround"
          value={turnaround > 0 ? `${turnaround} h` : "—"}
          detail={turnaround > 0 ? "recent calls" : "no completed calls yet"}
          source="computed"
        />
      </div>
      <BerthScheduleBoard />
      <div className="grid gap-4 xl:grid-cols-2">
        <BerthConflicts />
        <BerthVesselTable />
      </div>
    </div>
  );
}
