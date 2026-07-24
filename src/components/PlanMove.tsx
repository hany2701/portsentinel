import { useState } from "react";
import type { Vessel } from "../sim";
import { useSimStore } from "../store/simStore";

// D-69: inline "Plan move" control on Operations rows. Anchored vessels can
// re-berth (suitable available berths) or divert; approaching vessels can only
// divert. Confirm queues a user-sourced Recommendation through the same
// validate → preview → approve pipeline as rule/agent proposals.
export function PlanMove({ vessel }: { vessel: Vessel }) {
  const berths = useSimStore((s) => s.sim.berths);
  const ports = useSimStore((s) => s.sim.alternatePorts);
  const propose = useSimStore((s) => s.proposeUserAction);
  const [target, setTarget] = useState("");

  const options: { value: string; label: string }[] = [];
  if (vessel.status === "anchored") {
    for (const b of berths) {
      if (b.status !== "available") continue;
      if (vessel.class === "neopanamax" && !b.deepWater) continue;
      options.push({ value: `berth:${b.id}`, label: `Re-berth to ${b.name}` });
    }
  }
  if (vessel.status === "anchored" || vessel.status === "approaching") {
    for (const p of ports) options.push({ value: `port:${p.id}`, label: `Divert to ${p.name}` });
  }
  if (options.length === 0) return null;

  const confirm = () => {
    const [kind, id] = target.split(":");
    if (kind === "berth") {
      propose({ kind: "reassignBerth", vesselId: vessel.id, toBerthId: id }, `Re-berth ${vessel.name} to ${id}`);
    } else if (kind === "port") {
      const port = ports.find((p) => p.id === id);
      propose({ kind: "divertVessel", vesselId: vessel.id, toPortId: id }, `Divert ${vessel.name} to ${port?.name ?? id}`);
    }
    setTarget("");
  };

  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        aria-label={`Plan a move for ${vessel.name}`}
        className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
      >
        <option value="">Plan move…</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {target && (
        <button
          type="button"
          onClick={confirm}
          className="rounded bg-slate-900 px-1.5 py-0.5 text-[11px] font-medium text-white dark:bg-slate-100 dark:text-slate-900"
        >
          Queue
        </button>
      )}
    </span>
  );
}
