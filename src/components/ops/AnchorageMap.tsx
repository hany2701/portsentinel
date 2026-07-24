import { anchorageQueue } from "../../sim";
import type { ViewId } from "../../views/registry";
import { COMB_OUTLINE, GROUND, anchorageSlot, approachSlot, berthLayout, divertSlot } from "../../twin/layout";
import { C, vesselColor } from "../../twin/colors";
import { useSimStore } from "../../store/simStore";
import { Panel } from "../Panel";
import { SourceTag } from "../SourceTag";
import { isSelected } from "./selectable";

// A 2D operational abstraction of the anchorage, north-up. It CONSUMES the twin's
// layout geometry read-only (no coupling, no geometry changes) — full spatial
// context lives in the Digital Twin. Anchored vessels are placed at their
// queue-rank slot, so the map's spatial order is exactly the anchorageQueue order.
const VB_W = 360;
const VB_H = 400;
const Z_TOP = -190;
const Z_BOTTOM = 20;

function project(x: number, z: number): { sx: number; sy: number } {
  return {
    sx: ((x - GROUND.minX) / (GROUND.maxX - GROUND.minX)) * VB_W,
    sy: ((z - Z_TOP) / (Z_BOTTOM - Z_TOP)) * VB_H,
  };
}

export function AnchorageMap({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const sim = useSimStore((s) => s.sim);
  const selection = useSimStore((s) => s.selection);
  const select = useSimStore((s) => s.select);

  const land = COMB_OUTLINE.map((p) => {
    const { sx, sy } = project(p.x, p.z);
    return `${sx.toFixed(1)},${sy.toFixed(1)}`;
  }).join(" ");

  const queue = anchorageQueue(sim);
  const approaching = sim.vessels
    .filter((v) => v.status === "approaching")
    .sort((a, b) => a.etaTick - b.etaTick || a.id.localeCompare(b.id));
  const diverted = sim.vessels.filter((v) => v.status === "diverted");

  const anchBox = project(2, -118);
  const anchBoxEnd = project(52, -190);

  return (
    <Panel
      title="Anchorage Map"
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate("twin")}
            className="text-xs font-medium text-sky-600 hover:underline dark:text-sky-400"
          >
            Open Digital Twin →
          </button>
          <SourceTag variant="simulated" />
        </div>
      }
    >
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-auto w-full" role="img" aria-label="Anchorage schematic">
        <rect x={0} y={0} width={VB_W} height={VB_H} fill={C.water} opacity={0.12} />
        {/* anchorage zone */}
        <rect
          x={anchBox.sx}
          y={anchBoxEnd.sy}
          width={anchBoxEnd.sx - anchBox.sx}
          height={anchBox.sy - anchBoxEnd.sy}
          fill="none"
          stroke={C.slate}
          strokeDasharray="4 3"
          strokeWidth={1}
          rx={6}
        />
        <text x={anchBox.sx + 4} y={anchBoxEnd.sy + 12} fontSize={10} fill={C.slate}>
          Anchorage
        </text>
        {/* land */}
        <polygon points={land} fill={C.ground} opacity={0.55} stroke={C.quay} strokeWidth={1} />
        <text x={project(-20, 40).sx} y={project(-20, 40).sy} fontSize={10} fill="#475569">
          Tuas terminal
        </text>
        {/* berth reference marks */}
        {sim.berths.map((b) => {
          const layout = berthLayout(b.id);
          const { sx, sy } = project(layout.vesselX, layout.z);
          return (
            <rect
              key={b.id}
              x={sx - 2}
              y={sy - 2}
              width={4}
              height={4}
              fill={b.status === "occupied" ? C.blue : b.status === "closed" ? C.red : C.deck}
            />
          );
        })}
        {/* approaching + diverted (context) */}
        {approaching.map((v, i) => {
          const { sx, sy } = project(approachSlot(i).x, approachSlot(i).z);
          return <circle key={v.id} cx={sx} cy={sy} r={3} fill="none" stroke={C.blueLight} strokeWidth={1.5} />;
        })}
        {diverted.map((v, i) => {
          const { sx, sy } = project(divertSlot(i).x, divertSlot(i).z);
          return <circle key={v.id} cx={sx} cy={sy} r={3} fill={C.red} opacity={0.6} />;
        })}
        {/* anchored vessels at their queue-rank slot */}
        {queue.map((v, rank) => {
          const { sx, sy } = project(anchorageSlot(rank).x, anchorageSlot(rank).z);
          const sel = isSelected(selection, { entityType: "vessel", entityId: v.id });
          return (
            <g key={v.id} onClick={() => select({ entityType: "vessel", entityId: v.id })} className="cursor-pointer">
              <circle cx={sx} cy={sy} r={7} fill={vesselColor("anchored")} stroke={sel ? C.select : "#00000022"} strokeWidth={sel ? 3 : 1} />
              <text x={sx} y={sy + 3} fontSize={8} textAnchor="middle" fill="#1e293b" fontWeight="600">
                {rank + 1}
              </text>
              <title>{`#${rank + 1} ${v.name} (${v.class})`}</title>
            </g>
          );
        })}
      </svg>
      {queue.length === 0 && (
        <p className="mt-2 text-center text-xs text-slate-500 dark:text-slate-400">Anchorage clear.</p>
      )}
      <p className="mt-2 text-[11px] text-slate-400">
        Numbers are queue rank, not position. See Digital Twin.
      </p>
    </Panel>
  );
}
