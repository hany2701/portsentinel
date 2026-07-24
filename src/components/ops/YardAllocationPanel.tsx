import { useState } from "react";
import { DOCTRINE, ticksToHours, yardBlockOccupiedTEU, yardBlockUtilisationPct } from "../../sim";
import type { CargoType, SimState, YardBlock } from "../../sim";
import { useSimStore } from "../../store/simStore";
import { Panel } from "../Panel";
import { SourceTag } from "../SourceTag";
import { isSelected, rowSelectionClass } from "./selectable";
import { useScrollSelectedIntoView } from "./useScrollSelectedIntoView";

function band(pct: number): { color: string; label: string } {
  if (pct < DOCTRINE.yard.normalBelowPct) return { color: "#1baf7a", label: "normal" };
  if (pct <= DOCTRINE.yard.elevatedBelowPct) return { color: "#eda100", label: "elevated" };
  return { color: "#d03b3b", label: "review" };
}

function blockTag(b: YardBlock): CargoType {
  return b.hazmat ? "hazmat" : b.reeferPowered ? "reefer" : "standard";
}

function accepts(b: YardBlock, type: CargoType): boolean {
  return type === "reefer" ? b.reeferPowered : type === "hazmat" ? b.hazmat : !b.reeferPowered && !b.hazmat;
}

function dwellFlags(sim: SimState, blockId: string): number {
  return sim.cargoLots.filter(
    (l) =>
      l.blockId === blockId &&
      l.status === "yard" &&
      l.dwellStartTick !== undefined &&
      ticksToHours(sim.clock.tick - l.dwellStartTick) / 24 > DOCTRINE.cargo.dwellFlagDays,
  ).length;
}

// Yard blocks (YB-A…YB-H) with occupied TEU, lot count and dwell flags. Selecting
// a block shares it with the twin; "Reallocate…" moves the block's oldest yard
// lot to a compatible block with room, through the validated effect pipeline.
export function YardAllocationPanel() {
  const sim = useSimStore((s) => s.sim);
  const selection = useSimStore((s) => s.selection);
  const select = useSimStore((s) => s.select);
  const scrollRef = useScrollSelectedIntoView<HTMLDivElement>(selection?.entityId ?? null);

  return (
    <Panel title="Yard Blocks" actions={<SourceTag variant="computed" />}>
      <div ref={scrollRef} className="grid gap-2 sm:grid-cols-2">
        {sim.yardBlocks.map((b) => {
          const pct = Math.round(yardBlockUtilisationPct(sim, b.id));
          const { color, label } = band(pct);
          const occupied = Math.round(yardBlockOccupiedTEU(sim, b.id));
          const lots = sim.cargoLots.filter((l) => l.blockId === b.id && l.status === "yard").length;
          const flags = dwellFlags(sim, b.id);
          const ref = { entityType: "yardBlock" as const, entityId: b.id };
          return (
            <div
              key={b.id}
              onClick={() => select(ref)}
              data-ops-selected={isSelected(selection, ref) || undefined}
              className={`rounded-md border border-slate-200 p-2 dark:border-slate-800 ${rowSelectionClass(isSelected(selection, ref))}`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                  {b.id} <span className="font-normal text-slate-400">· {blockTag(b)}</span>
                </span>
                <span className="font-mono text-slate-500 dark:text-slate-400">
                  {pct}% <span style={{ color }}>{label}</span>
                </span>
              </div>
              <div className="mt-1.5 h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700">
                <div className="h-2 rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <span className="font-mono">
                  {occupied} / {b.capacityTEU} TEU · {lots} lot{lots === 1 ? "" : "s"}
                  {flags > 0 && <span className="ml-1 text-[#d03b3b]">· {flags} over dwell</span>}
                </span>
                <span onClick={(e) => e.stopPropagation()}>
                  <Reallocate block={b} />
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function Reallocate({ block }: { block: YardBlock }) {
  const sim = useSimStore((s) => s.sim);
  const propose = useSimStore((s) => s.proposeUserAction);
  const [target, setTarget] = useState("");

  // Oldest yard lot in this block (highest dwell) is the reallocation candidate.
  const lot = sim.cargoLots
    .filter((l) => l.blockId === block.id && l.status === "yard")
    .sort((a, b) => (a.dwellStartTick ?? 0) - (b.dwellStartTick ?? 0))[0];
  if (!lot) return null;
  const targets = sim.yardBlocks.filter(
    (b) => b.id !== block.id && accepts(b, lot.type) && b.capacityTEU - yardBlockOccupiedTEU(sim, b.id) >= lot.quantityTEU,
  );
  if (targets.length === 0) return null;

  const confirm = () => {
    if (!target) return;
    propose(
      { kind: "reallocateYard", lotIds: [lot.id], toBlockId: target },
      `Re-allocate ${lot.quantityTEU} TEU (${lot.type}) from ${block.id} to ${target}`,
    );
    setTarget("");
  };

  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        aria-label={`Reallocate oldest lot from ${block.id}`}
        className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
      >
        <option value="">Reallocate…</option>
        {targets.map((t) => (
          <option key={t.id} value={t.id}>
            → {t.id}
          </option>
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
