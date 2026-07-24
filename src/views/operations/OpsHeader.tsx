import { Box, X } from "lucide-react";
import { FORECAST_HORIZON_OPTIONS, formatSimTime, ticksToHours } from "../../sim";
import type { EntityRef, SimState } from "../../sim";
import { SourceTag } from "../../components/SourceTag";
import { useSimStore } from "../../store/simStore";
import { useOpsStore } from "../../store/opsStore";
import type { ViewId } from "../registry";

// Resolve a display label for the shared selection. Recycled/departed entities
// resolve honestly ("no longer active") rather than the chip vanishing.
function selectionLabel(sim: SimState, ref: EntityRef): string {
  switch (ref.entityType) {
    case "vessel": {
      const v = sim.vessels.find((x) => x.id === ref.entityId);
      return v ? `${v.name} · ${v.status}` : `${ref.entityId} · no longer active`;
    }
    case "berth":
      return sim.berths.find((b) => b.id === ref.entityId)?.id ?? ref.entityId;
    case "yardBlock":
      return sim.yardBlocks.find((b) => b.id === ref.entityId)?.id ?? ref.entityId;
    default:
      return ref.entityId;
  }
}

// Shared Operations controls: sim timestamp, planning horizon, entity search,
// selected-entity context (shared with the Digital Twin inspector) and the
// weather-feed provenance for the view.
export function OpsHeader({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const sim = useSimStore((s) => s.sim);
  const selection = useSimStore((s) => s.selection);
  const select = useSimStore((s) => s.select);
  const search = useOpsStore((s) => s.search);
  const setSearch = useOpsStore((s) => s.setSearch);
  const horizonTicks = useOpsStore((s) => s.horizonTicks);
  const setHorizon = useOpsStore((s) => s.setHorizon);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-sm text-slate-800 dark:text-slate-100">
          {formatSimTime(sim.clock.simMinutes)}
        </span>
        <span className="text-xs text-slate-400 dark:text-slate-500">tick {sim.clock.tick}</span>
      </div>
      <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        Horizon
        <select
          value={horizonTicks}
          onChange={(e) => setHorizon(Number(e.target.value))}
          className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          {FORECAST_HORIZON_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {ticksToHours(t)} h
            </option>
          ))}
        </select>
      </label>
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search vessel, berth, block…"
        className="w-52 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:placeholder:text-slate-500"
        aria-label="Search operations entities"
      />
      <div className="ml-auto flex items-center gap-3">
        {selection && (
          <span className="flex items-center gap-1.5 rounded-md border border-violet-300 bg-violet-50 px-2 py-1 text-xs text-violet-800 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-200">
            <span className="font-medium">{selectionLabel(sim, selection)}</span>
            <button
              type="button"
              onClick={() => onNavigate("twin")}
              title="Open in Digital Twin"
              className="flex items-center gap-1 rounded px-1 hover:bg-violet-100 dark:hover:bg-violet-900"
            >
              <Box className="h-3.5 w-3.5" aria-hidden="true" />
              Twin
            </button>
            <button
              type="button"
              onClick={() => select(null)}
              title="Clear selection"
              className="rounded p-0.5 hover:bg-violet-100 dark:hover:bg-violet-900"
              aria-label="Clear selection"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </span>
        )}
        <SourceTag variant={sim.weather.freshness} />
      </div>
    </div>
  );
}
