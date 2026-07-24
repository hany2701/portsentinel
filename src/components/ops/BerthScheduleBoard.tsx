import { useSimStore } from "../../store/simStore";
import { useOpsStore } from "../../store/opsStore";
import { berthTimeline, serviceCallSlots, ticksToHours, type BerthWindow } from "../../sim";
import { serviceDelayTicks } from "../../maritime/serviceDelay";
import { Panel } from "../Panel";
import { SourceTag } from "../SourceTag";
import { isSelected } from "./selectable";
import { useScrollSelectedIntoView } from "./useScrollSelectedIntoView";

const AXIS_STEPS = 4;
const MAX_MARKERS = 14;

// Airport-style berth schedule: 12 berths on a shared now→horizon time axis.
// Occupied windows are solid (work % in the tooltip); projected assignments are
// dashed outlines; scheduled service calls are ticks on the axis. All windows
// come from the deterministic berthTimeline projection.
export function BerthScheduleBoard() {
  const sim = useSimStore((s) => s.sim);
  const selection = useSimStore((s) => s.selection);
  const select = useSimStore((s) => s.select);
  const horizon = useOpsStore((s) => s.horizonTicks);
  const scrollRef = useScrollSelectedIntoView<HTMLDivElement>(selection?.entityId ?? null);
  const now = sim.clock.tick;
  const rows = berthTimeline(sim, horizon);
  // D-110: shift the projected calls by whatever slip each service's rotation is
  // carrying, so the board agrees with the ETA tick.ts will actually book.
  const calls = serviceCallSlots(now, horizon, (id) => serviceDelayTicks(sim, id)).slice(0, MAX_MARKERS);
  const pct = (tick: number) => Math.max(0, Math.min(100, ((tick - now) / horizon) * 100));

  return (
    <Panel title="Berth Schedule Board" actions={<SourceTag variant="computed" />}>
      <div className="relative mb-1 ml-16 h-4 border-b border-slate-200 dark:border-slate-800">
        {Array.from({ length: AXIS_STEPS + 1 }).map((_, i) => (
          <span
            key={i}
            className="absolute -translate-x-1/2 text-[10px] text-slate-400"
            style={{ left: `${(100 / AXIS_STEPS) * i}%` }}
          >
            +{Math.round((ticksToHours(horizon) / AXIS_STEPS) * i)}h
          </span>
        ))}
      </div>
      <div className="relative mb-2 ml-16 h-3" aria-hidden="true">
        {calls.map((c, i) => (
          <span
            key={i}
            title={`${c.service.name} (${c.service.class}) · scheduled ± jitter`}
            className="absolute top-0 h-3 w-px bg-slate-400 dark:bg-slate-500"
            style={{ left: `${pct(c.slotTick)}%` }}
          />
        ))}
      </div>
      <div ref={scrollRef} className="space-y-1">
        {rows.map(({ berth, windows }) => {
          const berthSelected = isSelected(selection, { entityType: "berth", entityId: berth.id });
          return (
          <div
            key={berth.id}
            data-ops-selected={berthSelected || undefined}
            className={`flex items-center gap-2 rounded ${berthSelected ? "bg-violet-50 ring-1 ring-inset ring-violet-300 dark:bg-violet-950/40 dark:ring-violet-700" : ""}`}
          >
            <div className="flex w-14 shrink-0 items-center gap-1">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{berth.id}</span>
              {berth.deepWater && (
                <span
                  title="Deep-water berth"
                  className="rounded bg-sky-100 px-1 text-[9px] font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-300"
                >
                  DW
                </span>
              )}
            </div>
            <div className="relative h-6 flex-1 rounded bg-slate-100 dark:bg-slate-800/60">
              {berth.status === "closed" ? (
                <div className="absolute inset-0 flex items-center justify-center rounded bg-[repeating-linear-gradient(45deg,#d03b3b33,#d03b3b33_6px,transparent_6px,transparent_12px)] text-[10px] font-medium text-[#d03b3b]">
                  Closed
                </div>
              ) : (
                windows.map((w, i) => (
                  <WindowBar
                    key={i}
                    w={w}
                    left={pct(w.startTick)}
                    width={Math.max(2, pct(w.endTick) - pct(w.startTick))}
                    selected={isSelected(selection, { entityType: "vessel", entityId: w.vesselId })}
                    onSelect={() => select({ entityType: "vessel", entityId: w.vesselId })}
                  />
                ))
              )}
            </div>
          </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        Assumes no new disruptions. Tick marks = scheduled calls.
      </p>
    </Panel>
  );
}

function WindowBar({
  w,
  left,
  width,
  selected,
  onSelect,
}: {
  w: BerthWindow;
  left: number;
  width: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const occupied = w.kind === "occupied";
  return (
    <button
      type="button"
      onClick={onSelect}
      title={`${w.vesselName} · ${occupied ? "alongside" : "projected"}${
        w.workProgress !== undefined ? ` · ${Math.round(w.workProgress * 100)}%` : ""
      }`}
      className={`absolute top-0 h-6 overflow-hidden rounded px-1 text-left text-[10px] leading-6 ${
        selected ? "ring-2 ring-[#8b5cf6]" : ""
      }`}
      style={{
        left: `${left}%`,
        width: `${width}%`,
        background: occupied ? "#2a78d6" : "transparent",
        border: occupied ? "none" : "1px dashed #2a78d6",
      }}
    >
      <span className={occupied ? "text-white" : "text-[#2a78d6] dark:text-[#3987e5]"}>{w.vesselName}</span>
    </button>
  );
}
