import { averageBerthWaitHours, DOCTRINE, maxAnchorageWait, vesselsWaiting } from "../../sim";
import { useSimStore } from "../../store/simStore";
import type { ViewId } from "../registry";
import { KpiCard } from "../../components/KpiCard";
import { AnchorageMap } from "../../components/ops/AnchorageMap";
import { QueueTable } from "../../components/ops/QueueTable";

// Anchorage Queue: who is next, when they can enter, and what is causing the
// wait. Queue-centric and location-aware (2D map beside the ranked queue).
export function AnchorageTab({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const sim = useSimStore((s) => s.sim);
  const waiting = vesselsWaiting(sim);
  const avg = averageBerthWaitHours(sim);
  const worst = maxAnchorageWait(sim);
  const target = DOCTRINE.berth.targetMaxAnchorageWaitHours;
  const weatherAffected = sim.wxOps.movesSuspended ? waiting : 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Waiting" value={String(waiting)} source="simulated" />
        <KpiCard label="Avg Wait" value={`${avg.toFixed(1)} h`} detail={`target max ${target} h`} source="computed" />
        <KpiCard
          label="Worst Wait"
          value={worst ? `${worst.hours} h` : "—"}
          detail={worst ? worst.vessel.name : "anchorage clear"}
          detailAccent={!!worst && worst.hours > target}
          source="computed"
          accent={worst && worst.hours > target ? "danger" : undefined}
        />
        <KpiCard label="Weather Affected" value={String(weatherAffected)} detail={sim.wxOps.movesSuspended ? "moves suspended" : "moves normal"} source="simulated" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <AnchorageMap onNavigate={onNavigate} />
        <QueueTable />
      </div>
    </div>
  );
}
