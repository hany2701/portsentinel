import { useSimStore } from "../../store/simStore";
import { berthConflicts, type BerthConflict } from "../../sim";
import { Panel, PanelState } from "../Panel";
import { SourceTag } from "../SourceTag";
import { PlanMove } from "../PlanMove";

const KIND_LABEL: Record<BerthConflict["kind"], string> = {
  "wait-breach": "Wait breach",
  "deepwater-contention": "Deep-water contention",
  closure: "Closure",
};

// Rule-based berth exceptions (berthConflicts). Each names its trigger; where a
// vessel can act, the same PlanMove control queues a Recommendation through the
// validate → preview → approve pipeline — no direct state mutation here.
export function BerthConflicts() {
  const sim = useSimStore((s) => s.sim);
  const select = useSimStore((s) => s.select);
  const conflicts = berthConflicts(sim);

  return (
    <Panel title={`Operational Exceptions (${conflicts.length})`} actions={<SourceTag variant="computed" />}>
      {conflicts.length === 0 ? (
        <PanelState text="No berth conflicts within the horizon." />
      ) : (
        <ul className="space-y-2">
          {conflicts.map((c) => {
            const vesselRef = c.entities.find((e) => e.entityType === "vessel");
            const vessel = vesselRef ? sim.vessels.find((v) => v.id === vesselRef.entityId) : undefined;
            const actionable = vessel && (vessel.status === "anchored" || vessel.status === "approaching");
            return (
              <li key={c.id} className="rounded-md border border-slate-200 p-2 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                    {KIND_LABEL[c.kind]}
                  </span>
                  {actionable && <PlanMove vessel={vessel} />}
                </div>
                <button
                  type="button"
                  onClick={() => vesselRef && select(vesselRef)}
                  className="mt-1 block text-left text-xs text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                >
                  {c.message}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
